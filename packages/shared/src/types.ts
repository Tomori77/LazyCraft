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
 * 抽象资源
 *
 * 账号绑定、不占背包的"数值资源"（木材/石材/铁锭），
 * 与物品资源强制分离（见《框架设计》4.3 铁律：物品 → 抽象不可逆，
 * 防止玩家跳过制作环节）。
 */
export interface AbstractResource {
  /** 资源唯一 ID（例如：'res_wood'） */
  id: string;
  /** 显示名 */
  name: string;
  /** 阶位：用于解锁门槛与排序展示 */
  tier: number;
  /** 图标标识（前端按 key 取图，缺省回退首字母） */
  icon?: string;
  /** 描述文案 */
  description?: string;
}

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
  /** 左栏分组展示序：战斗组/非战斗组内各自排序，缺省按 id 排 */
  order?: number;
  /** 图标标识（前端按 key 取图，缺省回退首字母，与 AbstractResource.icon 同策略） */
  icon?: string;
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
  /**
   * 解锁该动作所需的技能等级（1 级起）。
   *
   * 为什么放在动作上而不是技能上？
   *   同一技能下的动作解锁门槛各不相同（1 级采铜矿、15 级采铁矿），
   *   等级要求天然是动作的元数据——与 interval / 消耗 / 产出并列。
   */
  required_level: number;
  /**
   * 工作阶位：1=基础 2=进阶 3=高级 4=大师，前端据此生成中栏分类页签。
   *
   * 与 required_level 正交：required_level 是"解锁门槛"，tier 是"展示分档"。
   * 为什么不让前端按 required_level 区间硬编码分桶？——那等于把数据规则写进 UI，
   * 同一门槛区间的动作以后可能被策划重新归为不同档位，前端无法跟随数据变化。
   */
  tier: number;
  /** 图标标识（工作卡片用，缺省回退首字母） */
  icon?: string;
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
 * 装备穿戴部位
 *
 * 人体图全集；P1 模板只占 main_hand / chest，其余槽位留空供 DLC 填内容。
 * 定义在契约层而不是 loot 内部：槽位本身也是可被 DLC 注册的内容（见 ContentKind），
 * 若把定义埋在 loot 里，registry 与 loot 会互相引用形成循环依赖。
 */
export type EquipmentSlot =
  | 'head'
  | 'neck'
  | 'main_hand'
  | 'off_hand'
  | 'chest'
  | 'legs'
  | 'hands'
  | 'feet'
  | 'ring1'
  | 'ring2';

/**
 * 装备槽位展示元数据。
 *
 * 为什么槽位排布放共享层而不是前端写死？
 *   人体图的贴位与顺序属于"内容布局规则"，DLC 增删槽位时前端不应改代码；
 *   前端只按 anchor 分四组、按 order 排序即可渲染。
 */
export interface EquipmentSlotMeta {
  id: EquipmentSlot;
  /** 人体图上的锚点语义：前端据此把槽位贴到 top / left / right / bottom 四组 */
  anchor: 'top' | 'left' | 'right' | 'bottom';
  /** 展示顺序 */
  order: number;
}

/**
 * 内容类别：Registry.get()/list() 的查询维度
 *
 * 为什么抽象资源与槽位也算内容？
 *   它们和技能/物品一样是随 DLC 增删的数据；若只允许引擎内置，
 *   DLC 每加一种资源或一个部位都得改引擎源码，违背"内容即数据"铁律。
 */
export type ContentKind =
  | 'skill'
  | 'action'
  | 'item'
  | 'enemy'
  | 'abstractResource'
  | 'slot';

/** 按类别存储的内容联合类型 */
export type Content =
  | Skill
  | SkillAction
  | Item
  | Enemy
  | AbstractResource
  | EquipmentSlotMeta;

/** Registry.validate() 的返回结构：ok=false 时 errors 包含全部不一致项 */
export interface ValidateResult {
  ok: boolean;
  errors: string[];
}

/**
 * 注册表
 *
 * 引擎对所有"内容"的统一入口，DLC 通过 ContentPack.register 注入。
 *
 * 双视角设计：
 *   - 写视角（DLC 用）：skill()/action()/item()/enemy()/abstractResource()/slot() 逐条登记
 *   - 读视角（引擎用）：register(pack) 整包载入、get(id, type) 精确取、
 *     list(type) 列一类、validate() 启动自检
 */
export interface Registry {
  /* 写视角：供 ContentPack.register 调用 */
  /** 注册一个技能 */
  skill(skill: Skill): void;
  /** 注册一个动作 */
  action(action: SkillAction): void;
  /** 注册一个物品 */
  item(item: Item): void;
  /** 注册一个敌人 */
  enemy(enemy: Enemy): void;
  /** 注册一个抽象资源：DLC 新增资源不应改引擎源码 */
  abstractResource(resource: AbstractResource): void;
  /** 注册一个装备槽位：DLC 增删部位不应改引擎源码 */
  slot(meta: EquipmentSlotMeta): void;

  /* 读视角：引擎消费用 */
  /** 整包注册一个内容包 */
  register(pack: ContentPack): void;
  /** 按 ID + 类别精确取已注册内容 */
  get(id: string, type: ContentKind): Content | undefined;
  /** 按类别列出已注册内容 */
  list(type: ContentKind): Content[];
  /** 注册完成后做一致性校验（例如所有 action.skill_id 必须存在） */
  validate(): ValidateResult;
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
