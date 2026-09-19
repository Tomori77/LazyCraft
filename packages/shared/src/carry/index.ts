/**
 * 可携带物模型 —— 统一"背包 / 仓库 / 装备槽"里到底能放什么。
 *
 * 为什么需要这个联合体？
 *   旧存档 inventory 只有 { item_id, quantity }，装备实例（品质/词缀/属性快照）
 *   根本进不了包，导致"从背包拖装备"无数据可依。把"可携带物"显式建模成
 *   "堆叠物 ∪ 装备实例"，容器、接口、前端就共享同一个契约。
 *
 * 为什么 uid 生成可注入？
 *   shared 同时被 Node 后端与浏览器前端打包，node:crypto 在浏览器不存在；
 *   默认实现只在"调用点"从 globalThis.crypto 取（Node 22 / 现代浏览器都有），
 *   需要确定性回放时再由调用方注入自己的 uidFactory。
 */

import type { Quality } from '../types.js';
import type { Equipment } from '../loot/generate-equipment.js';
import { findTemplateById, type EquipmentSlot } from '../loot/equipment-template.js';
import type { Affix } from '../loot/affix-pool.js';

/* ------------------------------------------------------------------ */
/* 类型                                                                  */
/* ------------------------------------------------------------------ */

/** 堆叠型物品：材料/消耗品，同 item_id 合并 */
export interface StackItemInstance {
  kind: 'stack';
  /** 实例唯一 id（后端生成，用于移动/出售定位） */
  uid: string;
  item_id: string;
  quantity: number;
  /**
   * 品质，缺省视为 'common'。
   *
   * 为什么堆叠物也要带 quality（对《04 §2.5》的一处极小偏离）？
   *   市场模块整套交易逻辑按 (item_id, quality) 匹配与计价；
   *   若去掉该字段，同物品不同品质会被强行合并成一个堆叠，交易能力直接塌陷。
   *   之所以可选：P0 的采集产出恒为 common，不写该字段可让旧数据保持精简。
   */
  quality?: Quality;
}

/** 装备实例：不可堆叠，一件一 uid */
export interface EquipmentInstance {
  kind: 'equipment';
  uid: string;
  /** template id（关联 EquipmentTemplate.id） */
  template_id: string;
  quality: Quality;
  prefix_affix: Affix['id'] | null;
  suffix_affix: Affix['id'] | null;
  display_name: string;
  /** 快照属性，与 generate-equipment.ts 的 Equipment 对齐 */
  final_stats: { attack: number; defense: number; hp: number };
  /** 穿戴校验用：冗余模板槽位，避免每次查表 */
  slot: EquipmentSlot;
  /** 穿戴技能等级门槛（来自模板 required_level） */
  required_level: number;
}

export type CarriedItem = StackItemInstance | EquipmentInstance;

/** 堆叠物的品质缺省值：读取侧统一走 stackQuality()，避免各处重复写 `?? 'common'` */
export const DEFAULT_STACK_QUALITY: Quality = 'common';

/** 归一化读取堆叠物品质；字段缺失按 common，与市场/任务等消费方的默认一致 */
export function stackQuality(item: StackItemInstance): Quality {
  return item.quality ?? DEFAULT_STACK_QUALITY;
}

/* ------------------------------------------------------------------ */
/* uid 生成                                                              */
/* ------------------------------------------------------------------ */

/** globalThis 上 crypto 的最小形状：只依赖 randomUUID，避免为一个函数引入 DOM/node 全局类型 */
interface UuidCapableGlobal {
  crypto?: { randomUUID?: () => string };
}

/**
 * 默认 uid 工厂。
 *
 * 为什么用 globalThis.crypto 而不是 import node:crypto？
 *   shared 顶层如果 import node:crypto，Vite 打前端包时会直接报解析失败；
 *   Node 22 与所有现代浏览器都提供 globalThis.crypto.randomUUID，
 *   在调用点延迟取用即可同时兼容两端，且不污染模块加载期。
 */
export function newUid(): string {
  const cryptoLike = (globalThis as unknown as UuidCapableGlobal).crypto;
  if (!cryptoLike || typeof cryptoLike.randomUUID !== 'function') {
    // 不静默降级成时间戳随机数：弱 uid 会带来存档定位冲突，宁可让调用方显式注入
    throw new Error('当前运行环境缺少 globalThis.crypto.randomUUID，请注入 uidFactory');
  }
  return cryptoLike.randomUUID();
}

/* ------------------------------------------------------------------ */
/* 映射函数（落盘前由后端调用）                                            */
/* ------------------------------------------------------------------ */

/**
 * 生成中间产物 Equipment → 可落盘 EquipmentInstance。
 *
 * 为什么模板不存在时返回 null？
 *   与 generateEquipment 的 null 安全出口一致：配置错误只丢这一件，
 *   不让整个掉落 / 存档读路径崩掉。
 */
export function toEquipmentInstance(eq: Equipment, uid: string): EquipmentInstance | null {
  const template = findTemplateById(eq.template_id);
  if (!template) return null;

  return {
    kind: 'equipment',
    uid,
    template_id: eq.template_id,
    quality: eq.quality,
    prefix_affix: eq.prefix_affix,
    suffix_affix: eq.suffix_affix,
    display_name: eq.display_name,
    // 复制而非引用：实例一旦落盘就不应再被生成期的对象改写
    final_stats: { ...eq.final_stats },
    slot: template.slot,
    required_level: template.required_level,
  };
}

/**
 * idle 引擎的 ItemStack[] → 带 uid 的堆叠实例数组。
 *
 * 为什么条目允许携带 quality？
 *   市场按 (item_id, quality) 交易，落盘前必须把品质带进堆叠实例；
 *   缺省不写字段（P0 采集产出恒为 common），保持旧数据形态精简。
 *
 * uidFactory 可注入是为了让 e2e / 回放能产出确定 uid，避免断言依赖随机值。
 */
export function toStackItems(
  stacks: ReadonlyArray<{ item_id: string; quantity: number; quality?: Quality }>,
  uidFactory: () => string = newUid,
): StackItemInstance[] {
  return stacks.map((s) => {
    const instance: StackItemInstance = {
      kind: 'stack',
      uid: uidFactory(),
      item_id: s.item_id,
      quantity: s.quantity,
    };
    if (s.quality !== undefined) instance.quality = s.quality;
    return instance;
  });
}

/** 文档口径别名：结算产出统一补 uid 的入口，语义与 toStackItems 完全一致 */
export const toCarriedItems = toStackItems;

/**
 * 结算后要合并回容器的堆叠条目：idle 引擎返回的 ItemStack，可能带品质。
 */
export interface SettledStack {
  item_id: string;
  quantity: number;
  quality?: Quality;
}

/**
 * 把 idle 结算结果合并回 CarriedItem[]，并尽量复用已有堆叠的 uid。
 *
 * 为什么需要它而不是直接 toCarriedItems(settled) 全量重发 uid？
 *   每次结算换 uid 会让前端按 uid 做 key 的背包列表整片卸载重挂载，
 *   既丢滚动/动画状态，也让后端落盘数据在无变化时仍然"看起来变了"。
 *   复用 (item_id, quality) 相同实例的 uid，只有数量变化时 uid 保持稳定，
 *   前端只需更新数字，新增堆叠才分配新 uid。
 *
 * 规则：
 *   - 装备实例原样保留（结算引擎不接触装备）；
 *   - 堆叠物逐条匹配现有同 (item_id, quality) 实例，命中则沿用其 uid 并就地改数量；
 *   - 现有实例在结算结果里消失视为被消耗，随输出删除；
 *   - 结算结果里多出的堆叠（拆叠/新产出）分配新 uid 追加到末尾。
 */
export function mergeSettledStacks(
  current: ReadonlyArray<CarriedItem>,
  settled: ReadonlyArray<SettledStack>,
  uidFactory: () => string = newUid,
): CarriedItem[] {
  // 尚未被认领的结算条目；每条只能复用一次 uid，避免两格抢占同一 uid
  const pending = settled.map((s) => ({ ...s, claimed: false }));
  const next: CarriedItem[] = [];

  for (const item of current) {
    if (item.kind === 'equipment') {
      next.push(item);
      continue;
    }
    const quality = stackQuality(item);
    const match = pending.find(
      (s) => !s.claimed && s.item_id === item.item_id && (s.quality ?? DEFAULT_STACK_QUALITY) === quality,
    );
    if (!match) continue; // 结算结果中已不存在 = 被消耗
    match.claimed = true;
    next.push({ ...item, quantity: match.quantity });
  }

  for (const item of pending) {
    if (item.claimed || item.quantity <= 0) continue;
    next.push({
      kind: 'stack',
      uid: uidFactory(),
      item_id: item.item_id,
      quantity: item.quantity,
      ...(item.quality !== undefined ? { quality: item.quality } : {}),
    });
  }

  return next;
}

/**
 * 向容器追加一批堆叠物（掉落、任务奖励、市场退回）。
 *
 * 与 mergeSettledStacks 的区别：这里只做"加法"，
 * 不会因为条目未出现在 added 中而删除既有堆叠——
 * 战斗掉落/发奖是增量事件，不是对容器的完整快照。
 * 命中同 (item_id, quality) 时合并进第一格并保留其 uid。
 */
export function addStacksToCarried(
  current: ReadonlyArray<CarriedItem>,
  added: ReadonlyArray<SettledStack>,
  uidFactory: () => string = newUid,
): CarriedItem[] {
  const next = [...current];
  for (const add of added) {
    if (add.quantity <= 0) continue;
    const quality = add.quality ?? DEFAULT_STACK_QUALITY;
    const index = next.findIndex(
      (item) => item.kind === 'stack' && item.item_id === add.item_id && stackQuality(item) === quality,
    );
    if (index >= 0) {
      const existed = next[index] as StackItemInstance;
      next[index] = { ...existed, quantity: existed.quantity + add.quantity };
      continue;
    }
    const instance: StackItemInstance = {
      kind: 'stack',
      uid: uidFactory(),
      item_id: add.item_id,
      quantity: add.quantity,
    };
    if (add.quality !== undefined) instance.quality = add.quality;
    next.push(instance);
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* 容器容量（背包 / 仓库同一套"按格"规则，前后端共用）                       */
/* ------------------------------------------------------------------ */

/** 缺省堆叠上限：物品未在表里登记时按此算，与 idle 引擎的 DEFAULT_STACK_MAX 口径一致 */
export const DEFAULT_STACK_MAX = 999;

/**
 * 容器可接受的一件"加入物"：
 *   - 堆叠增量（移动整格 / 商店发货 / 任务奖励）只需要 (item_id, quantity, quality?)；
 *   - 装备实例必须整体占一格（不可与任何东西合并）。
 * 故意不要求 uid：容量只关心"占几格"，uid 由落盘方负责补。
 */
export type ContainerAdd =
  | { item_id: string; quantity: number; quality?: Quality }
  | EquipmentInstance;

/** 堆叠上限解析器；默认一律 999，调用方可注入物品表读取真实 stack_max */
export type StackMaxResolver = (itemId: string) => number;

const defaultStackMax: StackMaxResolver = () => DEFAULT_STACK_MAX;

function isEquipmentAdd(add: ContainerAdd): add is EquipmentInstance {
  return 'kind' in add && add.kind === 'equipment';
}

/**
 * 把一批加入物并入容器，返回新数组（不改原容器）。
 *
 * 与 addStacksToCarried 的关键差异：这里**尊重 stack_max**，
 * 同 (item_id, quality) 已有格补满后仍有余量就另开新格。
 * 为什么不让它复用 addStacksToCarried？后者无视 stack_max 地把数量并进第一格，
 * 用它做容量校验会算出"只需 1 格"，与实际落盘形态不一致。
 */
export function addToContainer(
  container: ReadonlyArray<CarriedItem>,
  additions: ReadonlyArray<ContainerAdd>,
  uidFactory: () => string = newUid,
  stackMaxOf: StackMaxResolver = defaultStackMax,
): CarriedItem[] {
  const next: CarriedItem[] = [...container];
  for (const add of additions) {
    if (isEquipmentAdd(add)) {
      next.push(add);
      continue;
    }
    if (add.quantity <= 0) continue;
    const quality = add.quality ?? DEFAULT_STACK_QUALITY;
    const max = Math.max(1, stackMaxOf(add.item_id));
    let remaining = add.quantity;

    // 先补已有同 (item_id, quality) 且未满的格子，保留其 uid
    for (let i = 0; i < next.length && remaining > 0; i += 1) {
      const cur = next[i];
      if (cur.kind !== 'stack' || cur.item_id !== add.item_id || stackQuality(cur) !== quality) {
        continue;
      }
      const room = max - cur.quantity;
      if (room <= 0) continue;
      const fill = Math.min(room, remaining);
      next[i] = { ...cur, quantity: cur.quantity + fill };
      remaining -= fill;
    }

    // 余量另开新格；每格最多 max
    while (remaining > 0) {
      const take = Math.min(max, remaining);
      const instance: StackItemInstance = {
        kind: 'stack',
        uid: uidFactory(),
        item_id: add.item_id,
        quantity: take,
      };
      if (add.quality !== undefined) instance.quality = add.quality;
      next.push(instance);
      remaining -= take;
    }
  }
  return next;
}

/** 为容纳这批加入物，容器需要新增的格数（0 表示全部并入现有叠） */
export function countNewSlotsNeeded(
  container: ReadonlyArray<CarriedItem>,
  additions: ReadonlyArray<ContainerAdd>,
  stackMaxOf: StackMaxResolver = defaultStackMax,
): number {
  // uid 工厂用不着，传一个常量避免无意义的随机数开销
  return addToContainer(container, additions, () => '', stackMaxOf).length - container.length;
}

/** 容器能否放下这批加入物（格数口径）；空加入物恒可放 */
export function canAddToContainer(
  container: ReadonlyArray<CarriedItem>,
  additions: ReadonlyArray<ContainerAdd>,
  capacity: number,
  stackMaxOf: StackMaxResolver = defaultStackMax,
): boolean {
  if (additions.length === 0) return true;
  return container.length + countNewSlotsNeeded(container, additions, stackMaxOf) <= capacity;
}

/* ------------------------------------------------------------------ */
/* 装备规则（前后端共用，前端拖拽高亮与后端校验同一份判断）                    */
/* ------------------------------------------------------------------ */

/**
 * 穿戴失败原因：稳定英文枚举。
 *
 * 为什么不是中文？
 *   文案属于前端 i18n，数据层只出机器可判定的原因串，
 *   否则同一原因在不同语言 / 不同 UI 位置要维护多份文案。
 */
export const EQUIP_FAILURE_REASONS = {
  SLOT_MISMATCH: 'slot_mismatch',
  LEVEL_TOO_LOW: 'level_too_low',
} as const;

export type EquipFailureReason =
  (typeof EQUIP_FAILURE_REASONS)[keyof typeof EQUIP_FAILURE_REASONS];

export type EquipCheckResult = { ok: true } | { ok: false; reason: EquipFailureReason };

/** 戒指两槽视为同类，可互换 */
function isSameSlotKind(a: EquipmentSlot, b: EquipmentSlot): boolean {
  const isRing = (s: EquipmentSlot) => s === 'ring1' || s === 'ring2';
  return isRing(a) && isRing(b) ? true : a === b;
}

/** 判断某装备实例能否放入某槽位；槽位不符优先于等级不足报告 */
export function canEquip(
  item: EquipmentInstance,
  slot: EquipmentSlot,
  playerLevel: number,
): EquipCheckResult {
  if (!isSameSlotKind(item.slot, slot)) {
    return { ok: false, reason: EQUIP_FAILURE_REASONS.SLOT_MISMATCH };
  }
  if (playerLevel < item.required_level) {
    return { ok: false, reason: EQUIP_FAILURE_REASONS.LEVEL_TOO_LOW };
  }
  return { ok: true };
}

/** 汇总一组已穿戴装备的属性；空槽（null）不参与 */
export function sumEquipmentStats(
  equipped: ReadonlyArray<EquipmentInstance | null>,
): { attack: number; defense: number; hp: number } {
  const total = { attack: 0, defense: 0, hp: 0 };
  for (const item of equipped) {
    if (!item) continue;
    total.attack += item.final_stats.attack;
    total.defense += item.final_stats.defense;
    total.hp += item.final_stats.hp;
  }
  return total;
}
