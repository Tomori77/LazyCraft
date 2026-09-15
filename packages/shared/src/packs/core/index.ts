/**
 * 内置核心内容包 —— 引擎自带的"最小可玩"内容。
 *
 * 为什么放 packages/shared 而不是独立 DLC 包？
 *   task-09 验收要求"启动时"能 validate，需要一份保底内容让引擎空跑；
 *   同时它也充当 DLC 作者的写样例：看 core 包就知道 register() 该怎么写。
 *
 * 为什么数值这么小（3s 一次 / 5 滴血）？
 *   这些是 P0 骨架的"演示数值"，让前端进度条、离线结算、战斗反馈能立即看到效果；
 *   真实平衡性由后续具体技能 DLC 覆盖，core 包只负责打通"注册 → 校验 → 查询"通路。
 */

import type { ContentPack, Enemy, Item, SkillAction } from '../../types.js';
import { SKILL_ATTACK, SKILL_MINING, SKILL_WOODCUTTING } from '../../data/skills.js';

/* ------------------------------------------------------------------ */
/* 物品                                                                  */
/* ------------------------------------------------------------------ */

/** 小铜矿脉：采矿动作的最基础产出物（演示用，与正式 ITEM_COPPER_ORE 错开 ID） */
export const ITEM_TINY_COPPER_VEIN: Item = {
  id: 'tiny_copper_vein',
  name: '小铜矿脉',
  type: 'material',
  tier: 1,
  stack_max: 999,
  tradeable: true,
  quality: ['common'],
  source_skill: SKILL_MINING.id,
  use_tags: ['craft_material', 'sellable'],
  rarity: 'normal',
  broadcast_threshold: 'epic',
};

/** 普通木头：伐木动作的产出物，也是 campfire 类配方的最基础燃料 */
export const ITEM_WOOD: Item = {
  id: 'wood',
  name: '木头',
  type: 'material',
  tier: 1,
  stack_max: 999,
  tradeable: true,
  quality: ['common'],
  source_skill: SKILL_WOODCUTTING.id,
  use_tags: ['craft_material', 'fuel', 'sellable'],
  rarity: 'normal',
  broadcast_threshold: 'epic',
};

/* ------------------------------------------------------------------ */
/* 动作                                                                  */
/* ------------------------------------------------------------------ */

/** 小矿脉：3 秒一次、产出 1 个小铜矿脉（演示"动作 → 物品"通路） */
export const ACTION_MINE_TINY_VEIN: SkillAction = {
  id: 'mine_tiny_vein',
  skill_id: SKILL_MINING.id,
  name: '采集小矿脉',
  interval_ms: 3_000,
  exp: 1,
  input_items: {},
  output_items: { [ITEM_TINY_COPPER_VEIN.id]: 1 },
  output_exp: 0,
  required_level: 1,
};

/** 砍树：3 秒一次、产出 1 个木头 */
export const ACTION_CHOP_TREE: SkillAction = {
  id: 'chop_tree',
  skill_id: SKILL_WOODCUTTING.id,
  name: '砍树',
  interval_ms: 3_000,
  exp: 1,
  input_items: {},
  output_items: { [ITEM_WOOD.id]: 1 },
  output_exp: 0,
  required_level: 1,
};

/* ------------------------------------------------------------------ */
/* 敌人                                                                  */
/* ------------------------------------------------------------------ */

/**
 * 鸡：P0 唯一一只近战训练怪。
 *
 * 为什么是鸡？
 *   数值最低（5 HP / 1 攻击）让玩家空手也能打赢，同时
 *   掉落表是 P1 才做，loot_table_id 先占位不写，避免现在就要设计掉落。
 */
export const ENEMY_CHICKEN: Enemy = {
  id: 'chicken',
  name: '鸡',
  level: 1,
  hp: 5,
  attack: 1,
  defense: 0,
};

/* ------------------------------------------------------------------ */
/* 内容包                                                                */
/* ------------------------------------------------------------------ */

/**
 * 核心内容包：引擎空跑所需的最小内容集合。
 *
 * 注册的所有 ID 必须自洽：validate() 会校验
 *   - action 引用的 skill_id 存在
 *   - action 引用的 item id 存在
 *   - item.source_skill 引用的 skill 存在
 * 任何一条不满足都会在启动时打印全部错误。
 */
export const CorePack: ContentPack = {
  id: 'core',
  name: '核心内容包',
  version: '0.1.0',

  register(registry) {
    // 注册顺序无关：validate() 在所有包载入完成后才执行
    registry.skill(SKILL_ATTACK);
    registry.skill(SKILL_MINING);
    registry.skill(SKILL_WOODCUTTING);

    registry.item(ITEM_TINY_COPPER_VEIN);
    registry.item(ITEM_WOOD);

    registry.action(ACTION_MINE_TINY_VEIN);
    registry.action(ACTION_CHOP_TREE);

    registry.enemy(ENEMY_CHICKEN);
  },
};
