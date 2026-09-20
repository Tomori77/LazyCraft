/**
 * 战斗核心 —— 服务器权威的第二块结算引擎（第一块是 idle）。
 *
 * 为什么放在 packages/shared？
 *   与 idle 同一铁律：前端用它做"若开打会打成什么样"的预演，
 *   后端用它做权威结算并回写存档。规则的任何一份拷贝都会在未来
 *   变成"前端显示能赢、后端判你死了"的事故源头。
 *
 * 为什么整段战斗一次性算完，而不是挂在 tick 循环上？
 *   与 idle.settle 同构：战斗状态只有"开始时刻 + 敌人"两个输入，
 *   过程是确定的数值推演（伤害公式是减法不是概率），逐事件模拟
 *   没有信息增量；一次性推演让 stop 在任意时刻都返回"截至现在的
 *   完整战报"，断线重连也能凭 started_at 重放同一结果。
 *
 * 为什么伤害是 atk - def 的减法？
 *   P0 阶段数值极小（鸡 1 攻对玩家 ~0 防），乘区公式在低数值段
 *   会产生大量 0 伤害回合，玩家看不懂"为什么我打不动 1 级怪"；
 *   减法公式直白（面板差即伤害），平衡性留给战斗 DLC 换公式。
 *
 * 随机性声明：
 *   死亡掉落走 rollLoot，需要 rng；由调用方注入（默认 Math.random），
 *   与 idle 引擎"时间戳必须由后端注入"的作风一致——本模块不自带
 *   任何不可控输入。
 */

import type { Enemy } from '../types.js';
import { levelFromExp } from '../skill/skill-service.js';
import { rollLoot, findLootTableById, type LootResult, type Equipment } from '../loot/index.js';
import { FOODS } from './foods.js';
import {
  ATTRIBUTE_BASE,
  ATTRIBUTE_IDS,
  sumAttributeContributions,
  type PlayerAttributes,
} from '../attributes/index.js';

/** 食物恢复量表：推演里动态查，防御"背包里有非食物物品"的脏数据 */
const FOOD_HEAL: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(Object.values(FOODS).map((f) => [f.item_id, f.heal])),
);

/* ------------------------------------------------------------------ */
/* 平衡常量（集中在此，调平衡只动这一段）                                  */
/* ------------------------------------------------------------------ */

/** 玩家攻击间隔（毫秒）：比鸡快 300ms，空手也能稳定先手 */
export const PLAYER_ATTACK_INTERVAL_MS = 2_700;

/** 玩家单次攻击的基础攻击间隔之外的等级加成：攻击等级每级 +1 攻击力 */
export const PLAYER_ATTACK_PER_LEVEL = 1;

/** 玩家基础生命值：1 级玩家的生命值（无装备时） */
export const PLAYER_BASE_HP = 12;

/** 每点攻击等级额外生命：让"练攻击"有直观的生存回报 */
export const PLAYER_HP_PER_LEVEL = 2;

/** 死亡惩罚的比例系数：死亡后损失（清空当前战斗的一切收益，回到起点） */
export const DEATH_PENALTY_NOTE = '战斗失败后不会丢失物品，但本次战斗的全部收益作废';

/*
 * 新属性（task-34）的"中性默认"。
 *
 * 为什么全部取"不改变旧行为"的值？
 *   任务硬要求：默认属性下战斗结果必须与 task-18 等价。
 *   命中率 100 = 必中；闪避 0 = 不闪；暴击率 0 = 不暴击；暴击伤害 100% = 无加成；
 *   减伤 0 = 不减；最大/最小伤害 0 = 回落到"减法公式"。任何一项非中性都是行为变更。
 */
/** 默认命中率（百分比）：100 表示必中，不引入未命中分支 */
export const DEFAULT_ACCURACY_PERCENT = 100;
/** 默认暴击伤害（百分比）：100 表示暴击无额外倍率 */
export const DEFAULT_CRIT_DAMAGE_PERCENT = 100;
/** 默认攻击间隔（毫秒），与 PLAYER_ATTACK_INTERVAL_MS 同值，供属性面板展示 */
export const DEFAULT_ATTACK_INTERVAL_MS = PLAYER_ATTACK_INTERVAL_MS;

/* ------------------------------------------------------------------ */
/* 类型                                                                  */
/* ------------------------------------------------------------------ */

/** 战斗参与者（玩家侧）的输入属性 */
export interface CombatantStats {
  /** 生命值上限 */
  max_hp: number;
  /** 攻击力 */
  attack: number;
  /** 防御力 */
  defense: number;
  /** 攻击间隔（毫秒） */
  interval_ms: number;
}

/** 玩家背包切片：战斗只需要知道有多少食物 */
export interface CombatInventory {
  /** item_id -> 数量 */
  food: Record<string, number>;
}

/** 战斗开始入参 */
export interface StartCombatInput {
  /** 服务器当前时间（毫秒）：必须是服务器时钟，永远不信客户端 */
  now: number;
  /** 攻击技能累计经验（推出玩家攻击等级/攻防） */
  attack_exp: number;
  /** 装备提供的属性加成（task-14 装备快照：武器攻击 + 护甲防御 + 生命） */
  equipment_stats: { attack: number; defense: number; hp: number };
  /** 背包里的食物存量（item_id -> 数量） */
  food: CombatInventory['food'];
}

/** 一次有效攻击的战斗日志条目（前端逐条回放到日志面板） */
export interface CombatLogEntry {
  /** 服务器时间戳：这一次攻击发生的时刻 */
  at: number;
  /** 出手方 */
  actor: 'player' | 'enemy';
  /** 实际造成的伤害（已扣防御，最小 0） */
  damage: number;
  /** 受击方剩余生命 */
  target_hp: number;
}

/** 战斗结束形态 */
export type CombatEndState =
  | { kind: 'fighting' }
  | { kind: 'victory'; loot: LootResult | undefined }
  | { kind: 'defeat' };

/** 一次完整推演（从开始到某个时间点）的战报 */
export interface CombatReport {
  /** 战斗开始时刻（= 入参 started_at） */
  started_at: number;
  /** 推演截止时刻（= 入参 now，或死亡/胜利发生的自然时刻之前的最后一次有效攻击） */
  ended_at: number;
  /** 战斗结果 */
  end: CombatEndState;
  /** 玩家当前生命（结束时的快照；胜利/战斗中为当前值，死亡为 0） */
  player_hp: number;
  /** 敌人当前生命（结束时的快照；胜利为 0） */
  enemy_hp: number;
  /** 玩家吃掉了多少食物（item_id -> 数量） */
  food_consumed: Record<string, number>;
  /** 完整攻击日志（含玩家与敌人的每一次出手） */
  log: CombatLogEntry[];
  /** 战斗结束时给予的攻击技能经验（胜利=敌人等级×2，失败=0） */
  exp_gained: number;
  /** 掉落的装备实例（rollLoot 出 equipment 时），用于后端入 player_equipment 表 */
  equipment_drops: Equipment[];
  /** 直接掉物品的部分（item_id -> 数量），用于后端入背包 */
  item_drops: Record<string, number>;
}

/** 进行中的战斗快照（存到存档 data.combat） */
export interface ActiveCombat {
  /** 敌人 id */
  enemy_id: string;
  /** 服务器时间戳（毫秒）：战斗开始时刻 */
  started_at: number;
}

/* ------------------------------------------------------------------ */
/* 玩家面板属性计算（纯函数）                                              */
/* ------------------------------------------------------------------ */

/** 由攻击经验推玩家当前攻击等级（最低 1 级） */
export function playerAttackLevel(attackExp: number): number {
  return levelFromExp(attackExp);
}

/** 装备对属性的贡献（task-14 装备快照的旧三元组形状） */
export interface EquipmentAttributeSource {
  /** 平坦攻击力（落到属性 'attack'） */
  attack: number;
  /** 防御（落到属性 'defense'） */
  defense: number;
  /** 生命上限加成（落到属性 'hp'） */
  hp: number;
}

/**
 * 玩家最终属性面板（task-34）：把"等级派生基础值 + 装备 + 其它来源"聚合成属性映射。
 *
 * 关键点：默认值下必须与旧 `playerStats` 完全等价。
 *   - 生命 = PLAYER_BASE_HP + 等级×PLAYER_HP_PER_LEVEL + 装备 hp
 *   - 攻击 = 等级×PLAYER_ATTACK_PER_LEVEL + 装备 attack
 *   - 防御 = 装备 defense
 *   攻击等级派生值作为"基础来源"，装备 final_stats 按属性 id 映射后相加，
 *   与旧写的加法逐项一致（含 max(0, ·) 的钳制，放在归一化步骤）。
 *
 * 为什么 hp/attack/defense 之外还要补齐其它属性？
 *   P4-5 要求面板暴露全集；未装备提供的新属性取其"中性默认"
 *   （命中 100 / 暴击伤害 100 / 其余 0），保证战斗结算不因缺属性而漏分支。
 */
export function playerAttributes(
  attackExp: number,
  equipment: EquipmentAttributeSource,
  extras: ReadonlyArray<PlayerAttributes> = [],
): PlayerAttributes {
  const level = playerAttackLevel(attackExp);

  // 先落本体全集的"中性默认"：命中 100 / 暴击伤害 100 / 其余 0；
  // 未装备提供的属性（魔力、减伤、闪避…）由此保证存在且不改变旧战斗结果。
  const base: Record<string, number> = {
    [ATTRIBUTE_IDS.HP]: 0,
    [ATTRIBUTE_IDS.MP]: 0,
    [ATTRIBUTE_IDS.ATTACK]: 0,
    [ATTRIBUTE_IDS.DEFENSE]: 0,
    [ATTRIBUTE_IDS.DAMAGE_REDUCTION]: 0,
    [ATTRIBUTE_IDS.EVASION_MELEE]: 0,
    [ATTRIBUTE_IDS.EVASION_RANGED]: 0,
    [ATTRIBUTE_IDS.EVASION_MAGIC]: 0,
    [ATTRIBUTE_IDS.ACCURACY]: DEFAULT_ACCURACY_PERCENT,
    [ATTRIBUTE_IDS.MAX_HIT]: 0,
    [ATTRIBUTE_IDS.MIN_HIT]: 0,
    [ATTRIBUTE_IDS.CRIT_CHANCE]: 0,
    [ATTRIBUTE_IDS.CRIT_DAMAGE]: DEFAULT_CRIT_DAMAGE_PERCENT,
  };

  // 等级派生 + 装备（沿用旧口径的 max(0, ·) 钳制）
  base[ATTRIBUTE_IDS.HP] =
    PLAYER_BASE_HP + level * PLAYER_HP_PER_LEVEL + Math.max(0, equipment.hp);
  base[ATTRIBUTE_IDS.ATTACK] =
    level * PLAYER_ATTACK_PER_LEVEL + Math.max(0, equipment.attack);
  base[ATTRIBUTE_IDS.DEFENSE] = Math.max(0, equipment.defense);

  // extras（DLC / 被动）在最终值上再做加法，不会覆盖上面的旧口径结果
  return sumAttributeContributions(base, {}, extras);
}

/**
 * 把最终属性映射收窄成战斗推演消费的 `CombatantStats`。
 *
 * 为什么战斗推演仍吃旧四元组而不是直接吃属性映射？
 *   本体的减法推演只用到 hp/攻击/防御/间隔；让推演改吃整张属性表会牵动
 *   大量既有断言。收窄放在边界上：新属性体系是"数据面"，
 *   推演是"计算面"，二者用这个函数解耦；DLC 覆写公式时也只需给新的 CombatantStats。
 */
export function combatantStatsFromAttributes(attributes: PlayerAttributes): CombatantStats {
  return {
    max_hp: attributes[ATTRIBUTE_IDS.HP] ?? PLAYER_BASE_HP,
    attack: attributes[ATTRIBUTE_IDS.ATTACK] ?? 0,
    defense: attributes[ATTRIBUTE_IDS.DEFENSE] ?? 0,
    interval_ms: attributes['interval_ms'] ?? PLAYER_ATTACK_INTERVAL_MS,
  };
}

/**
 * 计算玩家战斗面板属性（向后兼容入口）。
 *
 * 保留旧签名：既有调用方（后端 combat.service / 单测）无需改动，
 * 内部改走属性聚合再收窄，默认值下结果与 task-18 完全一致。
 * DLC 若要换一套"从属性到 CombatantStats"的公式，用 registerCombatFormulas 覆写。
 */
export function playerStats(attackExp: number, equipment: { attack: number; defense: number; hp: number }): CombatantStats {
  return getCombatFormulas().playerStats(attackExp, equipment);
}

/** 敌人面板属性：直接读 Enemy 数据，间隔给一个统一的"小怪攻速" */
export function enemyStats(enemy: Enemy): CombatantStats {
  return {
    max_hp: Math.max(1, enemy.hp),
    attack: Math.max(0, enemy.attack),
    defense: Math.max(0, enemy.defense),
    // 敌人攻击间隔：固定 3s。未来需要"快攻型小怪"再把 interval 挂到 Enemy 类型上。
    interval_ms: 3_000,
  };
}

/* ------------------------------------------------------------------ */
/* 战斗公式策略（DLC 覆写点，task-34）                                     */
/* ------------------------------------------------------------------ */

/**
 * 战斗公式策略：把"玩家属性 → 战斗面板"与"一次攻击的伤害解析"抽成可替换实现。
 *
 * 为什么不把命中/暴击/减伤的每条公式都拆成单独 hook？
 *   本体默认行为是"减法且不命中/不暴击"，拆得太碎会让默认路径变成一堆恒等分支；
 *   给一个整体策略入口，DLC 想换成乘区/命中/暴击整套时覆写一处即可，
 *   同时默认实现保持极其简单、可读、与旧行为逐位一致。
 */

/** 一次攻击的伤害解析上下文 */
export interface DamageContext {
  /** 旧减法公式的结果 max(0, atk - def)：默认路径直接返回它 */
  base_damage: number;
  /** 出手方面板 */
  attacker: CombatantStats;
  /** 受击方面板 */
  defender: CombatantStats;
  /** 出手方伤害参数（命中/暴击/伤害区间） */
  attacker_profile: DamageProfile;
  /** 受击方伤害参数（闪避/减伤） */
  defender_profile: DamageProfile;
  /** 0~1 均匀随机数；默认路径在参数中性时**不会**调用它，保证旧结果可复现 */
  rng: () => number;
}

export interface CombatFormulas {
  /** 由攻击经验 + 装备派生玩家战斗面板（默认 = playerStats 的旧实现） */
  playerStats: (attackExp: number, equipment: EquipmentAttributeSource) => CombatantStats;
  /** 由最终属性派生伤害参数（命中/闪避/暴击/减伤/伤害区间） */
  damageProfile: DamageProfileProvider;
  /** 解析一次攻击的最终伤害（默认 = 中性参数下原样返回 base_damage） */
  resolveDamage: (ctx: DamageContext) => number;
}

/** 中性伤害参数：命中 100 / 闪避 0 / 无伤害区间 / 无暴击 / 无减伤 */
export const NEUTRAL_DAMAGE_PROFILE: DamageProfile = Object.freeze({
  accuracy_percent: DEFAULT_ACCURACY_PERCENT,
  evasion_percent: 0,
  max_hit: 0,
  min_hit: 0,
  crit_chance_percent: 0,
  crit_damage_percent: DEFAULT_CRIT_DAMAGE_PERCENT,
  damage_reduction_percent: 0,
});

/** 百分比钳制到 [0,100]，非有限数按 0（脏数据不产生负伤害/超额减伤） */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * 默认伤害解析。
 *
 * 关键约束——参数中性时**逐步短路**、不调用 rng：
 *   命中率 = 出手方命中 − 受击方闪避；若 = 100 则不掷命中。
 *   伤害区间 max_hit>0 才掷区间；暴击率>0 才掷暴击；减伤>0 才乘减伤系数。
 *   因此默认玩家（命中 100 / 其余 0）走完整条路径后得到的就是 base_damage 本身，
 *   且 rng 调用序列与旧实现完全一致（旧实现只在胜利时用一次 rng 抽掉落）。
 */
export function defaultResolveDamage(ctx: DamageContext): number {
  const { base_damage, attacker_profile: ap, defender_profile: dp, rng } = ctx;

  // 1. 命中/闪避：默认 100 - 0 = 100，短路不掷
  const hitChance = clampPercent(clampPercent(ap.accuracy_percent) - clampPercent(dp.evasion_percent));
  if (hitChance < 100 && rng() * 100 >= hitChance) return 0;

  // 2. 基础伤害：max_hit>0 时按 [min_hit, max_hit] 取值，否则沿用减法结果
  let damage = base_damage;
  if (ap.max_hit > 0) {
    const lo = Math.min(ap.min_hit, ap.max_hit);
    const hi = Math.max(ap.min_hit, ap.max_hit);
    damage = lo + rng() * (hi - lo);
  }

  // 3. 暴击：默认 0，短路不掷
  const critChance = clampPercent(ap.crit_chance_percent);
  if (critChance > 0 && rng() * 100 < critChance) {
    damage *= ap.crit_damage_percent / 100;
  }

  // 4. 受击方减伤：默认 0，短路不变
  const reduction = clampPercent(dp.damage_reduction_percent);
  if (reduction > 0) damage *= (100 - reduction) / 100;

  // 旧实现伤害恒为整数；默认路径 damage === base_damage（整数），floor 后不变
  return Math.max(0, Math.floor(damage));
}

const defaultCombatFormulas: CombatFormulas = {
  playerStats: (attackExp, equipment) =>
    combatantStatsFromAttributes(playerAttributes(attackExp, equipment)),
  damageProfile: defaultDamageProfile,
  resolveDamage: defaultResolveDamage,
};

let currentFormulas: CombatFormulas = defaultCombatFormulas;

/** 覆写战斗公式策略，返回恢复函数（与 registerLevelCalculator 同款可还原接口） */
export function registerCombatFormulas(formulas: Partial<CombatFormulas>): () => void {
  const previous = currentFormulas;
  currentFormulas = { ...currentFormulas, ...formulas };
  return () => {
    currentFormulas = previous;
  };
}

/** 恢复默认战斗公式 */
export function resetCombatFormulas(): void {
  currentFormulas = defaultCombatFormulas;
}

/** 当前生效的战斗公式策略 */
export function getCombatFormulas(): CombatFormulas {
  return currentFormulas;
}

/**
 * 从最终属性计算"本次攻击的伤害区间与命中/暴击参数"。
 *
 * 默认实现刻意返回"命中 100%、暴击 0%、最大/最小伤害 0"，
 * 让 simulateCombat 的伤害仍由减法公式 max(0, atk - def) 决定——
 * 这正是"默认下与现状等价"的落点。DLC 可覆写本函数接入乘区/命中/暴击。
 */
export interface DamageProfile {
  /** 命中率百分比（0~100）；默认 100 */
  accuracy_percent: number;
  /** 被闪避的概率百分比（0~100）；默认 0 */
  evasion_percent: number;
  /** 最大伤害覆盖值（>0 时取代减法公式）；默认 0 = 用减法 */
  max_hit: number;
  /** 最小伤害下限；默认 0 */
  min_hit: number;
  /** 暴击率百分比；默认 0 */
  crit_chance_percent: number;
  /** 暴击伤害倍率百分比；默认 100 = 无加成 */
  crit_damage_percent: number;
  /** 伤害减免百分比；默认 0 */
  damage_reduction_percent: number;
}

/** 默认伤害参数提供者，供 DLC 覆写（与 CombatFormulas 分开：面板与伤害是两件事） */
export type DamageProfileProvider = (attributes: PlayerAttributes) => DamageProfile;

/** 中性伤害参数：一切照旧，减法公式生效 */
export function defaultDamageProfile(attributes: PlayerAttributes): DamageProfile {
  return {
    accuracy_percent: attributes[ATTRIBUTE_IDS.ACCURACY] ?? DEFAULT_ACCURACY_PERCENT,
    evasion_percent: attributes[ATTRIBUTE_IDS.EVASION_MELEE] ?? 0,
    max_hit: attributes[ATTRIBUTE_IDS.MAX_HIT] ?? 0,
    min_hit: attributes[ATTRIBUTE_IDS.MIN_HIT] ?? 0,
    crit_chance_percent: attributes[ATTRIBUTE_IDS.CRIT_CHANCE] ?? 0,
    crit_damage_percent: attributes[ATTRIBUTE_IDS.CRIT_DAMAGE] ?? DEFAULT_CRIT_DAMAGE_PERCENT,
    damage_reduction_percent: attributes[ATTRIBUTE_IDS.DAMAGE_REDUCTION] ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* 主推演：从 started_at 一次性推到 now                                   */
/* ------------------------------------------------------------------ */

export interface SimulateCombatInput {
  /** 服务器时间戳：战斗开始时刻 */
  started_at: number;
  /** 服务器时间戳：推演截止时刻（必须 ≥ started_at） */
  now: number;
  /** 玩家面板 */
  player: CombatantStats;
  /** 敌人配置 */
  enemy: Enemy;
  /** 背包食物存量（会被消耗；按 FOODS 表的注册顺序食用） */
  food: Record<string, number>;
  /** 掉落随机数源（胜利时调用一次 rollLoot） */
  rng?: () => number;
  /**
   * 玩家最终属性（task-34，可选）。
   *
   * 为什么可选？—— 既有调用方（单测/旧 e2e）只传 CombatantStats，
   * 缺省时用中性伤害参数，行为与 task-18 完全一致；
   * 传了属性才启用命中/暴击/伤害区间/减伤这些新维度。
   */
  player_attributes?: PlayerAttributes;
  /** 敌人最终属性（可选）；缺省中性参数（命中 100 / 闪避 0 / 无暴击/减伤） */
  enemy_attributes?: PlayerAttributes;
}

/**
 * 推演一场战斗到指定时刻。
 *
 * 为什么不在每次 attack 事件里立即结算掉落/经验？
 *   掉落只在"敌人死亡"那一刻触发，而推演过程可能跨过那个时刻继续打；
 *   把死亡判定放在"每一轮出手"之后、掉落放在战后统一结算，
 *   日志读起来才是"打死 → 播掉落"的顺序，而不是掉落夹在战报中段。
 *
 * 食物触发规则（P0 用最简单的一档）：
 *   玩家受到伤害后，如果 hp < max_hp 的 30%，且背包有食物，立即吃一口。
 *   为什么是 30% 而不是 50%：
 *   低数值区间（玩家 ~14 HP）下 30% ≈ 4 HP，恰好在"鸡一口 1 伤"的
 *   节奏里留出 3~4 次挨打的容错；50% 会让玩家几乎不掉血，挂机收益
 *   失去"带食物"的策略感。
 */
export function simulateCombat(input: SimulateCombatInput): CombatReport {
  const { started_at, now, enemy, rng = Math.random } = input;
  const player = input.player;
  const enemyStat = enemyStats(enemy);

  // 伤害参数：缺省用中性档（命中 100/闪避 0/无暴击/无减伤），保证旧调用方行为不变
  const formulas = getCombatFormulas();
  const playerProfile = input.player_attributes
    ? formulas.damageProfile(input.player_attributes)
    : NEUTRAL_DAMAGE_PROFILE;
  const enemyProfile = input.enemy_attributes
    ? formulas.damageProfile(input.enemy_attributes)
    : NEUTRAL_DAMAGE_PROFILE;
  const resolveDamage = formulas.resolveDamage;

  // 玩家剩余食物的工作副本：推演期间只动这份，不改入参
  const foodLeft: Record<string, number> = { ...input.food };
  // 食物食用顺序：按 item_id 字典序固定，保证同一存档推演结果可复现
  const foodOrder = Object.keys(foodLeft).sort();

  const playerMaxHp = player.max_hp;
  const enemyMaxHp = enemyStat.max_hp;

  let playerHp = playerMaxHp;
  let enemyHp = enemyMaxHp;

  const log: CombatLogEntry[] = [];
  const foodConsumed: Record<string, number> = {};

  // 双方下一次出手时刻：玩家从 started_at + interval 起手，敌人稍后
  let playerNextAt = started_at + player.interval_ms;
  let enemyNextAt = started_at + enemyStat.interval_ms;

  /** 玩家吃一口食物（如果触发了恢复条件） */
  const tryEat = (at: number) => {
    if (playerHp >= playerMaxHp * 0.3) return;
    for (const foodId of foodOrder) {
      const left = foodLeft[foodId] ?? 0;
      if (left <= 0) continue;
      // 动态查食物配置，背包里有但配置表里没有的物品不吃（防御配错）
      const heal = FOOD_HEAL[foodId];
      if (!heal) continue;
      foodLeft[foodId] = left - 1;
      foodConsumed[foodId] = (foodConsumed[foodId] ?? 0) + 1;
      playerHp = Math.min(playerMaxHp, playerHp + heal);
      log.push({ at, actor: 'player', damage: -heal, target_hp: playerHp });
      return;
    }
  };

  /**
   * 一方出手：伤害先走 old-school 减法 max(0, atk - def)，再交给可覆写的
   * resolveDamage 处理命中/区间/暴击/减伤；扣目标 HP 并记日志，返回目标是否死亡。
   *
   * 默认参数下 resolveDamage 原样返回减法结果，因此与 task-18 逐位等价。
   */
  const strike = (actor: 'player' | 'enemy', at: number): boolean => {
    if (actor === 'player') {
      const damage = resolveDamage({
        base_damage: Math.max(0, player.attack - enemyStat.defense),
        attacker: player,
        defender: enemyStat,
        attacker_profile: playerProfile,
        defender_profile: enemyProfile,
        rng,
      });
      enemyHp = Math.max(0, enemyHp - damage);
      log.push({ at, actor, damage, target_hp: enemyHp });
      return enemyHp <= 0;
    }
    // 敌人出手：同样的伤害解析，攻守双方对调
    const damage = resolveDamage({
      base_damage: Math.max(0, enemyStat.attack - player.defense),
      attacker: enemyStat,
      defender: player,
      attacker_profile: enemyProfile,
      defender_profile: playerProfile,
      rng,
    });
    playerHp = Math.max(0, playerHp - damage);
    log.push({ at, actor, damage, target_hp: playerHp });
    // 玩家被打后若血量告急且有食物，立刻吃一口再继续
    if (playerHp > 0) tryEat(at);
    return playerHp <= 0;
  };

  // —— 主循环：按时间顺序交错双方出手，直到一方死亡或推演到 now ——
  let endedAt = started_at;
  let outcome: CombatEndState = { kind: 'fighting' };

  while (true) {
    // 取下一次最早的出手方；平手时玩家先手（观感更爽，且数值上无差异）
    const playerTurn = playerNextAt <= enemyNextAt;
    const at = playerTurn ? playerNextAt : enemyNextAt;
    if (at > now) break; // 推演到目标时刻为止
    endedAt = at;

    const dead = strike(playerTurn ? 'player' : 'enemy', at);
    if (dead) {
      outcome = playerTurn ? { kind: 'victory', loot: undefined } : { kind: 'defeat' };
      break;
    }
    if (playerTurn) {
      playerNextAt += player.interval_ms;
    } else {
      enemyNextAt += enemyStat.interval_ms;
    }
  }

  // —— 胜利收尾：抽掉落、结算经验 ——
  let expGained = 0;
  const itemDrops: Record<string, number> = {};
  const equipmentDrops: Equipment[] = [];

  if (outcome.kind === 'victory') {
    // 经验与敌人等级挂钩：打高级怪回报更高（防止刷 1 级鸡到满级）
    expGained = Math.max(1, enemy.level) * 2;
    const table = enemy.loot_table_id ? findLootTableById(enemy.loot_table_id) : undefined;
    if (table) {
      const loot = rollLoot({ table, rng });
      outcome = { kind: 'victory', loot };
      if (loot?.kind === 'item') {
        itemDrops[loot.item_id] = (itemDrops[loot.item_id] ?? 0) + loot.quantity;
      } else if (loot?.kind === 'equipment') {
        equipmentDrops.push(loot.equipment);
      }
    }
  }

  return {
    started_at,
    ended_at: endedAt,
    end: outcome,
    player_hp: playerHp,
    enemy_hp: enemyHp,
    food_consumed: foodConsumed,
    log,
    exp_gained: expGained,
    equipment_drops: equipmentDrops,
    item_drops: itemDrops,
  };
}
