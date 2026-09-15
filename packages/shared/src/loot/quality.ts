/**
 * 品质系统 —— 刷宝/掉落模块的"颜色维度"（《框架设计》6.1）。
 *
 * 为什么 Quality 本体类型不在这里定义而是复用 types.ts？
 *   types.ts 是共享契约的单一事实源，Item.quality、broadcast_threshold 早已引用它；
 *   这里只做"品质排序 / 显示名 / 权重工具"等掉落计算专用的扩展，避免两份定义漂移。
 *
 * 为什么提供显式的排序数组而不是靠 declare 顺序心算？
 *   "稀有度递进"是玩法规则（紫 > 蓝 > 白），写进代码里让 rollQuality /
 *   广播阈值等调用方直接用索引比较，省去每次重复 switch。
 */

import type { Quality } from '../types.js';

/* 重新导出本体类型：loot 模块内统一从 quality.ts 里取，外部仍然只依赖 types.ts */
export type { Quality } from '../types.js';

/**
 * 品质稀有度递进表：索引越大越稀有。
 *
 * rollQuality 会把权重数组按这个顺序解释；UI 上色也按索引取梯度。
 */
export const QUALITY_ORDER: readonly Quality[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
];

/**
 * 品质显示名（中文）：UI 直接展示，避免到处硬编码。
 *
 * 对应设计里的 白 / 蓝 / 紫 / 橙 四档颜色；颜色映射留给前端样式层，
 * 共享层只给语义名，避免把视觉 token 带进结算代码。
 */
export const QUALITY_DISPLAY_NAME: Readonly<Record<Quality, string>> = {
  common: '普通',
  uncommon: '优秀',
  rare: '稀有',
  epic: '传说',
};

/**
 * 品质权重向量：与 QUALITY_ORDER 等长，数值越大权重越高。
 *
 * 不要求加和为 1——权重本身只有相对意义，归一化由 rollQuality 内部完成。
 */
export type QualityWeights = Partial<Record<Quality, number>>;

/**
 * 按权重向量抽取一个品质。
 *
 * 为什么不用纯随机而是显式传 rng？——见 loot-table 同文件头的
 * "可测性"说明：离线战斗回放、后端回放校验需要确定性随机数源。
 *
 * @param weights QualityWeights，例如 { common: 70, uncommon: 20, rare: 8, epic: 2 }
 * @param rng 0~1 均匀分布随机数（[0, 1)）
 * @returns 命中的品质；若 weights 全空或全为 0，回退 'common'
 */
export function rollQuality(weights: QualityWeights, rng: () => number): Quality {
  const entries = QUALITY_ORDER
    .map((q) => [q, Math.max(0, weights[q] ?? 0)] as const)
    .filter(([, w]) => w > 0);

  if (entries.length === 0) return 'common';

  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let cursor = rng() * total;
  for (const [quality, w] of entries) {
    cursor -= w;
    if (cursor < 0) return quality;
  }
  // 浮点尾差兜底：cursor 可能因为精度略大于 0，此时返回最后一档
  return entries[entries.length - 1][0];
}
