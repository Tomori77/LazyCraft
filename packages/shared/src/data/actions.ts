/**
 * 动作数据表（示例量）
 *
 * task-08 的依赖：ActionModule 按 ID 从这里解析动作配置，
 * 结算时把 SkillAction 原样传给 idle 引擎（settle）。
 * 业务平衡性留到具体技能 DLC 再调，这里只保证每种校验路径
 * （等级门槛 / 材料消耗 / 纯采集）都有示例可走通。
 */

import type { SkillAction } from '../types.js';

/** 采铜矿：1 级即可，无消耗，产铜矿 */
export const ACTION_MINE_COPPER: SkillAction = {
  id: 'mine_copper',
  skill_id: 'mining',
  name: '采铜矿',
  interval_ms: 3000,
  exp: 10,
  input_items: {},
  output_items: { copper_ore: 1 },
  output_exp: 0,
  required_level: 1,
  tier: 1,
};

/** 采铁矿：15 级解锁——用于验证"等级不足被拒绝"的校验路径 */
export const ACTION_MINE_IRON: SkillAction = {
  id: 'mine_iron',
  skill_id: 'mining',
  name: '采铁矿',
  interval_ms: 5000,
  exp: 25,
  input_items: {},
  output_items: { iron_ore: 1 },
  output_exp: 0,
  required_level: 15,
  tier: 2,
};

/** 伐木：枫树原木 */
export const ACTION_CHOP_MAPLE: SkillAction = {
  id: 'chop_maple',
  skill_id: 'woodcutting',
  name: '砍枫树',
  interval_ms: 3000,
  exp: 10,
  input_items: {},
  output_items: { maple_log: 1 },
  output_exp: 0,
  required_level: 1,
  tier: 1,
};

/** 烧炭：有材料消耗——用于验证"材料不足被拒绝"的校验路径 */
export const ACTION_BURN_CHARCOAL: SkillAction = {
  id: 'burn_charcoal',
  skill_id: 'firemaking',
  name: '烧木炭',
  interval_ms: 2000,
  exp: 5,
  input_items: { maple_log: 1 },
  output_items: {},
  output_exp: 0,
  required_level: 1,
  tier: 1,
};

export const ACTIONS: readonly SkillAction[] = [
  ACTION_MINE_COPPER,
  ACTION_MINE_IRON,
  ACTION_CHOP_MAPLE,
  ACTION_BURN_CHARCOAL,
];

/** 按 ID 查动作配置；不存在返回 undefined（调用方负责转 404） */
export function findActionById(actionId: string): SkillAction | undefined {
  return ACTIONS.find((a) => a.id === actionId);
}
