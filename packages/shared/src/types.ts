/**
 * LazyCraft 共享核心类型定义
 *
 * 前后端共用的"游戏规则"数据契约：
 * - 前端：用于 UI 预览、掉落/词条提示
 * - 后端：用于权威结算（离线收益、战斗结算等）
 */

/** 物品品质（白 / 蓝 / 紫 / 橙） */
export type Quality = 'common' | 'uncommon' | 'rare' | 'epic';

/** 物品分类（原材料 / 半成品 / 成品 / 装备 / 消耗品） */
export type ItemType = 'material' | 'intermediate' | 'product' | 'equipment' | 'consumable';

/** 物品稀有度（用于全服广播等） */
export type Rarity = 'normal' | 'magic' | 'epic' | 'legendary';

/** 技能类别 */
export type SkillType = 'combat' | 'non_combat';

/**
 * 物品资源
 *
 * 占仓库格子、可挂市场交易的实体物品（区别于"抽象资源"）。
 * 参考《框架设计》第 4.3 节：物品资源不可直接折算成抽象资源，
 * 防止跳过制作环节。
 */
export interface Item {
  /** 物品唯一 ID（例如：'copper_ore'） */
  id: string;
  /** 显示名（i18n key 或直接中文名） */
  name: string;
  /** 物品分类 */
  type: ItemType;
  /** 物品等级 / 阶位，用于解锁、配方要求等 */
  tier: number;
  /** 同格最大堆叠数（例如 999） */
  stack_max: number;
  /** 是否可交易 */
  tradeable: boolean;
  /** 该物品可达到的品质列表（普通物品通常只有 ['common']） */
  quality: Quality[];
  /** 产出该物品的技能 ID（如果是采集/制造物）*/
  source_skill?: string;
  /** 用途标签（例如 'fuel'、'craft_material'、'sellable'） */
  use_tags: string[];
  /** 稀有度：决定掉落时的播报行为 */
  rarity: Rarity;
  /** 触发全服广播的最低品质（>=broadcast_threshold 时广播） */
  broadcast_threshold: Quality;
}

/**
 * 技能
 *
 * 常规 99 级，可突破至 120（需要 DLC 材料）。
 */
export interface Skill {
  /** 技能唯一 ID（例如：'mining'） */
  id: string;
  /** 显示名 */
  name: string;
  /** 技能类别：战斗 / 非战斗 */
  type: SkillType;
  /** 常规最大等级（99） */
  max_level: number;
  /** 是否允许突破到 120 */
  breakthrough_enabled: boolean;
}

/**
 * 技能动作
 *
 * 引擎对"动作"的认知：有间隔、有消耗、有产出、给经验。
 * 离线结算直接基于此结构。
 */
export interface SkillAction {
  /** 动作唯一 ID（例如：'mine_copper'） */
  id: string;
  /** 所属技能 ID */
  skill_id: string;
  /** 显示名 */
  name: string;
  /** 每次执行所需间隔（毫秒） */
  interval_ms: number;
  /** 每次执行获得的经验值 */
  exp: number;
  /** 每次执行消耗的物品（key = Item.id, value = 数量） */
  input_items: Record<string, number>;
  /** 每次执行产出的物品（key = Item.id, value = 数量） */
  output_items: Record<string, number>;
  /** 每次执行产出的额外抽象经验/资源（若有） */
  output_exp: number;
}

/** 敌人 */
export interface Enemy {
  /** 敌人唯一 ID */
  id: string;
  /** 显示名 */
  name: string;
  /** 等级 */
  level: number;
  /** 生命值 */
  hp: number;
  /** 攻击力 */
  attack: number;
  /** 防御力 */
  defense: number;
  /** 掉落表 ID（关联 P1 的 loot_tables） */
  loot_table_id?: string;
}

/** 玩家 */
export interface Player {
  /** 玩家唯一 ID */
  id: string;
  /** 所属账号 ID */
  account_id: string;
  /** 玩家显示名 */
  name: string;
  /** 所在赛季 ID（0 = 永久服） */
  season_id: number;
  /** 创建时间（毫秒时间戳） */
  created_at: number;
}

/** 赛季 */
export interface Season {
  /** 赛季唯一 ID */
  id: string;
  /** 显示名 */
  name: string;
  /** 开始时间（毫秒时间戳） */
  started_at: number;
  /** 结束时间（毫秒时间戳，赛季结束时写入） */
  ended_at?: number;
  /** 是否已结算（赛季角色转永久） */
  settled: boolean;
}

/**
 * 注册表
 *
 * 引擎对所有"内容"的统一入口，DLC 通过 ContentPack.register 注入。
 */
export interface Registry {
  /** 注册一个技能 */
  skill(skill: Skill): void;
  /** 注册一个动作 */
  action(action: SkillAction): void;
  /** 注册一个物品 */
  item(item: Item): void;
  /** 按 ID 获取已注册内容 */
  get(id: string): Skill | SkillAction | Item | undefined;
  /** 按类型列出已注册内容 */
  list(kind: 'skill' | 'action' | 'item'): Array<Skill | SkillAction | Item>;
  /** 注册完成后做一致性校验（例如所有 action.skill_id 必须存在） */
  validate(): { ok: boolean; errors: string[] };
}

/** DLC 内容包契约 */
export interface ContentPack {
  /** 包唯一 ID（例如 'mining'） */
  id: string;
  /** 显示名 */
  name: string;
  /** 版本号 */
  version: string;
  /** 注册入口：把该包的所有内容注册到 Registry */
  register(registry: Registry): void;
}

/* ------------------------------------------------------------------ */
/* 最小示例常量                                                       */
/* ------------------------------------------------------------------ */

/** 铜矿石：最基础的采矿产出物 */
export const COPPER_ORE: Item = {
  id: 'copper_ore',
  name: '铜矿石',
  type: 'material',
  tier: 1,
  stack_max: 999,
  tradeable: true,
  quality: ['common'],
  source_skill: 'mining',
  use_tags: ['craft_material', 'sellable'],
  rarity: 'normal',
  broadcast_threshold: 'epic',
};

/** 采矿技能 */
export const MINING_SKILL: Skill = {
  id: 'mining',
  name: '采矿',
  type: 'non_combat',
  max_level: 99,
  breakthrough_enabled: true,
};
