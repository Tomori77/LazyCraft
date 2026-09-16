import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../lib/prisma-client/client.js';
import { ITEMS, type Item, type ItemStack, type Quality } from '@lazycraft/shared';
import { SaveService } from '../save/save.service.js';
import type { SaveData } from '../save/save-shape.js';

/* ------------------------------------------------------------------ */
/* 模块内常量                                                          */
/* ------------------------------------------------------------------ */

/**
 * 交易税率：5%
 *
 * 为什么定 5% 而不是别的：参考《框架设计》5.5 节"税收回收"——
 * 数字本身不大到影响买卖体验，又能让长线服务器通胀持续被抽水。
 */
export const MARKET_TAX_RATE = 0.05;

/**
 * 挂单费（gold，按次固定，不随价格走）
 *
 * 为什么用固定费而不是"按百分比"押金？
 *   押金在到期归还、收单不退的语义会让玩家把"挂低价卖不动"当成免费仓库；
 *   一笔小额固定手续费直接回收，每次挂单都有真实成本，抑制垃圾挂单。
 */
export const MARKET_LISTING_FEE = 5;

/**
 * 挂单有效期上限：7 天（毫秒）
 *
 * 为什么必须给截止日期而不是"永久挂单"：
 *   永久挂单会让市场变成"长期仓库"，买家浏览体验变差；
 *   到期撤单返还物品由前端/玩家主动触发（懒结算），避免给后端加定时任务。
 */
export const MARKET_LISTING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 分页大小硬上限：超过就截断，防止客户端传 100000 拉爆扫描 */
const MAX_PAGE_SIZE = 50;

/** 抽象资源 key：金币。与《框架设计》约定一致（gold 是唯一的玩家间结算货币） */
const GOLD_KEY = 'gold';

/* ------------------------------------------------------------------ */
/* 存档内物品形状                                                      */
/* ------------------------------------------------------------------ */

interface InventoryStack extends ItemStack {
  /** 品质缺省按 'common'，与 types.ts 默认一致 */
  quality?: Quality;
}

/* ------------------------------------------------------------------ */
/* 内部小工具（不暴露给外面）                                          */
/* ------------------------------------------------------------------ */

/** 从 data.abstract_resources 读金币余额；字段缺失一律视为 0 */
function readGold(data: SaveData): number {
  const raw = (data.abstract_resources as Record<string, unknown> | undefined)?.[GOLD_KEY];
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

/** 写回金币余额：跟读侧对称，只动 gold 一个字段，其它抽象资源原样保留 */
function writeGold(data: SaveData, gold: number): SaveData {
  return {
    ...data,
    abstract_resources: {
      ...(data.abstract_resources as Record<string, unknown> | undefined),
      [GOLD_KEY]: Math.max(0, Math.floor(gold)),
    },
  };
}

/** 从背包扣除 (item_id, quality, qty)；不够则抛 403（不允许部分扣） */
function removeItems(data: SaveData, itemId: string, quality: Quality, qty: number): SaveData {
  const inv = Array.isArray(data.inventory) ? (data.inventory as InventoryStack[]) : [];
  const total = inv
    .filter((s) => s.item_id === itemId && (s.quality ?? 'common') === quality)
    .reduce((sum, s) => sum + s.quantity, 0);
  if (total < qty) {
    throw new ForbiddenException(`物品不足：${itemId}(${quality}) 需要 ${qty}，当前 ${total}`);
  }
  let remaining = qty;
  const next: InventoryStack[] = [];
  for (const stack of inv) {
    if (remaining <= 0 || stack.item_id !== itemId || (stack.quality ?? 'common') !== quality) {
      next.push(stack);
      continue;
    }
    const take = Math.min(stack.quantity, remaining);
    const left = stack.quantity - take;
    remaining -= take;
    if (left > 0) next.push({ ...stack, quantity: left });
  }
  return { ...data, inventory: next };
}

/** 向背包加物品；同 (item_id, quality) 优先合并进第一格，否则追加新格 */
function addItems(data: SaveData, itemId: string, quality: Quality, qty: number): SaveData {
  if (qty <= 0) return data;
  const inv = Array.isArray(data.inventory) ? (data.inventory as InventoryStack[]) : [];
  const next = inv.map((s) => ({ ...s }));
  const existed = next.find((s) => s.item_id === itemId && (s.quality ?? 'common') === quality);
  if (existed) {
    existed.quantity += qty;
  } else {
    next.push({ item_id: itemId, quantity: qty, quality });
  }
  return { ...data, inventory: next };
}

/** 找到物品配置；未配置 = 不可交易 */
function findItem(itemId: string): Item | undefined {
  return ITEMS.find((i) => i.id === itemId);
}

/** 校验物品允许交易（tradeable=true 且 quality 合法） */
function assertTradeable(item: Item, quality: Quality) {
  if (!item.tradeable) {
    throw new ForbiddenException(`物品 ${item.id} 不可交易`);
  }
  if (!item.quality.includes(quality)) {
    throw new ForbiddenException(`物品 ${item.id} 没有品质 ${quality}`);
  }
}

/** 数据库列 → Prisma 字段名（MarketListing 字段是驼峰） */
function toListingView(row: {
  id: string;
  sellerId: string;
  itemId: string;
  quality: string;
  quantity: number;
  price: number;
  createdAt: Date;
  expiresAt: Date;
  seller?: { name: string } | null;
}) {
  return {
    id: row.id,
    seller_id: row.sellerId,
    seller_name: row.seller?.name ?? null,
    item_id: row.itemId,
    quality: row.quality,
    quantity: row.quantity,
    unit_price: row.price,
    total_price: row.price * row.quantity,
    created_at: row.createdAt.getTime(),
    expires_at: row.expiresAt.getTime(),
  };
}

/**
 * 玩家市场服务（task-15）
 *
 * 服务器权威的三个关键点：
 *   1. list/cancel/buy 三个写路径都在 Prisma.$transaction 内串行：
 *      挂单表行锁 + saves 表行锁一起进入事务，避免"扣钱成功但物品没发出"；
 *   2. 物品数量、金币余额全部以"当前 DB 里的存档快照"为准，不信客户端报数；
 *   3. 税率/挂单费统一走模块顶部常量，避免散落在各处的魔法数。
 *
 * 为什么不复用 SaveService.write？
 *   SaveService.write 的并发模型是"整份 data 覆盖 + version 乐观锁"，
 *   挂单交易需要"挂单行 + 买家存档 + 卖家存档"三方原子性，只能在
 *   Prisma 事务里用 SELECT ... FOR UPDATE 级别的锁来串行化。
 */
@Injectable()
export class MarketService {
  constructor(private readonly saveService: SaveService) {}

  /* ---------------------------------------------------------------- */
  /* 挂单                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 卖家挂单：收挂单费（gold）→ 从背包扣物品 → 写挂单。
   *
   * 为什么挂单费在事务内立即扣而不是等成交时扣？
   *   挂单费的意义是"占用市场版位 + 抑制垃圾挂单"，无论是否成交都要收；
   *   把它放在事务里跟扣物品一起完成，避免玩家挂单后迅速把金币花光变成"白挂单"。
   */
  async list(accountId: string, itemId: string, quality: Quality, quantity: number, price: number) {
    const item = findItem(itemId);
    if (!item) throw new NotFoundException(`物品不存在: ${itemId}`);
    assertTradeable(item, quality);

    const prisma = this.saveService.prisma;

    return prisma.$transaction(async (tx) => {
      const player = await this.mustGetPlayer(tx, accountId);
      const save = await this.mustLockSave(tx, player.id);
      const data = save.data as unknown as SaveData;

      // 校验 + 扣挂单费 + 扣物品，三步顺序任意但必须原子——放进同一个 data 覆写
      const gold = readGold(data);
      if (gold < MARKET_LISTING_FEE) {
        throw new ForbiddenException(`金币不足：挂单费需要 ${MARKET_LISTING_FEE}，当前 ${gold}`);
      }
      let next = removeItems(data, itemId, quality, quantity);
      next = writeGold(next, gold - MARKET_LISTING_FEE);

      const now = new Date();
      const expiresAt = new Date(now.getTime() + MARKET_LISTING_TTL_MS);
      const listing = await tx.marketListing.create({
        data: {
          sellerId: player.id,
          itemId,
          quality,
          quantity,
          price,
          expiresAt,
        },
      });

      await tx.save.update({
        where: { id: save.id },
        data: { data: next as unknown as Prisma.InputJsonValue },
      });

      return {
        listing: toListingView({ ...listing, seller: { name: player.name } }),
        fee: MARKET_LISTING_FEE,
      };
    });
  }

  /* ---------------------------------------------------------------- */
  /* 撤单                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 卖家撤单：删挂单 → 物品退回背包（手续费不退）。
   *
   * 为什么手续费不退？
   *   手续费定位是"挂单行为本身的成本"，与是否成交无关；
   *   退还会让"挂了撤、撤了挂"成为免费刷新前排的手段。
   *
   * deleteMany + 条件 WHERE 实现"只能撤自己的"：
   *   把 sellerId 写进 WHERE，DB 层兜底防越权；count=0 统一返回 404
   *   （前端不需要区分"不存在"和"别人的"）。
   */
  async cancel(accountId: string, listingId: string) {
    const prisma = this.saveService.prisma;

    return prisma.$transaction(async (tx) => {
      const player = await this.mustGetPlayer(tx, accountId);
      const listing = await tx.marketListing.findUnique({ where: { id: listingId } });
      if (!listing) throw new NotFoundException('挂单不存在或已被处理');
      if (listing.sellerId !== player.id) {
        throw new ForbiddenException('只能撤销自己的挂单');
      }

      const save = await this.mustLockSave(tx, player.id);
      const data = save.data as unknown as SaveData;
      const next = addItems(data, listing.itemId, listing.quality as Quality, listing.quantity);

      await tx.marketListing.delete({ where: { id: listing.id } });
      await tx.save.update({
        where: { id: save.id },
        data: { data: next as unknown as Prisma.InputJsonValue },
      });

      return { listing_id: listing.id, returned: { item_id: listing.itemId, quality: listing.quality, quantity: listing.quantity } };
    });
  }

  /* ---------------------------------------------------------------- */
  /* 购买                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 买家购买：买家扣总价 → 卖家得 95%（系统收 5% 税）→ 物品发往买家背包。
   *
   * 为什么用 $transaction 而不是"查一次 + 改两次"？
   *   并发两个买家抢同一张单时，"查单 → 删单"之间如果不锁行，
   *   第二个买家会基于已删除的单继续扣钱。
   * findUnique + delete 在同一个事务里，Postgres 会给挂单行加行锁，
   * 后到的事务会在 delete 阶段串行等待；
   * delete 之前再做一次"是否仍存在"的查行，就把 toctou 窗口彻底关死。
   *
   * 税额直接记为系统回收（不入任何人背包）：
   *   buy 收到的 total = price * quantity，给卖家 seller_gets = floor(total * 0.95)；
   *   tax = total - seller_gets 自然落在 [0, total] 区间，直接"消失"即可——
   *   这就是"回收金币"的语义。
   */
  async buy(accountId: string, listingId: string) {
    const prisma = this.saveService.prisma;

    return prisma.$transaction(async (tx) => {
      // 读挂单（删之前先锁住行：同事务里的 delete 会给该行加行锁）
      const listing = await tx.marketListing.findUnique({ where: { id: listingId } });
      if (!listing) throw new NotFoundException('挂单不存在或已被购买');

      const buyer = await this.mustGetPlayer(tx, accountId);
      if (listing.sellerId === buyer.id) {
        throw new BadRequestException('不能购买自己的挂单');
      }

      // 卖家：必须仍然存在；ON DELETE CASCADE 下不会出现悬空——但并发删号的极端场景兜底
      const seller = await tx.player.findUnique({ where: { id: listing.sellerId } });
      if (!seller) throw new NotFoundException('卖家不存在');

      // 锁两份存档：先锁买家后锁卖家（顺序固定，避免循环等待）
      const buyerSave = await this.mustLockSave(tx, buyer.id);
      const sellerSave = await this.mustLockSave(tx, seller.id, buyerSave.id);

      const buyerData = buyerSave.data as unknown as SaveData;
      const sellerData = sellerSave.data as unknown as SaveData;

      const total = listing.price * listing.quantity;
      const buyerGold = readGold(buyerData);
      if (buyerGold < total) {
        throw new ForbiddenException(`金币不足：需要 ${total}，当前 ${buyerGold}`);
      }

      const sellerGet = Math.floor(total * (1 - MARKET_TAX_RATE));
      const tax = total - sellerGet;

      // 删挂单（事务内行锁保证并发下只有一个事务能删到）
      const del = await tx.marketListing.deleteMany({ where: { id: listing.id } });
      if (del.count === 0) {
        throw new ConflictException('挂单已被其他交易处理');
      }

      // 买家：扣钱 + 收货
      let nextBuyer = writeGold(buyerData, buyerGold - total);
      nextBuyer = addItems(nextBuyer, listing.itemId, listing.quality as Quality, listing.quantity);
      await tx.save.update({
        where: { id: buyerSave.id },
        data: { data: nextBuyer as unknown as Prisma.InputJsonValue },
      });

      // 卖家：收钱
      const sellerGold = readGold(sellerData);
      const nextSeller = writeGold(sellerData, sellerGold + sellerGet);
      await tx.save.update({
        where: { id: sellerSave.id },
        data: { data: nextSeller as unknown as Prisma.InputJsonValue },
      });

      // 历史聚合：当天 (item, quality) 一行的 avg_price / volume
      await this.recordHistory(tx, listing.itemId, listing.quality as Quality, listing.price, listing.quantity);

      return {
        listing_id: listing.id,
        item_id: listing.itemId,
        quality: listing.quality,
        quantity: listing.quantity,
        unit_price: listing.price,
        total_price: total,
        tax,
        seller_gets: sellerGet,
      };
    });
  }

  /* ---------------------------------------------------------------- */
  /* 查询                                                              */
  /* ---------------------------------------------------------------- */

  /** 我的挂单：只查当前账号的，不过滤过期（过期单仍要展示给卖家，让他能撤单收回物品） */
  async myListings(accountId: string) {
    const prisma = this.saveService.prisma;
    const player = await prisma.player.findFirst({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
    });
    // 没角色 = 没挂过单 = 空列表；不主动创建角色避免"只是浏览市场也建一个存档"
    if (!player) return { listings: [] };
    const rows = await prisma.marketListing.findMany({
      where: { sellerId: player.id },
      orderBy: { createdAt: 'desc' },
      include: { seller: true },
    });
    return { listings: rows.map((r) => toListingView(r)) };
  }

  /**
   * 浏览市场：默认过滤掉已过期挂单；按 created_at 倒序。
   *
   * 为什么"过期单"不在 SQL 层物理删除？
   *   物理删除需要后台任务；过期单的"物品退回"由玩家主动调 cancel 完成
   *   （懒结算），DB 行保留作为"待退物品"凭据。前端浏览仅过滤展示，不影响逻辑。
   */
  async browse(itemId: string | undefined, quality: string | undefined, page = 1, limit = 20) {
    const prisma = this.saveService.prisma;
    const safeLimit = Math.min(Math.max(1, limit), MAX_PAGE_SIZE);
    const safePage = Math.max(1, page);
    const where: Prisma.MarketListingWhereInput = {
      ...(itemId ? { itemId } : {}),
      ...(quality ? { quality } : {}),
      expiresAt: { gt: new Date() },
    };
    const [total, rows] = await Promise.all([
      prisma.marketListing.count({ where }),
      prisma.marketListing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        include: { seller: true },
      }),
    ]);
    return {
      listings: rows.map((r) => toListingView(r)),
      page: safePage,
      limit: safeLimit,
      total,
    };
  }

  /** 历史：按日期倒序返回最近 limit 天；供"价格走势"图直接消费
   *
   *   avg_price 是读侧派生：total_price / volume；四舍五入到整数金，
   *  前端无需关心聚合细节，拿到的就是"当日平均成交价"。
   */
  async history(itemId: string, quality: string | undefined, limit = 30) {
    const prisma = this.saveService.prisma;
    const safeLimit = Math.min(Math.max(1, limit), 90);
    const rows = await prisma.marketHistory.findMany({
      where: { itemId, ...(quality ? { quality } : {}) },
      orderBy: { date: 'desc' },
      take: safeLimit,
    });
    return {
      item_id: itemId,
      history: rows.map((r) => ({
        date: r.date,
        avg_price: r.volume > 0 ? Math.round(r.totalPrice / r.volume) : 0,
        volume: r.volume,
        quality: r.quality,
      })),
    };
  }

  /* ---------------------------------------------------------------- */
  /* 内部工具                                                          */
  /* ---------------------------------------------------------------- */

  /** 拿当前账号对应的 player；挂在 SaveService 上是统一入口 */
  private async mustGetPlayer(tx: Prisma.TransactionClient, accountId: string) {
    const player = await tx.player.findFirst({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
    });
    if (!player) {
      // 没有角色就意味着没有任何资源（背包/金币都在 saves 里），
      // 直接报 403 而不是懒创建——市场模块不该负责"初始化玩家"
      throw new ForbiddenException('角色不存在，请先访问 /api/save 初始化存档');
    }
    return player;
  }

  /**
   * 锁一份存档：用 update ... where id 触发 Postgres 行锁。
   *
   * 为什么用 update 而不是 select for update：
   *   Prisma 7 的 `select ... for update` 仍要走 raw SQL；
   *   把 data 写成它自己的值也能拿到行锁，且类型稳定。
   *
   * @param excludeId 调用方提示"已持有这把锁"，直接复用现有 save 行
   */
  private async mustLockSave(tx: Prisma.TransactionClient, playerId: string, excludeId?: string) {
    const save = await tx.save.findUnique({ where: { playerId } });
    if (!save) throw new NotFoundException('存档不存在，请先访问 /api/save 初始化');
    if (excludeId && save.id === excludeId) {
      // 同一存档：已锁，直接复用（买家=卖家的场景会被前置条件拦掉，此处仅防御）
      return save;
    }
    // 通过一次无副作用的 update 拿行锁
    return tx.save.update({
      where: { id: save.id },
      data: { version: save.version },
    });
  }

  /**
   * 把一笔成交写进 history 表：(item_id, quality, today) 唯一行的 total_price / volume。
   *
   * 为什么存 total_price 而不是滚动 avg_price：
   *   加权滚动平均每次都要 floor 成 int，丢掉的尾数会在多笔成交时累积成
   *   显而易见的偏差（两笔 50*2 + 100*3 会得到 79 而不是精确的 80）。
   *   改成"累加总额 + 累加总量"后 avg_price 只在读侧派生，
   *   数学上严格等价于"全日逐笔 avg"，且列数不变、查询成本不变。
   */
  private async recordHistory(
    tx: Prisma.TransactionClient,
    itemId: string,
    quality: Quality,
    unitPrice: number,
    quantity: number,
  ) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD（UTC）
    const existing = await tx.marketHistory.findUnique({
      where: { itemId_quality_date: { itemId, quality, date: today } },
    });
    if (!existing) {
      await tx.marketHistory.create({
        data: { itemId, quality, totalPrice: unitPrice * quantity, volume: quantity, date: today },
      });
      return;
    }
    await tx.marketHistory.update({
      where: { id: existing.id },
      data: {
        totalPrice: existing.totalPrice + unitPrice * quantity,
        volume: existing.volume + quantity,
      },
    });
  }
}
