/**
 * 技能数据表（示例量）
 *
 * 只写 P0 骨架：1 战斗 + 3 非战斗，验证"内容即数据"的注册通路。
 * 业务平衡性（间隔、经验、掉落）留到具体技能 DLC 再调。
 */

import type { Skill } from '../types.js';

export const SKILL_ATTACK: Skill = {
  id: 'attack',
  name: '攻击',
  type: 'combat',
  max_level: 99,
  breakthrough_enabled: true,
};

export const SKILL_MINING: Skill = {
  id: 'mining',
  name: '采矿',
  type: 'non_combat',
  max_level: 99,
  breakthrough_enabled: true,
};

export const SKILL_WOODCUTTING: Skill = {
  id: 'woodcutting',
  name: '伐木',
  type: 'non_combat',
  max_level: 99,
  breakthrough_enabled: true,
};

export const SKILL_FISHING: Skill = {
  id: 'fishing',
  name: '钓鱼',
  type: 'non_combat',
  max_level: 99,
  breakthrough_enabled: true,
};

/** 生火：消耗木材类产生熟食品/木炭；task-08 至少需要一个"材料消耗"动作挂在它身上才能走校验通路 */
export const SKILL_FIREMAKING: Skill = {
  id: 'firemaking',
  name: '生火',
  type: 'non_combat',
  max_level: 99,
  breakthrough_enabled: true,
};

export const SKILLS: readonly Skill[] = [
  SKILL_ATTACK,
  SKILL_MINING,
  SKILL_WOODCUTTING,
  SKILL_FISHING,
  SKILL_FIREMAKING,
];
