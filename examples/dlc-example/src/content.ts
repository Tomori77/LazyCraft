/**
 * 示例包的内容数据（可复制的最小集）。
 *
 * 为什么数据与入口分开两个文件？
 *   入口（index.ts）只负责"包身份 + register 装配"，内容放这里让作者一眼看到
 *   "要改的数值在哪"；构建脚本会把两者打包成单文件入口，运行时不产生相对 import
 *   （也就绕开了加载器 cache-busting 只对入口取指纹的局限）。
 *
 * 全部内容是自洽的：本文件注册的技能/物品互相引用，validate() 不会报"引用未注册"。
 * 引用完整性规则见 docs/DLC-开发规范.md 的 validate() 自检清单。
 *
 * 本文件只做 `import type`：类型导入编译后被擦除，产物里没有裸包名，
 * 因此在"本地 dev / 服务器 / e2e"三种环境下都能被 dynamic import。
 */

import type {
  AbstractResource,
  AttributeDefinition,
  Item,
  Skill,
  SkillAction,
} from '@lazycraft/shared';

/* ------------------------------------------------------------------ */
/* ID 前缀：DLC 的 id 空间                                                       */
/* ------------------------------------------------------------------ */

/**
 * 为什么所有 id 都带 `dlc_example_` 前缀？
 *   内容 id 是全局命名空间（Registry 按 id 分桶、存档按 id 索引）；
 *   与内置包或其它 DLC 撞 id 时，后注册者会静默覆盖前者，且只有撞 manifest.id
 *   才会在加载阶段被拦下。前缀是最省事的"避免跨包撞名"纪律，规范里也这样要求。
 */
const SKILL_HERBALISM: Skill = {
  id: 'dlc_example_herbalism',
  name: '草药学',
  type: 'non_combat',
  max_level: 99,
  breakthrough_enabled: false,
  // order 只在本包内建议错开；跨包排序由前端按 id 兜底，不要求全局唯一
  order: 100,
};

/** 采集动作的产出物：草药叶 */
const ITEM_LEAF: Item = {
  id: 'dlc_example_leaf',
  name: '草药叶',
  type: 'material',
  tier: 1,
  stack_max: 999,
  tradeable: true,
  quality: ['common'],
  // source_skill 若填写，必须指向已注册技能，否则 validate() 报错
  source_skill: SKILL_HERBALISM.id,
  use_tags: ['craft_material', 'sellable'],
  rarity: 'normal',
  broadcast_threshold: 'epic',
};

/** 加工动作的产出物：草药精华（消耗草药叶制成，演示 input_items → output_items） */
const ITEM_ESSENCE: Item = {
  id: 'dlc_example_essence',
  name: '草药精华',
  type: 'intermediate',
  tier: 1,
  stack_max: 999,
  tradeable: true,
  quality: ['common'],
  source_skill: SKILL_HERBALISM.id,
  use_tags: ['craft_material'],
  rarity: 'normal',
  broadcast_threshold: 'epic',
};

const ACTION_GATHER: SkillAction = {
  id: 'dlc_example_gather',
  skill_id: SKILL_HERBALISM.id,
  name: '采集草药',
  interval_ms: 4_000,
  exp: 3,
  input_items: {},
  output_items: { [ITEM_LEAF.id]: 1 },
  output_exp: 0,
  required_level: 1,
  // tier 只影响前端中栏分档，与 required_level（解锁门槛）正交
  tier: 1,
};

const ACTION_BREW: SkillAction = {
  id: 'dlc_example_brew',
  skill_id: SKILL_HERBALISM.id,
  name: '熬制精华',
  interval_ms: 6_000,
  exp: 8,
  // 消耗与产出引用的物品都必须在同一快照里已注册
  input_items: { [ITEM_LEAF.id]: 3 },
  output_items: { [ITEM_ESSENCE.id]: 1 },
  output_exp: 0,
  required_level: 5,
  tier: 2,
};

/** 抽象资源示例：不占背包、账号绑定的数值资源（区别于可交易的物品） */
const RES_ESSENCE_WARD: AbstractResource = {
  id: 'dlc_example_ward',
  name: '草药守护',
  tier: 1,
  icon: 'dlc_example_leaf',
  description: '示例抽象资源：由 DLC 注册，账号绑定、不占背包。',
};

/**
 * 人物属性示例。
 *
 * order 必须全局唯一：本体 13 个属性占用 1..13，所以 DLC 属性要取更大值
 * （这里用 100），否则 validate() 会报 "order 与属性 X 重复"。
 */
const ATTR_LUCK: AttributeDefinition = {
  id: 'dlc_example_luck',
  name_key: 'attribute.dlc_example_luck.name',
  default_value: 0,
  order: 100,
  category: 'dlc_example',
  description_key: 'attribute.dlc_example_luck.desc',
};

/** 示例包注册的全部内容（入口按类别逐条登记） */
export const EXAMPLE_CONTENT = {
  skills: [SKILL_HERBALISM] as const,
  items: [ITEM_LEAF, ITEM_ESSENCE] as const,
  actions: [ACTION_GATHER, ACTION_BREW] as const,
  abstractResources: [RES_ESSENCE_WARD] as const,
  attributes: [ATTR_LUCK] as const,
};
