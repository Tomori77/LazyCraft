/**
 * 装备模板（《框架设计》6.1 的 equipment_templates 数据表）。
 *
 * 模板 = 装备的"底材"：决定基础属性 / 槽位数量 / 可选品质区间；
 * 具体装备实例 = 模板 × 品质 × 词缀，由 generateEquipment() 生成。
 *
 * 为什么模板带 quality 范围而不是固定品质？
 *   同一件"短剑"应该能掉白色也能掉橙色（数值按品质倍率缩放），
 *   如果模板锁死品质，每把武器要写 4 份模板；写成区间，
 *   掉落表只决定"出什么模板 + 出什么品质"，两件事正交。
 *
 * 为什么 affix_slots 是数量而不是具体槽位列表？
 *   6.1 数据形态是 prefix_affix / suffix_affix 两个字段，天然一前一后两个槽；
 *   用数量表达可以让 DLC 以后扩到 { prefix: 2, suffix: 1 } 这种进阶配置，
 *   同时 P1 的判定只需要 "有没有前缀槽 / 后缀槽"。
 */

import type { EquipmentSlot, Quality } from '../types.js';

/**
 * 类型搬迁兼容出口：定义已上移到 types.ts（契约层单一事实源），
 * 这里重新导出，保证既有 `from './equipment-template.js'` 的引用路径不变。
 */
export type { EquipmentSlot, EquipmentSlotMeta } from '../types.js';

/** 值搬迁兼容出口：常量已移入 data/equipment-slots.ts，此处再导出以兼容既有引用 */
export { EQUIPMENT_SLOTS } from '../data/equipment-slots.js';

/** 装备模板表条目 */
export interface EquipmentTemplate {
  id: string;
  /** 显示名打底（最终装备名 = 词缀前缀 + base_name + 词缀后缀） */
  base_name: string;
  /** 部位：玩家装备 UI / 战斗判定用 */
  slot: EquipmentSlot;
  /** 基础属性（攻击/防御/生命），可为负数（如木盾减攻击） */
  base_stats: {
    attack?: number;
    defense?: number;
    hp?: number;
  };
  /**
   * 允许掉落的最低/最高品质。
   *
   * 为什么区间而不是数组？——品质本身有序，"白~紫" 比 ['common','uncommon','rare']
   * 更短、更难写错，并且天然排除"跳过 uncommon"这种设计漏洞。
   */
  quality_range: { min: Quality; max: Quality };
  /** 词缀槽位数量（0 = 该槽位不出现） */
  affix_slots: { prefix: number; suffix: number };
  /** 玩家等级门槛：低等级掉落生成出来的装备等级限制，避免 1 级玩家拿到 99 级神装 */
  required_level: number;
}

/* ------------------------------------------------------------------ */
/* 示例模板（P1 最小可玩口径）                                            */
/* ------------------------------------------------------------------ */

/** 短剑：近战最基础的武器模板，白~橙都能出，让新手村能看到完整颜色梯度 */
export const TEMPLATE_SHORT_SWORD: EquipmentTemplate = {
  id: 'short_sword',
  base_name: '短剑',
  slot: 'main_hand',
  base_stats: { attack: 2 },
  // 为什么放开到 epic：task-14 初版锁到 rare 导致整局游戏没有任何装备能产 epic，
  // task-17 的全服广播（threshold='epic'）因此永远触发不到、无从验收；
  // 短剑既然是"展示颜色梯度"的新手模板，放开 max 让 broadcast 链路在生产可运行。
  quality_range: { min: 'common', max: 'epic' },
  affix_slots: { prefix: 1, suffix: 1 },
  required_level: 1,
};

/** 破旧的皮甲：鸡的另一件专属掉落，给"防具"维度一个示例 */
export const TEMPLATE_WORN_LEATHER_ARMOR: EquipmentTemplate = {
  id: 'worn_leather_armor',
  base_name: '破旧的皮甲',
  slot: 'chest',
  base_stats: { defense: 1, hp: 2 },
  quality_range: { min: 'common', max: 'uncommon' },
  affix_slots: { prefix: 1, suffix: 0 },
  required_level: 1,
};

export const EQUIPMENT_TEMPLATES: Readonly<Record<string, EquipmentTemplate>> =
  Object.freeze({
    [TEMPLATE_SHORT_SWORD.id]: TEMPLATE_SHORT_SWORD,
    [TEMPLATE_WORN_LEATHER_ARMOR.id]: TEMPLATE_WORN_LEATHER_ARMOR,
  });

/** 按 id 查模板；找不到返回 undefined */
export function findTemplateById(id: string): EquipmentTemplate | undefined {
  return EQUIPMENT_TEMPLATES[id];
}
