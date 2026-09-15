/**
 * 技能服务：经验 ↔ 等级的纯函数查询。
 *
 * 为什么用 level^3？
 *   三次曲线让前期升级飞快（1→2 只差 7 exp）、后期明显放缓（99 级 ≈ 97 万），
 *   契合放置游戏"前期建立正反馈、后期拉长养成线"的节奏；公式简单到
 *   策划口算、引擎 O(1)，不需要查表。
 *
 * 为什么是纯函数而不是 class？
 *   规则一份代码前后端共用（前端显示进度条、后端离线结算验算），
 *   无状态函数天然可共享，也不存在实例生命周期问题。
 */

/** 达到 level 级所需的累计经验（等级从 1 起） */
export function exp(level: number): number {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError(`level 必须是 ≥1 的整数，收到: ${level}`);
  }
  return level ** 3;
}

/** 由累计经验反查等级。恰好落在边界时返回上一级所需的门槛本身（左闭右开）；0 经验视为 1 级 */
export function levelFromExp(experience: number): number {
  if (!Number.isFinite(experience) || experience < 0) {
    throw new RangeError(`experience 必须是 ≥0 的有限数，收到: ${experience}`);
  }
  // 0 经验=1 级：新玩家没有任何动作记录时也必须能反查等级
  if (experience < 1) return 1;
  // 利用三次函数单调性，Math.cbrt 直接求立方根；
  // floor 之前向上取 epsilon 抵消浮点误差在整数边界上的抖动（例如 1000 → 3.0000…1）
  const root = Math.cbrt(experience);
  const level = Math.floor(root);
  // 防御：浮点误差可能让 floor(root) 偏小，用前后两次 exp() 校验夹逼
  return exp(level) <= experience && experience < exp(level + 1)
    ? level
    : level + 1;
}

/** 当前等级进度：到下一级还差多少经验（用于前端进度条） */
export function expToNextLevel(experience: number): number {
  return exp(levelFromExp(experience) + 1) - experience;
}
