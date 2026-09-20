/**
 * 图标渲染：把各形态 IconDef 变成可用的标记。
 *
 * 为什么在库里做渲染而不是让前端各自拼 SVG？
 *   描边宽度、圆角、填充规则属于图标库的"画法约定"，
 *   集中在这里，本体与所有 DLC 渲染出的图标才会完全一致；
 *   前端只负责"把字符串塞进 DOM / 包成 sprite"。
 *
 * 为什么 sprite 只收矢量形态（task-35）？
 *   sprite 的价值是"同一份 path 定义一次、多处 <use> 引用"；
 *   emoji 只是文本、位图本就是一个 URL，塞进 sprite 不会省任何东西，
 *   反而让 `<use>` 与 `<img>` 的语义分叉。故 sprite 明确只处理 svg，
 *   其余形态走 toIconRender 交给消费端按语义渲染。
 *
 * 注意：本模块只产出字符串 / 描述对象，不引用任何 DOM / 框架，
 * 因此 Node（构建脚本、后端）与浏览器都能安全 import。
 */

import type { IconDef, RasterFormat, SvgIconDef } from './types.js';
import { isRasterIcon, isSvgIcon } from './types.js';
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

/** 转义文本节点内容（emoji 字符） */
function escText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 单条 path → SVG 元素字符串 */
function pathToSvg(icon: SvgIconDef): string {
  return icon.paths
    .map((p) =>
      p.fill
        ? `<path d="${esc(p.d)}" fill="currentColor" stroke="none"/>`
        : `<path d="${esc(p.d)}" fill="none" stroke="currentColor" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('');
}

/**
 * 渲染成一段独立的 `<svg>`（内联使用），三种形态都有对应标记。
 *
 * 颜色走 `currentColor`，尺寸由外部 CSS / 属性控制——
 * 同一枚图标因此能在不同位置以不同大小与颜色出现。
 * 位图走 `<image>`：能放进 svg 上下文（如 sprite 之外的内联位），
 * 但需要 `<img>` 语义（原生 loading / alt）时请用 renderIconHtml / toIconRender。
 */
export function renderIconSvg(icon: IconDef, className = 'lc-icon'): string {
  if (isSvgIcon(icon)) {
    const viewBox = icon.viewBox ?? DEFAULT_VIEW_BOX;
    return `<svg class="${esc(className)}" viewBox="${esc(viewBox)}" fill="none" aria-hidden="true">${pathToSvg(icon)}</svg>`;
  }

  if (icon.source === 'emoji') {
    return `<svg class="${esc(className)}" viewBox="${DEFAULT_VIEW_BOX}" aria-hidden="true"><text x="12" y="12" text-anchor="middle" dominant-baseline="central" font-size="20">${escText(icon.char)}</text></svg>`;
  }

  // raster：<image> 保持 svg 包裹，消费端统一按 svg 尺寸约束
  return `<svg class="${esc(className)}" viewBox="${DEFAULT_VIEW_BOX}" aria-hidden="true"><image href="${esc(icon.url)}" x="0" y="0" width="24" height="24"/></svg>`;
}

/**
 * 渲染成 HTML 片段：矢量/emoji 走 `<svg>`，位图走 `<img>`。
 *
 * 为什么位图不统一用 `<image>`？
 *   位图的自然载体是 `<img>`：宽度/高度属性、loading 懒加载、alt 都可直接给；
 *   放进 `<svg><image>` 只能模拟，还多一层 viewBox 缩放。
 */
export function renderIconHtml(icon: IconDef, className = 'lc-icon'): string {
  if (isRasterIcon(icon)) {
    return `<img class="${esc(className)}" src="${esc(icon.url)}" alt="${esc(icon.name)}" />`;
  }
  return renderIconSvg(icon, className);
}

/**
 * 渲染成 sprite 的 `<symbol>`（放进隐藏的 <svg> 后即可用 <use href="#id">）。
 *
 * id 用图标 name；调用方若需要命名空间前缀，自行在 id 上处理。
 * 仅接受矢量形态——非矢量请走 toIconRender。
 */
export function renderIconSymbol(icon: SvgIconDef): string {
  const viewBox = icon.viewBox ?? DEFAULT_VIEW_BOX;
  return `<symbol id="${esc(icon.name)}" viewBox="${esc(viewBox)}">${pathToSvg(icon)}</symbol>`;
}

/**
 * 把一组图标渲染成完整 sprite 字符串（隐藏 svg + 全部 symbol）。
 *
 * 为什么提供 sprite 形态？
 *   背包里一屏可能几十个图标，逐个内联 `<svg>` 会重复大量相同 path；
 *   sprite 只定义一次、用 `<use>` 引用，DOM 更省、命中率更高。
 *
 * 非矢量形态会被跳过（emoji / raster 不属于 sprite 的收益场景）。
 */
export function renderSprite(icons: ReadonlyArray<IconDef> = HAND_DRAWN_ICONS): string {
  const symbols = icons
    .filter(isSvgIcon)
    .map(renderIconSymbol)
    .join('');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${symbols}</defs></svg>`;
}

/** 便捷：本体全部图标渲染成一个 sprite */
export function renderCatalogSprite(): string {
  return renderSprite(HAND_DRAWN_ICONS);
}

/**
 * 与框架无关的渲染描述：前端据此映射到 JSX（`<use>` / 文本 / `<img>`）。
 *
 * 为什么不直接返回 React 元素？
 *   本库零依赖、不引框架；返回纯对象让 React / Vue / 原生 DOM 都能消费，
 *   同时避免前端用 dangerouslySetInnerHTML 去解析字符串。
 */
export type IconRender =
  | { kind: 'svg-use'; name: string; viewBox: string }
  | { kind: 'emoji'; char: string }
  | { kind: 'raster'; url: string; format: RasterFormat };

export function toIconRender(icon: IconDef): IconRender {
  if (isSvgIcon(icon)) {
    return { kind: 'svg-use', name: icon.name, viewBox: icon.viewBox ?? DEFAULT_VIEW_BOX };
  }
  if (icon.source === 'emoji') {
    return { kind: 'emoji', char: icon.char };
  }
  return { kind: 'raster', url: icon.url, format: icon.format };
}
