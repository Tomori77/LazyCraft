import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../lib/prisma-client/client.js';
import {
  DEFAULT_STACK_MAX,
  ITEMS,
  SHOP_ENTRIES,
  addToContainer,
  canAddToContainer,
  generateEquipment,
  levelFromExp,
  newUid,
  stackQuality,
  toEquipmentInstance,
  type CarriedItem,
  type ContainerAdd,
  type ShopEntry,
} from '@lazycraft/shared';
import { SaveService } from '../save/save.service.js';
import { readGold, writeGold } from '../save/gold.js';
import { mustGetPlayer, mustLockSave } from '../save/save-tx.js';
import {
  DEFAULT_INVENTORY_CAPACITY,
  type SaveDataV3,
} from '../save/save-shape.js';

/** 玩家等级口径：攻击技能等级（与 inventory / combat 一致，见 inventory.service.ts） */
const PLAYER_LEVEL_SKILL = 'attack';

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
function entryQuality(entry: ShopEntry) {
  return entry.quality ?? 'common';
}

/**
 * 商店服务（task-24）
 *
 * 商店 = 系统 NPC 的固定价目表，只做"金币 ↔ 物品"；与玩家市场（/api/market）完全分离，
 * 抽象资源与物品资源不得互相折算（铁律）。写路径与 inventory 同构：
 * Prisma.$transaction + 行锁 + 基于最新存档整体覆写。
 *
 * 库存取舍：`stock` 为 -1 表示无限；有限库存**不持久化**（当前无 shop 表），
 * 仅作为"单次购买上限 + 静态展示"。这样字段不是死配置，又不必为一个纯展示维度新建表；
 * 需要真正扣减库存时再引入 shop_stock 表即可，接口形状不变。
 */
@Injectable()
export class ShopService {
  constructor(private readonly saveService: SaveService) {}

  /**
   * 列出商店条目，并带上"买得起 / 已解锁"（基于当前玩家存档）。
   *
   * 直接返回数组而非 { gold, entries }：条目本身可携带派生标志，
   * 前端拿到的就是"能渲染的列表"，不必再拆一层；金币由 /api/player 提供。
   */
  async list(accountId: string) {
    const { data } = await this.saveService.read(accountId);
    const snapshot = data as unknown as SaveDataV3;
    const gold = readGold(snapshot);
    const level = playerLevel(snapshot);

    return SHOP_ENTRIES.map((entry) => ({
      ...entry,
      affordable: gold >= entry.buy_price,
      unlocked: level >= (entry.required_level ?? 1),
    }));
  }

  /** 购买：扣金币 → 发货入背包（容量不足拒绝） */
  async buy(accountId: string, entryId: string, quantity: number) {
    const entry = SHOP_ENTRIES.find((e) => e.id === entryId);
    if (!entry) throw new NotFoundException(`商店条目不存在: ${entryId}`);

    // 有限库存视为单次购买上限（不持久化，见类注释）
    if (entry.stock >= 0 && quantity > entry.stock) {
      throw new ForbiddenException(`库存不足：仅剩 ${entry.stock}`);
    }

    const prisma = this.saveService.prisma;
    return prisma.$transaction(async (tx) => {
      const player = await mustGetPlayer(tx, accountId);
      const save = await mustLockSave(tx, player.id);
      const data = save.data as unknown as SaveDataV3;

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

      let next: SaveDataV3 = {
        ...data,
        inventory: addToContainer(inventory, additions, newUid, stackMaxOf),
      };
      next = writeGold(next, gold - cost) as SaveDataV3;

      await tx.save.update({
        where: { id: save.id },
        data: { data: next as unknown as Prisma.InputJsonValue },
      });
      return { entry_id: entry.id, quantity, cost, gold: gold - cost };
    });
  }

  /** 出售：从背包找 uid → 按条目 sell_price 回收金币；无 sell_price 不可出售 */
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

      const entry = this.findSellableEntry(item);
      if (!entry || entry.sell_price === undefined) {
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
      const gained = entry.sell_price * quantity;
      let next: SaveDataV3 = { ...data, inventory: nextInventory };
      next = writeGold(next, gold + gained) as SaveDataV3;

      await tx.save.update({
        where: { id: save.id },
        data: { data: next as unknown as Prisma.InputJsonValue },
      });
      return { uid, entry_id: entry.id, quantity, gained, gold: gold + gained };
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

  /** 找出能回收该物品的商店条目：按 kind + 引用 id + 品质精确匹配 */
  private findSellableEntry(item: CarriedItem): ShopEntry | undefined {
    if (item.kind === 'equipment') {
      return SHOP_ENTRIES.find(
        (e) =>
          e.kind === 'equipment' &&
          e.template_id === item.template_id &&
          entryQuality(e) === item.quality &&
          e.sell_price !== undefined,
      );
    }
    const quality = stackQuality(item);
    return SHOP_ENTRIES.find(
      (e) =>
        e.kind === 'item' &&
        e.item_id === item.item_id &&
        entryQuality(e) === quality &&
        e.sell_price !== undefined,
    );
  }
}
