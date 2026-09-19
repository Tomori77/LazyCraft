/**
 * 图标库的类型契约。
 *
 * 为什么图标要建模成"数据"而不是 SVG 文件？
 *   本体图标要能经 Registry 下发、被前端按名引用、被 DLC 覆盖或新增；
 *   把图标写成结构化的 path 数据，渲染方式（描边/填充/上色）交给消费端，
 *   同一份图标就能在左栏、卡片、背包格里以不同尺寸/颜色复用。
 */

/** 图标来源：本体手绘 / 两个外部图标库（仅供 DLC 引用） */
export type IconSource = 'hand-drawn' | 'game-icons' | 'lucide';

/**
 * 一枚手绘图标。
 *
 * viewBox 固定 24×24（与主流图标库一致），消费端缩放时不需要逐个适配。
 * paths 里可以混用描边路径与填充路径：约定 `fill: true` 的走填充，其余走描边。
 */
export interface IconDef {
  /** 图标唯一名（例如 'skill.mining' / 'item.copper_ore' / 'ui.search'） */
  name: string;
  /** 来源；本体目录里的图标恒为 'hand-drawn' */
  source: IconSource;
  /** SVG 视口，缺省 '0 0 24 24' */
  viewBox?: string;
  /** 绘制指令：一条 = 一段 <path d="..."> */
  paths: ReadonlyArray<IconPath>;
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
 * DLC 引用图标的方式（登记进 Registry 时用）。
 *
 * - hand-drawn：内联一份手绘数据
 * - game-icons / lucide：只登记"库名 + 图标名"，实际 path 在构建期抽取内联，
 *   这样运行时零请求、零依赖（见 docs/07-UI风格与图标系统.md）
 */
export type IconRef =
  | { name: string; source: 'hand-drawn'; def: Omit<IconDef, 'name' | 'source'> }
  | { name: string; source: 'game-icons'; iconName: string }
  | { name: string; source: 'lucide'; iconName: string };
