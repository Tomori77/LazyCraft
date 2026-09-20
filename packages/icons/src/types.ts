/**
 * 图标库的类型契约。
 *
 * 为什么图标要建模成"数据"而不是 SVG 文件？
 *   本体图标要能经 Registry 下发、被前端按名引用、被 DLC 覆盖或新增；
 *   把图标写成结构化的 path 数据，渲染方式（描边/填充/上色）交给消费端，
 *   同一份图标就能在左栏、卡片、背包格里以不同尺寸/颜色复用。
 *
 * 为什么要"多形态"（task-35 / docs/06 §九）？
 *   矢量（手绘/外部库）、emoji、位图各有适用场景：
 *   矢量最省、可换色；emoji 零素材、适合占位；位图能容纳官方美术。
 *   用判别联合（source 作判别键）让三者在类型层就分得清，
 *   渲染端必须先收窄再消费，不会误把 raster 当 svg 去读 paths。
 */

/** 位图格式：webp 优先（体积/透明皆优），jpg 不支持透明、慎用 */
export type RasterFormat = 'png' | 'jpg' | 'webp';

/** 可承载 SVG path 的来源：本体手绘 + 两个外部图标库（仅供 DLC 引用） */
export type SvgIconSource = 'hand-drawn' | 'game-icons' | 'lucide';

/** 图标来源（多形态） */
export type IconSource = SvgIconSource | 'emoji' | 'raster';

/**
 * 位图/素材许可。
 *
 * 为什么许可必须随图标登记而不是写进 README？
 *   位图一旦随包发布，署名义务就跟着产物走；把许可挂在数据上，
 *   构建期校验与页脚署名都能从同一份数据派生（见 extractIcons 署名汇聚）。
 */
export interface IconLicense {
  /** SPDX 标识；本项目自绘为 'LicenseRef-LazyCraft' */
  spdx: string;
  /** 作者/机构（CC 类许可通常要求） */
  author?: string;
  /** 素材来源地址（原始页面/仓库） */
  source?: string;
}

/** 单条绘制指令 */
export interface IconPath {
  /** SVG path 的 d 属性 */
  d: string;
  /** true = 填充（含挖空高光），false/缺省 = 描边 */
  fill?: boolean;
  /**
   * 该路径是否需要圆头圆角描边。
   * 少数图标（如羽毛）希望线条有粗细变化，可关掉以便自由控制。
   */
  round?: boolean;
}

/**
 * 矢量图标：本体手绘或外部库抽取后的内联 path。
 *
 * viewBox 固定 24×24（与主流图标库一致），消费端缩放时不需要逐个适配。
 * paths 里可以混用描边路径与填充路径：约定 `fill: true` 的走填充，其余走描边。
 */
export interface SvgIconDef {
  /** 图标唯一名（例如 'skill.mining' / 'item.copper_ore' / 'ui.search'） */
  name: string;
  /** 来源；本体目录里的图标恒为 'hand-drawn' */
  source: SvgIconSource;
  /** SVG 视口，缺省 '0 0 24 24' */
  viewBox?: string;
  /** 绘制指令：一条 = 一段 <path d="..."> */
  paths: ReadonlyArray<IconPath>;
}

/** emoji 图标：用字符兜底/占位，零素材成本（不参与 sprite） */
export interface EmojiIconDef {
  name: string;
  source: 'emoji';
  /** 单个 emoji / 短字符；前端按文本渲染 */
  char: string;
}

/** 位图图标：指向静态资源的相对 URL（不参与 sprite，前端按 <img> 渲染） */
export interface RasterIconDef {
  name: string;
  source: 'raster';
  /** 相对路径，约定以 `/icons/` 开头（Vite public / nginx 同源托管） */
  url: string;
  format: RasterFormat;
  /** 许可：raster 必填，构建期缺省即失败（docs/06 §九） */
  license: IconLicense;
}

/**
 * 一枚可渲染图标的多形态判别联合。
 *
 * 判别键是 `source`：`hand-drawn`/`game-icons`/`lucide` 走 svg，
 * 其余两形态各有独立渲染路径。外部库图标解析后**归并为 svg 形态**
 * （构建期抽取内联 path，运行时零请求、零依赖）。
 */
export type IconDef = SvgIconDef | EmojiIconDef | RasterIconDef;

/* ------------------------------------------------------------------ */
/* 类型收窄（渲染端消费前必须先收窄）                                     */
/* ------------------------------------------------------------------ */

/** 是否矢量形态（可用 sprite / <use>） */
export function isSvgIcon(icon: IconDef): icon is SvgIconDef {
  return icon.source === 'hand-drawn' || icon.source === 'game-icons' || icon.source === 'lucide';
}

/** 是否 emoji 形态 */
export function isEmojiIcon(icon: IconDef): icon is EmojiIconDef {
  return icon.source === 'emoji';
}

/** 是否位图形态 */
export function isRasterIcon(icon: IconDef): icon is RasterIconDef {
  return icon.source === 'raster';
}

/**
 * DLC 引用图标的方式（登记进 Registry 时用）。
 *
 * - hand-drawn：内联一份手绘数据
 * - game-icons / lucide：只登记"库名 + 图标名"，实际 path 在构建期抽取内联，
 *   这样运行时零请求、零依赖（见 docs/07-UI风格与图标系统.md）
 * - emoji：只给字符
 * - raster：给静态资源相对 URL + 必填许可
 */
export type IconRef =
  | { name: string; source: 'hand-drawn'; def: Omit<SvgIconDef, 'name' | 'source'> }
  | { name: string; source: 'game-icons'; iconName: string }
  | { name: string; source: 'lucide'; iconName: string }
  | { name: string; source: 'emoji'; char: string }
  | { name: string; source: 'raster'; url: string; format: RasterFormat; license: IconLicense };
