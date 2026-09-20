/**
 * @lazycraft/icons —— 图标库入口。
 *
 * 定位（见 docs/07-UI风格与图标系统.md）：
 *   - 本体与自带 DLC：只用本库的手绘图标（HAND_DRAWN_ICONS）。
 *   - game-icons.net / lucide：仅供 DLC 引用的外部源；
 *     本库只登记"来源 + 图标名"的契约，实际 path 由构建期抽取内联。
 *
 * 本模块不依赖 DOM / React，前后端与构建脚本均可直接 import。
 */

export type {
  IconSource,
  IconDef,
  IconPath,
  IconRef,
} from './types.js';

export {
  HAND_DRAWN_ICONS,
  findIcon,
  listIconsByDomain,
} from './catalog.js';

export {
  DEFAULT_VIEW_BOX,
  STROKE_WIDTH,
  renderIconSvg,
  renderIconSymbol,
  renderSprite,
  renderCatalogSprite,
} from './render.js';

export {
  resolveIconRef,
  type ResolvedIcon,
  type ExternalIconTable,
  externalKey,
} from './resolve.js';

export {
  extractIcons,
  type ExternalExtraction,
  type ExtractedIcon,
} from './external/extract.js';

export {
  EXTERNAL_ATTRIBUTIONS,
  attributionFor,
  type IconAttribution,
} from './external/attribution.js';

export {
  LOCAL_EXTERNAL_TABLE,
  mergeExternalTables,
} from './external/table.js';
