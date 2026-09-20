import type { Quality } from '@lazycraft/shared';

/**
 * 品质 → class 映射（与 UI 原型 `.slot.q-*` / `.yield-chip.q-*` 命名一致）。
 *
 * 为什么只认 shared 的四档品质？
 *   后端结算/掉落只产 common/uncommon/rare/epic；旧版 UI 曾出现 poor/legendary
 *   两档，但数据层从不存在，保留它们会让类型与真实契约分叉。
 */
export function toQualityClass(quality?: Quality): string {
  switch (quality) {
    case 'uncommon':
      return 'q-uncommon';
    case 'rare':
      return 'q-rare';
    case 'epic':
      return 'q-epic';
    default:
      return 'q-common';
  }
}
