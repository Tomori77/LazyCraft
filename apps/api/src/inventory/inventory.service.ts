import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../lib/prisma-client/client.js';
import {
  DEFAULT_STACK_MAX,
  ITEMS,
  canAddToContainer,
  canEquip,
  levelFromExp,
  stackQuality,
  type CarriedItem,
  type EquipmentInstance,
  type EquipmentSlot,
  type StackItemInstance,
} from '@lazycraft/shared';
import { SaveService } from '../save/save.service.js';
import { lockSaveForAccount } from '../save/save-tx.js';
import {
  DEFAULT_INVENTORY_CAPACITY,
  DEFAULT_STORAGE_CAPACITY,
  type SaveDataV3,
} from '../save/save-shape.js';

type ContainerName = 'inventory' | 'storage';

/** 玩家等级口径：攻击技能等级。装备模板的 required_level 没有技能绑定，
 *  而战斗结算同样以 attack 的经验派生玩家强度；用同一个口径可保证
 *  "能穿上" 与 "能打过" 的世界观一致，不引入第二套等级轴。 */
const PLAYER_LEVEL_SKILL = 'attack';

interface SkillsMap {
  [skillId: string]: { exp?: number } | undefined;
}

/** 物品 stack_max 解析器：未在 ITEMS 表登记的物品按缺省上限，装备不参与 */
function stackMaxOf(itemId: string): number {
  return ITEMS.find((i) => i.id === itemId)?.stack_max ?? DEFAULT_STACK_MAX;
}

/** 定位 uid：在所有可携带容器（背包 + 仓库）里找，找不到转 404 */
function findCarried(
  data: SaveDataV3,
  uid: string,
): { container: ContainerName; item: CarriedItem; index: number } | undefined {
  for (const container of ['inventory', 'storage'] as const) {
    const list = containerOf(data, container);
    const index = list.findIndex((item) => item.uid === uid);
    if (index >= 0) return { container, item: list[index], index };
  }
  return undefined;
}

/** 读容器；老存档字段缺失按空数组兜底 */
function containerOf(data: SaveDataV3, container: ContainerName): CarriedItem[] {
  const raw = (data as Partial<SaveDataV3>)[container];
  return Array.isArray(raw) ? raw : [];
}

/** 容器容量；字段缺失按默认值兜底 */
function capacityOf(data: SaveDataV3, container: ContainerName): number {
  const value =
    container === 'inventory'
      ? (data as Partial<SaveDataV3>).inventory_capacity
      : (data as Partial<SaveDataV3>).storage_capacity;
  if (typeof value === 'number') return value;
  return container === 'inventory' ? DEFAULT_INVENTORY_CAPACITY : DEFAULT_STORAGE_CAPACITY;
}

/** 用新容器覆写 data 的对应字段，其余原样保留 */
function withContainer(data: SaveDataV3, container: ContainerName, items: CarriedItem[]): SaveDataV3 {
  return { ...data, [container]: items } as SaveDataV3;
}

/** 从 skills 读攻击技能等级；无记录按 1 级 */
function playerLevel(data: SaveDataV3): number {
  const skills = (data.skills ?? {}) as SkillsMap;
  const exp =
    typeof skills[PLAYER_LEVEL_SKILL]?.exp === 'number'
      ? (skills[PLAYER_LEVEL_SKILL]!.exp as number)
      : 0;
  return levelFromExp(exp);
}

/**
 * 把一个具体的 CarriedItem 并入容器（保留其 uid）。
 *
 * 为什么不直接用 shared 的 addToContainer？
 *   它会为进入新格的堆叠生成新 uid。容器间"移动"应尽量保留原 uid，
 *   让前端背包列表不因一次搬运整片重挂载；这里对"要开的新格"沿用原 uid。
 */
function mergeCarried(target: CarriedItem[], item: CarriedItem): CarriedItem[] {
  if (item.kind === 'equipment') return [...target, item];

  const next = [...target];
  const quality = stackQuality(item);
  const max = stackMaxOf(item.item_id);
  let remaining = item.quantity;
  for (let i = 0; i < next.length && remaining > 0; i += 1) {
    const cur = next[i];
    if (cur.kind !== 'stack' || cur.item_id !== item.item_id || stackQuality(cur) !== quality) {
      continue;
    }
    const room = max - cur.quantity;
    if (room <= 0) continue;
    const fill = Math.min(room, remaining);
    next[i] = { ...cur, quantity: cur.quantity + fill };
    remaining -= fill;
  }
  if (remaining > 0) {
    const instance: StackItemInstance = { ...item, quantity: remaining };
    next.push(instance);
  }
  return next;
}

/**
 * 容器操作服务（task-24）
 *
 * 服务器权威：
 *   1. 每个写路径都在 Prisma.$transaction 内先锁存档行（见 save-tx.ts），
 *      再基于"最新 data"计算并整体覆写，杜绝"读-改-写"裸奔；
 *   2. 客户端传的 slot 只作意图，穿装备时服务端重跑 canEquip；
 *   3. 容量按格数校验（堆叠可并入已有叠，装备恒占一格）。
 */
@Injectable()
export class InventoryService {
  constructor(private readonly saveService: SaveService) {}

  /** 跨容器移动单件；inventory↔storage 双向，装备实例也可整体搬 */
  async move(accountId: string, uid: string, from: ContainerName, to: ContainerName) {
    const prisma = this.saveService.prisma;
    return prisma.$transaction(async (tx) => {
      const save = await lockSaveForAccount(tx, accountId);
      const data = save.data as unknown as SaveDataV3;

      const src = containerOf(data, from);
      const index = src.findIndex((item) => item.uid === uid);
      if (index < 0) throw new NotFoundException(`物品不存在: ${uid}`);
      const item = src[index];

      if (from === to) {
        return { uid, from, to, moved: false };
      }

      const dst = containerOf(data, to);
      if (!canAddToContainer(dst, [item], capacityOf(data, to), stackMaxOf)) {
        throw new ForbiddenException(`${containerLabel(to)}容量不足`);
      }

      let next = withContainer(data, from, src.filter((_, i) => i !== index));
      next = withContainer(next, to, mergeCarried(dst, item));

      await tx.save.update({
        where: { id: save.id },
        data: { data: next as unknown as Prisma.InputJsonValue },
      });
      return { uid, from, to, moved: true };
    });
  }

  /** 穿装备：定位 uid → 重跑 canEquip → 换装，原槽装备退回背包 */
  async equip(accountId: string, uid: string, slot: string) {
    const prisma = this.saveService.prisma;
    return prisma.$transaction(async (tx) => {
      const save = await lockSaveForAccount(tx, accountId);
      const data = save.data as unknown as SaveDataV3;

      const found = findCarried(data, uid);
      if (!found) throw new NotFoundException(`物品不存在: ${uid}`);
      if (found.item.kind !== 'equipment') {
        throw new ForbiddenException(`物品不是装备，无法穿戴: ${uid}`);
      }
      const item = found.item;

      // 服务端权威：客户端 slot 只作意图，这里用最新 data 重跑规则
      const check = canEquip(item, slot as EquipmentSlot, playerLevel(data));
      if (!check.ok) {
        throw new ForbiddenException(check.reason);
      }

      // 卸下原槽装备：先腾出背包里的新装备格（若它就在背包），再校验退回空间
      const equipment = { ...((data.equipment ?? {}) as Record<string, EquipmentInstance | null>) };
      const displaced = equipment[slot] ?? null;

      let inventory = containerOf(data, 'inventory');
      if (found.container === 'inventory') {
        inventory = inventory.filter((_, i) => i !== found.index);
      }
      if (displaced && !canAddToContainer(inventory, [displaced], capacityOf(data, 'inventory'), stackMaxOf)) {
        throw new ForbiddenException('背包容量不足，无法卸下原装备');
      }

      let next = withContainer(data, found.container, containerOf(data, found.container).filter((_, i) => i !== found.index));
      if (displaced) {
        next = withContainer(next, 'inventory', mergeCarried(containerOf(next, 'inventory'), displaced));
      }
      next = { ...next, equipment: { ...equipment, [slot]: item } };

      await tx.save.update({
        where: { id: save.id },
        data: { data: next as unknown as Prisma.InputJsonValue },
      });
      return { slot, equipped: item, displaced };
    });
  }

  /** 卸下装备到背包；容量不足则拒绝 */
  async unequip(accountId: string, slot: string) {
    const prisma = this.saveService.prisma;
    return prisma.$transaction(async (tx) => {
      const save = await lockSaveForAccount(tx, accountId);
      const data = save.data as unknown as SaveDataV3;

      const equipment = { ...((data.equipment ?? {}) as Record<string, EquipmentInstance | null>) };
      const item = equipment[slot] ?? null;
      if (!item) throw new NotFoundException(`槽位 ${slot} 上没有装备`);

      const inventory = containerOf(data, 'inventory');
      if (!canAddToContainer(inventory, [item], capacityOf(data, 'inventory'), stackMaxOf)) {
        throw new ForbiddenException('背包容量不足，无法卸下装备');
      }

      let next = withContainer(data, 'inventory', mergeCarried(inventory, item));
      next = { ...next, equipment: { ...equipment, [slot]: null } };

      await tx.save.update({
        where: { id: save.id },
        data: { data: next as unknown as Prisma.InputJsonValue },
      });
      return { slot, unequipped: item };
    });
  }

  /**
   * 丢弃：堆叠物可按数量，装备整件。
   *
   * quantity 缺省 = 整格/整件。丢弃是"玩家主动放弃"，不参与任何折算。
   */
  async discard(accountId: string, uid: string, quantity?: number) {
    const prisma = this.saveService.prisma;
    return prisma.$transaction(async (tx) => {
      const save = await lockSaveForAccount(tx, accountId);
      const data = save.data as unknown as SaveDataV3;

      const found = findCarried(data, uid);
      if (!found) throw new NotFoundException(`物品不存在: ${uid}`);
      const { container, item, index } = found;

      const list = containerOf(data, container);

      if (item.kind === 'equipment') {
        if (quantity !== undefined && quantity !== 1) {
          throw new BadRequestException('装备不可拆分，quantity 只能为 1 或省略');
        }
        const next = withContainer(data, container, list.filter((_, i) => i !== index));
        await tx.save.update({
          where: { id: save.id },
          data: { data: next as unknown as Prisma.InputJsonValue },
        });
        return { discarded: { uid, quantity: 1 } };
      }

      const discardQty = quantity ?? item.quantity;
      if (discardQty > item.quantity) {
        throw new BadRequestException(`丢弃数量超过持有量：持有 ${item.quantity}，请求 ${discardQty}`);
      }
      const left = item.quantity - discardQty;
      const nextList: CarriedItem[] =
        left > 0
          ? list.map((cur, i) => (i === index ? { ...cur, quantity: left } : cur))
          : list.filter((_, i) => i !== index);

      const next = withContainer(data, container, nextList);
      await tx.save.update({
        where: { id: save.id },
        data: { data: next as unknown as Prisma.InputJsonValue },
      });
      return { discarded: { uid, quantity: discardQty } };
    });
  }
}

function containerLabel(container: ContainerName): string {
  return container === 'inventory' ? '背包' : '仓库';
}
