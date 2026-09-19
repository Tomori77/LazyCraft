/**
 * 装备槽位数据表（示例量）
 *
 * 为什么值常量放 data/ 而类型放 types.ts？
 *   槽位类型已纳入契约层（ContentKind 含 'slot'），types.ts 只留类型；
 *   具体槽位的排布属于"内容数据"，与 resources/skills 同层，将来整体迁 DB。
 */

import type { EquipmentSlotMeta } from '../types.js';

export const EQUIPMENT_SLOTS: readonly EquipmentSlotMeta[] = [
  { id: 'head', anchor: 'top', order: 1 },
  { id: 'neck', anchor: 'top', order: 2 },
  { id: 'main_hand', anchor: 'left', order: 3 },
  { id: 'chest', anchor: 'left', order: 4 },
  { id: 'hands', anchor: 'left', order: 5 },
  { id: 'off_hand', anchor: 'right', order: 6 },
  { id: 'legs', anchor: 'right', order: 7 },
  { id: 'feet', anchor: 'right', order: 8 },
  { id: 'ring1', anchor: 'bottom', order: 9 },
  { id: 'ring2', anchor: 'bottom', order: 10 },
];
