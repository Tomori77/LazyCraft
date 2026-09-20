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
  heldQuantityForRecyclable,
  isRecyclable,
  levelFromExp,
  newUid,
  stackQuality,
  toEquipmentInstance,
  type CarriedItem,
  type ContainerAdd,
  type Quality,
  type RecyclableEntry,
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

/** DB 行 → 回收清单条目（sell_price 必填，见 packages/shared/src/data/shop.ts 的语义） */
function toRecyclableEntry(row: ShopEntryRow): RecyclableEntry {
  const entry: RecyclableEntry = {
    entry_id: row.id,
    kind: row.kind as ShopEntry['kind'],
    sell_price: row.sellPrice ?? 0,
  };
  if (row.itemId !== null) entry.item_id = row.itemId;
  if (row.templateId !== null) entry.template_id = row.templateId;
  if (row.quality !== null) entry.quality = row.quality as Quality;
  return entry;
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
   * 商店主视图：**分区**返回"可购买条目"与"固定可回收清单"。
   *
   * 契约变化（task-33）：原来返回裸数组，现为 `{ entries, recyclables }`。
   *   为什么不再返回裸数组？出售页签已与背包解耦，需要的是"清单"而非
   *   "背包 + 价格匹配"；把两份数据一次下发，前端不必猜条目能不能回收。
   *   金币仍由 /api/player 提供（本接口只补 affordable/unlocked 派生标志）。
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

    const entries = rows.map((row) => {
      const entry = toShopEntry(row);
      return {
        ...entry,
        affordable: gold >= entry.buy_price,
        unlocked: level >= (entry.required_level ?? 1),
      };
    });

    // 固定回收清单：已上架 + 有 sell_price；带玩家当前持有量，供前端算"最大"
    const recyclables = rows
      .filter((row) => isRecyclable(toShopEntry(row)))
      .map((row) => {
        const entry = toRecyclableEntry(row);
        return { ...entry, held: heldQuantityForRecyclable(inventoryOf(snapshot), entry) };
      });

    return { entries, recyclables };
  }

  /**
   * 单独的可回收清单接口（供只想刷回收页的调用方）。
   *
   * 为什么不复用 list()？回收清单的权威形状由 shared 的 `RecyclableEntry` 定义，
   * 单独暴露可让 admin/插件按同一契约取数，不必理解购买侧的 affordable/unlocked。
   */
  async listRecyclables(accountId: string) {
    const { data } = await this.saveService.read(accountId);
    const snapshot = data as unknown as SaveDataV3;
    const rows = await this.saveService.prisma.shopEntryRow.findMany({
      where: { listed: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows
      .filter((row) => isRecyclable(toShopEntry(row)))
      .map((row) => {
        const entry = toRecyclableEntry(row);
        return { ...entry, held: heldQuantityForRecyclable(inventoryOf(snapshot), entry) };
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

  /**
   * 出售：按 **`entry_id` + `quantity`** 从固定回收清单出货；**不回补库存**。
   *
   * 为什么不保留旧的 `uid` 口径？
   *   旧口径要求客户端先列背包、自己匹配到条目再回传 uid，出售入口等于背包的
   *   投影；决策要求"固定清单与背包解耦"。改为 `entry_id` 后，服务端按条目的
   *   `(item_id|template_id, quality)` 聚合背包持有量（shared 的同一份口径），
   *   前端只需报"卖哪种货、卖几个"——不依赖背包的呈现顺序，也无法用伪造 uid
   *   指向清单外的物品。老 `uid` 字段不再被读取。
   */
  async sell(accountId: string, entryId: string, quantity: number) {
    const prisma = this.saveService.prisma;
    return prisma.$transaction(async (tx) => {
      const player = await mustGetPlayer(tx, accountId);
      const save = await mustLockSave(tx, player.id);
      const data = save.data as unknown as SaveDataV3;

      const row = await tx.shopEntryRow.findUnique({ where: { id: entryId } });
      // 未上架对卖家等同不存在，避免"下架了还能回收"
      if (!row || !row.listed) throw new NotFoundException(`商店条目不存在: ${entryId}`);
      if (row.sellPrice === null) {
        throw new ForbiddenException('该物品不可回收');
      }

      const entry = toRecyclableEntry(row);
      const inventory = inventoryOf(data);
      const held = heldQuantityForRecyclable(inventory, entry);
      if (held <= 0) {
        throw new NotFoundException(`背包中没有可回收的物品: ${entryId}`);
      }
      if (quantity > held) {
        throw new BadRequestException(`出售数量超过持有量：持有 ${held}，请求 ${quantity}`);
      }

      const nextInventory = removeRecycled(inventory, entry, quantity);

      const gold = readGold(data);
      const gained = entry.sell_price * quantity;
      let next: SaveDataV3 = { ...data, inventory: nextInventory };
      next = writeGold(next, gold + gained) as SaveDataV3;

      await tx.save.update({
        where: { id: save.id },
        data: { data: next as unknown as Prisma.InputJsonValue },
      });
      return { entry_id: entryId, quantity, gained, gold: gold + gained };
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

}

/**
 * 从背包扣掉指定数量的可回收物：按条目引用 + 品质匹配，堆叠物逐格扣减、
 * 装备整件移除；扣满 quantity 即停（不碰其它物品）。
 *
 * 为什么用"先扣满即停"而不是"先按 uid 定位"？
 *   出售已与背包解耦，服务端只认 `(item_id|template_id, quality)`；
 *   同品质多格时逐格扣减的结果与玩家预期一致（总量守恒），
 *   且不必让客户端指定要动哪一格。
 */
function removeRecycled(
  inventory: ReadonlyArray<CarriedItem>,
  entry: Pick<RecyclableEntry, 'kind' | 'item_id' | 'template_id' | 'quality'>,
  quantity: number,
): CarriedItem[] {
  const entryQuality = entry.quality ?? 'common';
  let remaining = quantity;
  const next: CarriedItem[] = [];

  for (const item of inventory) {
    if (remaining <= 0) {
      next.push(item);
      continue;
    }
    if (entry.kind === 'item') {
      if (item.kind !== 'stack' || item.item_id !== entry.item_id || stackQuality(item) !== entryQuality) {
        next.push(item);
        continue;
      }
      const take = Math.min(remaining, item.quantity);
      remaining -= take;
      const left = item.quantity - take;
      if (left > 0) next.push({ ...item, quantity: left });
      continue;
    }
    if (item.kind !== 'equipment' || item.template_id !== entry.template_id || item.quality !== entryQuality) {
      next.push(item);
      continue;
    }
    // 装备不可拆分：一件一 uid，直接整件移除
    remaining -= 1;
  }

  return next;
}
