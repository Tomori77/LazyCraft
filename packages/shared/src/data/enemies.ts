/**
 * 敌人数据表 —— 战斗模块的内容入口。
 *
 * 为什么单独建文件而不是继续堆在 packs/core？
 *   packs/core 是"引擎空跑的最小内容包"，里面的 ENEMY_CHICKEN 是注册通路示例；
 *   data/enemies.ts 是战斗模块面向战斗数值的"数据表视角"，
 *   它给 ENEMY_CHICKEN 补齐战斗属性（攻击间隔），并提供按 id 查询的入口。
 *   未来战斗 DLC 新增敌人时，DLC 作者会来这里看"战斗属性怎么配"。
 */

import type { Enemy } from '../types.js';
import { ENEMY_CHICKEN } from '../packs/core/index.js';

/* ------------------------------------------------------------------ */
/* 战斗补充属性（不进 Enemy 类型本体的原因）                                 */
/* ------------------------------------------------------------------ */

/**
 * 敌人在战斗中的补充数值。
 *
 * 为什么不直接把 attack_interval_ms 塞进 types.ts 的 Enemy？
 *   Enemy 是注册表契约，DLC 都要实现一次；攻击间隔是"战斗模块内部
 *   的推演参数"，P0 阶段所有小怪统一 3s 不需要暴露给 DLC。
 *   把它收在战斗模块的数据表里，未来真的需要"快攻怪"时再开放。
 */
export interface EnemyCombatProfile {
  /** 攻击间隔（毫秒） */
  attack_interval_ms: number;
}

/** 鸡：近战训练怪，攻击间隔 3s（比玩家的 2.7s 略慢，保证玩家先手） */
export const ENEMY_PROFILE_CHICKEN: EnemyCombatProfile = {
  attack_interval_ms: 3_000,
};

/** 敌人 id -> 战斗补充属性。P0 只配鸡；新敌人登记时同步在这里补一行。 */
export const ENEMY_COMBAT_PROFILES: Readonly<Record<string, EnemyCombatProfile>> = Object.freeze({
  [ENEMY_CHICKEN.id]: ENEMY_PROFILE_CHICKEN,
});

/* ------------------------------------------------------------------ */
/* 查询入口（后端 / 前端共用）                                               */
/* ------------------------------------------------------------------ */

/** 按 id 查敌人本体；找不到返回 undefined */
export function findEnemyById(id: string): Enemy | undefined {
  if (id === ENEMY_CHICKEN.id) return ENEMY_CHICKEN;
  return undefined;
}

/** 按 id 查战斗补充属性；未配置时给一个保守的 3s 兜底（与 P0 全体小怪一致） */
export function findEnemyProfileById(id: string): EnemyCombatProfile | undefined {
  return ENEMY_COMBAT_PROFILES[id];
}
