/**
 * 示例包的三形态图标（手绘 SVG / emoji / 位图）。
 *
 * 为什么图标名要写成 `item.<id>` / `skill.<id>`？
 *   前端按内容 id 派生图标名（见 apps/web/src/icons/resolve-icon.ts）：
 *   技能 → `skill.<id>`，物品 → `item.<id>`（另有少量历史别名）。
 *   登记的图标名命中派生命，前端就会自动用上；否则回退首字母，不报错。
 *
 * 位图的 url 必须以 `/icons/` 开头（同源托管契约，validateIcons 硬校验），
 *   且 format 要与扩展名一致。当前 `/icons/` 由 nginx 从**前端产物**托管，
 *   所以 DLC 位图还需把素材同步到 `apps/web/public/icons/` 并重建前端——
 *   这是本体的现存局限，详见 docs/DLC-开发规范.md「图标与素材」。
 */

import type { IconDef } from '@lazycraft/shared';

/** 手绘矢量：内联 path 数据，零素材、可换色，最推荐 */
const ICON_LEAF: IconDef = {
  name: 'item.dlc_example_leaf',
  source: 'hand-drawn',
  // viewBox 缺省即 24×24，与本体图标一致
  paths: [
    // 叶身（描边）
    { d: 'M4 20c0-8 5-14 16-16 0 12-7 18-16 16z' },
    // 主脉（描边，细线）
    { d: 'M4 20C8 16 12 12 20 4' },
  ],
};

/** emoji：零素材占位，适合原型期；char 必填，否则校验不过 */
const ICON_HERBALISM: IconDef = {
  name: 'skill.dlc_example_herbalism',
  source: 'emoji',
  char: '🌿',
};

/**
 * 位图：指向静态资源 URL，license 必填（法务要求，缺省即构建失败）。
 * 本项目自绘素材统一标 `LicenseRef-LazyCraft`；引入第三方素材时必须如实填写
 * 其 SPDX 与作者/来源，并保证有再分发许可。
 */
const ICON_ESSENCE: IconDef = {
  name: 'item.dlc_example_essence',
  source: 'raster',
  url: '/icons/dlc_example_essence.png',
  format: 'png',
  license: {
    spdx: 'LicenseRef-LazyCraft',
    author: 'LazyCraft',
    source: 'https://github.com/anomalyco/opencode',
  },
};

export const EXAMPLE_ICONS: readonly IconDef[] = [
  ICON_LEAF,
  ICON_HERBALISM,
  ICON_ESSENCE,
];
