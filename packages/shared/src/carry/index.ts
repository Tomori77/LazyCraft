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
 * uidFactory 可注入是为了让 e2e / 回放能产出确定 uid，避免断言依赖随机值。
 */
export function toStackItems(
  stacks: ReadonlyArray<{ item_id: string; quantity: number }>,
  uidFactory: () => string = newUid,
): StackItemInstance[] {
  return stacks.map((s) => ({
    kind: 'stack',
    uid: uidFactory(),
    item_id: s.item_id,
    quantity: s.quantity,
  }));
}

/** 文档口径别名：结算产出统一补 uid 的入口，语义与 toStackItems 完全一致 */
export const toCarriedItems = toStackItems;

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
