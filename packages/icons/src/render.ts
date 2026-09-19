/**
 * 图标渲染：把 IconDef 变成可用的 SVG 字符串。
 *
 * 为什么在库里做渲染而不是让前端各自拼 SVG？
 *   描边宽度、圆角、填充规则属于图标库的"画法约定"，
 *   集中在这里，本体与所有 DLC 渲染出的图标才会完全一致；
 *   前端只负责"把字符串塞进 DOM / 包成 sprite"。
 *
 * 注意：本模块只产出字符串，不引用任何 DOM / 框架，
 * 因此 Node（构建脚本、后端）与浏览器都能安全 import。
 */

import type { IconDef } from './types.js';
import { HAND_DRAWN_ICONS } from './catalog.js';

/** 默认视口：与 24×24 图标生态对齐 */
export const DEFAULT_VIEW_BOX = '0 0 24 24';

/**
 * 描边图标的标准画法。
 *
 * 为什么这些值写死在库里？
 *   它们是"匠人工坊"风格的视觉契约（1.7 线宽、圆头圆角）；
 *   散落到各处就会有人写出 1.6 或方头，图标立刻显得不齐。
 */
export const STROKE_WIDTH = 1.7;

/** 转义属性值里的引号，防止 path 数据破坏标签 */
function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** 单条 path → SVG 元素字符串 */
function pathToSvg(icon: IconDef): string {
  return icon.paths
    .map((p) =>
      p.fill
        ? `<path d="${esc(p.d)}" fill="currentColor" stroke="none"/>`
        : `<path d="${esc(p.d)}" fill="none" stroke="currentColor" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('');
}

/**
 * 渲染成一段独立的 `<svg>`（内联使用）。
 *
 * 颜色走 `currentColor`，尺寸由外部 CSS / 属性控制——
 * 同一枚图标因此能在不同位置以不同大小与颜色出现。
 */
export function renderIconSvg(icon: IconDef, className = 'lc-icon'): string {
  const viewBox = icon.viewBox ?? DEFAULT_VIEW_BOX;
  return `<svg class="${esc(className)}" viewBox="${esc(viewBox)}" fill="none" aria-hidden="true">${pathToSvg(icon)}</svg>`;
}

/**
 * 渲染成 sprite 的 `<symbol>`（放进隐藏的 <svg> 后即可用 <use href="#id">）。
 *
 * id 用图标 name；调用方若需要命名空间前缀，自行在 id 上处理。
 */
export function renderIconSymbol(icon: IconDef): string {
  const viewBox = icon.viewBox ?? DEFAULT_VIEW_BOX;
  return `<symbol id="${esc(icon.name)}" viewBox="${esc(viewBox)}">${pathToSvg(icon)}</symbol>`;
}

/**
 * 把一组图标渲染成完整 sprite 字符串（隐藏 svg + 全部 symbol）。
 *
 * 为什么提供 sprite 形态？
 *   背包里一屏可能几十个图标，逐个内联 `<svg>` 会重复大量相同 path；
 *   sprite 只定义一次、用 `<use>` 引用，DOM 更省、命中率更高。
 */
export function renderSprite(icons: ReadonlyArray<IconDef> = HAND_DRAWN_ICONS): string {
  const symbols = icons.map(renderIconSymbol).join('');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${symbols}</defs></svg>`;
}

/** 便捷：本体全部图标渲染成一个 sprite */
export function renderCatalogSprite(): string {
  return renderSprite(HAND_DRAWN_ICONS);
}
