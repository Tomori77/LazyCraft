/**
 * 多形态图标示例（task-35）—— emoji 与位图。
 *
 * 为什么示例放在图标库里而不是直接塞进 CorePack？
 *   这两种形态是新能力的"活样例"：既作为单测/校验的固定输入，
 *   也可被前端演示组件直接引用；放进本体目录（HAND_DRAWN_ICONS）会
 *   污染"31 枚手绘"的既有计数与命名预期，故单独成表。
 *
 * 位图素材位于 `apps/web/public/icons/`（DLC 随包发布，相对 URL 同源托管）；
 * 三枚均为本项目自绘（见 docs/06 §九，禁止无许可来源素材进仓库），
 * 许可标记为 LicenseRef-LazyCraft。
 */

import type { EmojiIconDef, IconLicense, RasterIconDef } from './types.js';

/** 本项目自绘素材许可 */
export const LAZYCRAFT_MATERIAL_LICENSE: IconLicense = {
  spdx: 'LicenseRef-LazyCraft',
  author: 'LazyCraft',
  source: 'https://github.com/anomalyco/opencode',
};

/** emoji 形态示例：零素材占位 */
export const EMOJI_ICONS: ReadonlyArray<EmojiIconDef> = [
  { name: 'item.demo_emoji_axe', source: 'emoji', char: '🪓' },
  { name: 'item.demo_emoji_fish', source: 'emoji', char: '🐟' },
];

/** 位图形态示例：覆盖 webp / png / jpg 三种格式与优先级 */
export const RASTER_ICONS: ReadonlyArray<RasterIconDef> = [
  {
    name: 'item.demo_gem',
    source: 'raster',
    url: '/icons/item.demo_gem.webp',
    format: 'webp',
    license: LAZYCRAFT_MATERIAL_LICENSE,
  },
  {
    name: 'item.demo_coin',
    source: 'raster',
    url: '/icons/item.demo_coin.png',
    format: 'png',
    license: LAZYCRAFT_MATERIAL_LICENSE,
  },
  {
    name: 'item.demo_medal',
    source: 'raster',
    url: '/icons/item.demo_medal.jpg',
    format: 'jpg',
    license: LAZYCRAFT_MATERIAL_LICENSE,
  },
];

/** 全部多形态示例（emoji + raster） */
export const FORMAT_DEMO_ICONS: ReadonlyArray<EmojiIconDef | RasterIconDef> = [
  ...EMOJI_ICONS,
  ...RASTER_ICONS,
];
