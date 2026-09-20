/**
 * 人物等级计算器（task-34 / P4-4）。
 *
 * 为什么做成"可替换函数 + 注册表"而不是一个写死的公式？
 *   P4-4 已定：人物等级口径由 DLC 决定（梅尔沃是加权战斗等级，本项目默认沿用
 *   攻击技能等级）。本体给出最小可用默认，DLC 通过 registerLevelCalculator
 *   替换实现，无需改后端 player-shape 的调用点——这是"留接口"的全部意义。
 *
 * 为什么计算器入参是"技能等级 map + 属性"而不是经验？
 *   等级与属性是"已算好的结果"，计算器只做组合；这样 DLC 既能用技能等级，
 *   也能引入属性（例如生命值）参与，且不反向耦合经验曲线。
 *
 * 为什么等级计算器的注册与内容 Registry 分开？
 *   Registry 管"可序列化的内容数据"（进快照、可下发）；等级计算器是运行时
 *   行为函数（不可序列化、不进快照），混进 ContentKind 会把"数据"与"逻辑"
 *   的边界打破。因此这里用一个独立的、进程内可替换的注册位。
 */

import type { PersonLevelCalculator } from '../types.js';

/** 缺省口径使用的技能 id：攻击技能等级（与 task-26 起的既有语义一致） */
export const DEFAULT_LEVEL_SKILL = 'attack';

/**
 * 默认人物等级计算器：返回攻击技能等级。
 *
 * 为什么默认是这个？
 *   P4-4 决策原文"默认实现可保留攻击技能等级"；保持默认即等价于改动前的
 *   `/api/player.level`，向后兼容、不破坏既有 e2e 断言。
 */
export const attackSkillLevelCalculator: PersonLevelCalculator = (skills) => {
  const level = skills[DEFAULT_LEVEL_SKILL];
  return typeof level === 'number' && Number.isFinite(level) && level >= 1
    ? Math.floor(level)
    : 1;
};

let currentCalculator: PersonLevelCalculator = attackSkillLevelCalculator;

/**
 * 注册（替换）全局人物等级计算器，返回"恢复上一个实现"的函数。
 *
 * 为什么返回恢复函数而不是简单 setter？
 *   单测里替换后必须能还原，否则默认实现会被前一个用例污染；
 *   返回 undo 让 `try/finally` 或 `afterEach` 一行收尾。
 */
export function registerLevelCalculator(
  calculator: PersonLevelCalculator,
): () => void {
  const previous = currentCalculator;
  currentCalculator = calculator;
  return () => {
    currentCalculator = previous;
  };
}

/** 恢复默认等级计算器（测试 / DLC 卸载时用） */
export function resetLevelCalculator(): void {
  currentCalculator = attackSkillLevelCalculator;
}

/** 当前生效的人物等级计算器（后端 player-shape 的唯一调用入口） */
export function getLevelCalculator(): PersonLevelCalculator {
  return currentCalculator;
}

/**
 * 计算人物等级：按当前注册的计算器实现。
 *
 * 为什么包一层而不是让调用方直接 getLevelCalculator()(...) ？
 *   调用点只需要"算等级"这一件事；包一层后 DLC 替换、缺省兜底都收敛在模块内，
 *   调用方永远拿到一个数字，不必关心是否已注册。
 */
export function calculatePersonLevel(
  skills: Readonly<Record<string, number>>,
  attributes: Readonly<Record<string, number>> = {},
): number {
  return currentCalculator(skills, attributes);
}
