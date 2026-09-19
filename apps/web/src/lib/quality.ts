import type { Quality } from '@lazycraft/shared';

/**
 * 品质 → 描边 class 映射（沿用 broadcast-bar 的色系约定，抽成公共工具）。
 *
 * 为什么只认 shared 的四档品质？
 *   后端结算/掉落只产 common/uncommon/rare/epic；旧版 UI 曾出现 poor/legendary
 *   两档，但数据层从不存在，保留它们会让类型与真实契约分叉。
 */
export function toQualityClass(quality?: Quality): string {
  switch (quality) {
    case 'uncommon':
      return 'quality-uncommon';
    case 'rare':
      return 'quality-rare';
    case 'epic':
      return 'quality-epic';
    default:
      return 'quality-common';
  }
}
