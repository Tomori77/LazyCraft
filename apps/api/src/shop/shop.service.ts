import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../lib/prisma-client/client.js';
import type { ShopEntryRow } from '../lib/prisma-client/client.js';
import {
  DEFAULT_STACK_MAX,
  ITEMS,
  addToContainer,
  canAddToContainer,
  generateEquipment,
  levelFromExp,
  newUid,
  stackQuality,
  toEquipmentInstance,
  type CarriedItem,
  type ContainerAdd,
  type Quality,
  type ShopEntry,
} from '@lazycraft/shared';
import { SaveService } from '../save/save.service.js';
import { readGold, writeGold } from '../save/gold.js';
import { mustGetPlayer, mustLockSave } from '../save/save-tx.js';
import {
  DEFAULT_INVENTORY_CAPACITY,
  type SaveDataV3,
} from '../save/save-shape.js';

/** 玩家等级口径：攻击技能等级（与 inventory / combat 一致） */
const PLAYER_LEVEL_SKILL = 'attack';

/** 无限库存哨兵：与 DB 的 CHECK(stock >= -1) 及 shared 注释保持一致 */
const INFINITE_STOCK = -1;

interface SkillsMap {
  [skillId: string]: { exp?: number } | undefined;
}

function stackMaxOf(itemId: string): number {
  return ITEMS.find((i) => i.id === itemId)?.stack_max ?? DEFAULT_STACK_MAX;
}

function inventoryOf(data: SaveDataV3): CarriedItem[] {
  return Array.isArray(data.inventory) ? data.inventory : [];
}

function inventoryCapacityOf(data: SaveDataV3): number {
  const value = (data as Partial<SaveDataV3>).inventory_capacity;
  return typeof value === 'number' ? value : DEFAULT_INVENTORY_CAPACITY;
}

function playerLevel(data: SaveDataV3): number {
  const skills = (data.skills ?? {}) as SkillsMap;
  const exp =
    typeof skills[PLAYER_LEVEL_SKILL]?.exp === 'number'
      ? (skills[PLAYER_LEVEL_SKILL]!.exp as number)
      : 0;
  return levelFromExp(exp);
}

/** 条目出货品质：缺省 common */
function entryQuality(entry: ShopEntry): Quality {
  return entry.quality ?? 'common';
}

/** DB 行 → 对外条目形状（snake_case，与 task-24 的 GET /api/shop 契约完全一致） */
function toShopEntry(row: ShopEntryRow): ShopEntry {
  return {
    id: row.id,
    kind: row.kind as ShopEntry['kind'],
    ...(row.itemId !== null ? { item_id: row.itemId } : {}),
    ...(row.templateId !== null ? { template_id: row.templateId } : {}),
    ...(row.quality !== null ? { quality: row.quality as Quality } : {}),
    buy_price: row.buyPrice,
    ...(row.sellPrice !== null ? { sell_price: row.sellPrice } : {}),
    ...(row.requiredLevel !== null ? { required_level: row.requiredLevel } : {}),
    stock: row.stock,
  };
}

/**
 * 品质匹配条件：条目 quality 为 NULL 等价于 'common'。
 *
 * 为什么不能直接 `quality: q`？
 *   seed 里的物品条目不带 quality（NULL = 默认品质），而堆叠实例缺省也是 common；
 *   若只精确匹配字符串，NULL 行永远匹配不到，出售会误判"不可出售"。
 */
function matchQuality(q: Quality): Prisma.ShopEntryRowWhereInput {
  return q === 'common'
    ? { OR: [{ quality: 'common' }, { quality: null }] }
    : { quality: q };
}

/**
 * 商店服务（task-24b）
 *
 * 商店 = 系统 NPC 的固定价目表，只做"金币 ↔ 物品"；与玩家市场（/api/market）完全分离。
 * 条目已全部入库（`shop_entries`），库存为**全服共享**、买入真实扣减。
 *
 * 并发模型：
 *   buy 在 Prisma.$transaction 内先锁玩家存档（save-tx 的 mustLockSave），
 *   再用"带条件的 updateMany"原子扣库存——`WHERE stock >= quantity`
 *   让 Postgres 对该行加锁并在锁释放后重新求值条件，两个买家抢最后一件时
 *   只有一个 count=1，另一个 count=0 转 403。这比"先 SELECT 再 UPDATE"
 *   少一个 TOCTOU 窗口，也省掉了 raw SQL 的 SELECT ... FOR UPDATE。
 *   stock = -1（无限）不参与扣减，故无需锁。
 */
@Injectable()
export class ShopService {
  constructor(private readonly saveService: SaveService) {}

  /**
   * 列出**已上架**条目，并带上"买得起 / 已解锁"（基于当前玩家存档）。
   *
   * 直接返回数组而非 { gold, entries }：条目本身可携带派生标志，
   * 前端拿到的就是"能渲染的列表"，不必再拆一层；金币由 /api/player 提供。
   */
  async list(accountId: string) {
    const { data } = await this.saveService.read(accountId);
    const snapshot = data as unknown as SaveDataV3;
    const gold = readGold(snapshot);
    const level = playerLevel(snapshot);

    const rows = await this.saveService.prisma.shopEntryRow.findMany({
      where: { listed: true },
      // 稳定排序：同 sort_order 时按 id，避免分页/刷新顺序抖动
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    return rows.map((row) => {
      const entry = toShopEntry(row);
      return {
        ...entry,
        affordable: gold >= entry.buy_price,
        unlocked: level >= (entry.required_level ?? 1),
      };
    });
  }

  /** 购买：扣金币 → 真实扣减全服库存 → 发货入背包（容量不足拒绝） */
  async buy(accountId: string, entryId: string, quantity: number) {
    const prisma = this.saveService.prisma;
    return prisma.$transaction(async (tx) => {
      const player = await mustGetPlayer(tx, accountId);
      const save = await mustLockSave(tx, player.id);
      const data = save.data as unknown as SaveDataV3;

      const row = await tx.shopEntryRow.findUnique({ where: { id: entryId } });
      // 未上架对买家等同不存在，避免"下架了还能买到"的漏洞
      if (!row || !row.listed) throw new NotFoundException(`商店条目不存在: ${entryId}`);
      const entry = toShopEntry(row);

      const level = playerLevel(data);
      if (level < (entry.required_level ?? 1)) {
        throw new ForbiddenException(
          `等级不足：需要 ${entry.required_level} 级，当前 ${level} 级`,
        );
      }

      const cost = entry.buy_price * quantity;
      const gold = readGold(data);
      if (gold < cost) {
        throw new ForbiddenException(`金币不足：需要 ${cost}，当前 ${gold}`);
      }

      const additions = this.buildAdditions(entry, quantity);
      const inventory = inventoryOf(data);
      if (!canAddToContainer(inventory, additions, inventoryCapacityOf(data), stackMaxOf)) {
        throw new ForbiddenException('背包容量不足，无法购买');
      }

      // 原子扣库存：条件不满足（被并发买走）则 count=0 → 403
      if (row.stock !== INFINITE_STOCK) {
        const dec = await tx.shopEntryRow.updateMany({
          where: { id: row.id, stock: { gte: quantity } },
          data: { stock: { decrement: quantity } },
        });
        if (dec.count === 0) {
          throw new ForbiddenException(`库存不足：仅剩 ${row.stock}`);
        }
      }

      let next: SaveDataV3 = {
        ...data,
        inventory: addToContainer(inventory, additions, newUid, stackMaxOf),
      };
      next = writeGold(next, gold - cost) as SaveDataV3;

      await tx.save.update({
        where: { id: save.id },
        data: { data: next as unknown as Prisma.InputJsonValue },
      });

      const stock = row.stock === INFINITE_STOCK ? INFINITE_STOCK : row.stock - quantity;
      return { entry_id: entry.id, quantity, cost, gold: gold - cost, stock };
    });
  }

  /** 出售：从背包找 uid → 按条目 sell_price 回收金币；**不回补库存** */
  async sell(accountId: string, uid: string, quantity: number) {
    const prisma = this.saveService.prisma;
    return prisma.$transaction(async (tx) => {
      const player = await mustGetPlayer(tx, accountId);
      const save = await mustLockSave(tx, player.id);
      const data = save.data as unknown as SaveDataV3;

      const inventory = inventoryOf(data);
      const index = inventory.findIndex((item) => item.uid === uid);
      if (index < 0) throw new NotFoundException(`物品不存在: ${uid}`);
      const item = inventory[index];

      const row = await tx.shopEntryRow.findFirst({
        where: this.sellWhereFor(item),
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
      if (!row || row.sellPrice === null) {
        throw new ForbiddenException('该物品不可出售');
      }

      let nextInventory: CarriedItem[];
      if (item.kind === 'equipment') {
        if (quantity !== 1) {
          throw new BadRequestException('装备不可拆分，quantity 只能为 1');
        }
        nextInventory = inventory.filter((_, i) => i !== index);
      } else {
        if (quantity > item.quantity) {
          throw new BadRequestException(
            `出售数量超过持有量：持有 ${item.quantity}，请求 ${quantity}`,
          );
        }
        const left = item.quantity - quantity;
        nextInventory =
          left > 0
            ? inventory.map((cur, i) => (i === index ? { ...cur, quantity: left } : cur))
            : inventory.filter((_, i) => i !== index);
      }

      const gold = readGold(data);
      const gained = row.sellPrice * quantity;
      let next: SaveDataV3 = { ...data, inventory: nextInventory };
      next = writeGold(next, gold + gained) as SaveDataV3;

      await tx.save.update({
        where: { id: save.id },
        data: { data: next as unknown as Prisma.InputJsonValue },
      });
      return { uid, entry_id: row.id, quantity, gained, gold: gold + gained };
    });
  }

  /* ---------------------------------------------------------------- */
  /* 内部工具                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * 构造购买发货物：堆叠物按 (item_id, quality) 合并；装备每件独立生成。
   *
   * 装备实例走 generateEquipment（复用掉落系统同一份生成逻辑），
   * 但词缀池传空——商店卖的是"白板底材"，随机词缀属于掉落/打造玩法，
   * 不该让玩家用固定价买到带随机的成品（否则商店会变成词缀抽奖机）。
   */
  private buildAdditions(entry: ShopEntry, quantity: number): ContainerAdd[] {
    const quality = entryQuality(entry);
    if (entry.kind === 'item') {
      if (!entry.item_id) {
        throw new InternalServerErrorException(`商店条目 ${entry.id} 缺 item_id`);
      }
      // 只给"加入物"描述，uid 由 addToContainer 落盘时分配
      return [{ item_id: entry.item_id, quantity, quality }];
    }

    if (!entry.template_id) {
      throw new InternalServerErrorException(`商店条目 ${entry.id} 缺 template_id`);
    }
    const additions: ContainerAdd[] = [];
    for (let i = 0; i < quantity; i += 1) {
      const generated = generateEquipment({
        template_id: entry.template_id,
        quality,
        affix_pool_ids: [],
        // 白板仍要求 rng 参数；无词缀可抽，随机性不会被消费
        rng: Math.random,
      });
      if (!generated) {
        throw new InternalServerErrorException(
          `商店条目 ${entry.id} 无法生成装备（模板/品质配置错误）`,
        );
      }
      const instance = toEquipmentInstance(generated, newUid());
      if (!instance) {
        throw new InternalServerErrorException(`商店条目 ${entry.id} 模板不存在`);
      }
      additions.push(instance);
    }
    return additions;
  }

  /** 找出能回收该物品的商店条目：按 kind + 引用 id + 品质 + 有 sell_price + 已上架 */
  private sellWhereFor(item: CarriedItem): Prisma.ShopEntryRowWhereInput {
    if (item.kind === 'equipment') {
      return {
        kind: 'equipment',
        templateId: item.template_id,
        listed: true,
        sellPrice: { not: null },
        ...matchQuality(item.quality),
      };
    }
    return {
      kind: 'item',
      itemId: item.item_id,
      listed: true,
      sellPrice: { not: null },
      ...matchQuality(stackQuality(item)),
    };
  }
}
