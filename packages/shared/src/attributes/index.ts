/**
 * 人物属性体系（task-34 / P4-5）。
 *
 * 为什么属性用 Record<id, number> 而不是一个带 12 个字段的接口？
 *   铁律"内容即数据"：DLC 加一个新属性不应改引擎的字段定义与所有序列化点。
 *   属性在存档、接口、聚合函数里统一是"映射"，引擎只认识"id + 数值"，
 *   不认识"生命"或"暴击"；显示名与默认值由注册的元数据（AttributeDefinition）提供。
 *
 * 为什么聚合函数不校验未知 id？
 *   聚合是纯数值运算，DLC 可以带自己的属性 id 进来而无需先注册；
 *   校验放在"可诊断"层（findUnregisteredAttributes / Registry.validate），
 *   让配置错误可见但不阻断结算——与 Registry 的容错哲学一致。
 *
 * 为什么属性元数据要进 Registry（ContentKind 'attribute'）？
 *   /api/content 与前端属性面板都从 Registry 快照取元数据，DLC 登记的新属性
 *   会自然出现在快照里；前端按 name_key 走 i18n、按 order 排版，零硬编码字段。
 */

import type { AttributeDefinition } from '../types.js';

/* ------------------------------------------------------------------ */
/* 属性 id 稳定集合                                                      */
/* ------------------------------------------------------------------ */

/**
 * 本体属性 id。
 *
 * 为什么 attack 也在集合里？
 *   现有战斗引擎（task-18）是"平坦攻击力 - 防御"的减法公式，DLC 到来前不会推翻；
 *   把 attack 作为一个普通属性登记，既让装备 final_stats.attack 有地方落，
 *   又让 `playerStats()` 能从聚合结果派生，保持与旧行为完全等价。
 */
export const ATTRIBUTE_IDS = {
  HP: 'hp',
  MP: 'mp',
  ATTACK: 'attack',
  DEFENSE: 'defense',
  DAMAGE_REDUCTION: 'damage_reduction',
  EVASION_MELEE: 'evasion_melee',
  EVASION_RANGED: 'evasion_ranged',
  EVASION_MAGIC: 'evasion_magic',
  ACCURACY: 'accuracy',
  MAX_HIT: 'max_hit',
  MIN_HIT: 'min_hit',
  CRIT_CHANCE: 'crit_chance',
  CRIT_DAMAGE: 'crit_damage',
} as const;

/** 本体属性 id 的类型联合；DLC 属性不在此列（保持开放字符串） */
export type AttributeId = (typeof ATTRIBUTE_IDS)[keyof typeof ATTRIBUTE_IDS];

/**
 * 属性值映射：属性 id → 数值。
 *
 * 刻意用 `Record<string, number>`（而非 `Partial<Record<AttributeId, number>>`）
 * 让 DLC 的新属性 id 无需改动本类型即可参与聚合与传输。
 */
export type PlayerAttributes = Readonly<Record<string, number>>;

/* ------------------------------------------------------------------ */
/* 属性元数据（注册进 Registry / 快照）                                    */
/* ------------------------------------------------------------------ */

/**
 * 通用基础属性（示例量）。
 *
 * 注意：这是"没有玩家上下文"时的通用基线，也是属性元数据的默认值来源。
 *   实际战斗/面板里，生命与攻击由攻击等级派生（见 combat 的 playerAttributes），
 *   以保持与 task-18 的战斗平衡完全等价——这是本任务的硬要求；
 *   通用基线里的 100 只作为 DLC 覆写公式时的目标量级参考与缺省兜底。
 */
export const ATTRIBUTE_BASE: PlayerAttributes = Object.freeze({
  [ATTRIBUTE_IDS.HP]: 100,
  [ATTRIBUTE_IDS.MP]: 30,
  [ATTRIBUTE_IDS.ATTACK]: 0,
  [ATTRIBUTE_IDS.DEFENSE]: 0,
  [ATTRIBUTE_IDS.DAMAGE_REDUCTION]: 0,
  [ATTRIBUTE_IDS.EVASION_MELEE]: 0,
  [ATTRIBUTE_IDS.EVASION_RANGED]: 0,
  [ATTRIBUTE_IDS.EVASION_MAGIC]: 0,
  [ATTRIBUTE_IDS.ACCURACY]: 0,
  [ATTRIBUTE_IDS.MAX_HIT]: 0,
  [ATTRIBUTE_IDS.MIN_HIT]: 0,
  [ATTRIBUTE_IDS.CRIT_CHANCE]: 0,
  [ATTRIBUTE_IDS.CRIT_DAMAGE]: 0,
});

/** 本体属性元数据：order 决定面板顺序，category 供前端分组，percent 决定是否加 '%' */
export const ATTRIBUTE_DEFINITIONS: readonly AttributeDefinition[] = Object.freeze([
  {
    id: ATTRIBUTE_IDS.HP,
    name_key: 'attribute.hp.name',
    default_value: ATTRIBUTE_BASE[ATTRIBUTE_IDS.HP],
    order: 1,
    category: 'vitals',
    description_key: 'attribute.hp.desc',
  },
  {
    id: ATTRIBUTE_IDS.MP,
    name_key: 'attribute.mp.name',
    default_value: ATTRIBUTE_BASE[ATTRIBUTE_IDS.MP],
    order: 2,
    category: 'vitals',
    description_key: 'attribute.mp.desc',
  },
  {
    id: ATTRIBUTE_IDS.ATTACK,
    name_key: 'attribute.attack.name',
    default_value: ATTRIBUTE_BASE[ATTRIBUTE_IDS.ATTACK],
    order: 3,
    category: 'offense',
    description_key: 'attribute.attack.desc',
  },
  {
    id: ATTRIBUTE_IDS.DEFENSE,
    name_key: 'attribute.defense.name',
    default_value: ATTRIBUTE_BASE[ATTRIBUTE_IDS.DEFENSE],
    order: 4,
    category: 'defense',
    description_key: 'attribute.defense.desc',
  },
  {
    id: ATTRIBUTE_IDS.DAMAGE_REDUCTION,
    name_key: 'attribute.damage_reduction.name',
    default_value: ATTRIBUTE_BASE[ATTRIBUTE_IDS.DAMAGE_REDUCTION],
    order: 5,
    category: 'defense',
    percent: true,
    description_key: 'attribute.damage_reduction.desc',
  },
  {
    id: ATTRIBUTE_IDS.EVASION_MELEE,
    name_key: 'attribute.evasion_melee.name',
    default_value: ATTRIBUTE_BASE[ATTRIBUTE_IDS.EVASION_MELEE],
    order: 6,
    category: 'defense',
    description_key: 'attribute.evasion_melee.desc',
  },
  {
    id: ATTRIBUTE_IDS.EVASION_RANGED,
    name_key: 'attribute.evasion_ranged.name',
    default_value: ATTRIBUTE_BASE[ATTRIBUTE_IDS.EVASION_RANGED],
    order: 7,
    category: 'defense',
    description_key: 'attribute.evasion_ranged.desc',
  },
  {
    id: ATTRIBUTE_IDS.EVASION_MAGIC,
    name_key: 'attribute.evasion_magic.name',
    default_value: ATTRIBUTE_BASE[ATTRIBUTE_IDS.EVASION_MAGIC],
    order: 8,
    category: 'defense',
    description_key: 'attribute.evasion_magic.desc',
  },
  {
    id: ATTRIBUTE_IDS.ACCURACY,
    name_key: 'attribute.accuracy.name',
    default_value: ATTRIBUTE_BASE[ATTRIBUTE_IDS.ACCURACY],
    order: 9,
    category: 'offense',
    description_key: 'attribute.accuracy.desc',
  },
  {
    id: ATTRIBUTE_IDS.MAX_HIT,
    name_key: 'attribute.max_hit.name',
    default_value: ATTRIBUTE_BASE[ATTRIBUTE_IDS.MAX_HIT],
    order: 10,
    category: 'offense',
    description_key: 'attribute.max_hit.desc',
  },
  {
    id: ATTRIBUTE_IDS.MIN_HIT,
    name_key: 'attribute.min_hit.name',
    default_value: ATTRIBUTE_BASE[ATTRIBUTE_IDS.MIN_HIT],
    order: 11,
    category: 'offense',
    description_key: 'attribute.min_hit.desc',
  },
  {
    id: ATTRIBUTE_IDS.CRIT_CHANCE,
    name_key: 'attribute.crit_chance.name',
    default_value: ATTRIBUTE_BASE[ATTRIBUTE_IDS.CRIT_CHANCE],
    order: 12,
    category: 'offense',
    percent: true,
    description_key: 'attribute.crit_chance.desc',
  },
  {
    id: ATTRIBUTE_IDS.CRIT_DAMAGE,
    name_key: 'attribute.crit_damage.name',
    default_value: ATTRIBUTE_BASE[ATTRIBUTE_IDS.CRIT_DAMAGE],
    order: 13,
    category: 'offense',
    percent: true,
    description_key: 'attribute.crit_damage.desc',
  },
]);

/** 属性 id → 元数据；未登记 id 取不到（由 findUnregisteredAttributes 报出） */
export const ATTRIBUTE_DEFINITION_BY_ID: Readonly<Record<string, AttributeDefinition>> =
  Object.freeze(
    Object.fromEntries(ATTRIBUTE_DEFINITIONS.map((def) => [def.id, def])),
  );

/** 本体已登记的属性 id 集合（诊断用） */
export function registeredAttributeIds(): Set<string> {
  return new Set(ATTRIBUTE_DEFINITIONS.map((def) => def.id));
}

/* ------------------------------------------------------------------ */
/* 属性贡献聚合（纯函数）                                                  */
/* ------------------------------------------------------------------ */

/**
 * 把"基础值 + 装备 + 其它来源（DLC/被动）"聚合成最终属性。
 *
 * 为什么是"加法聚合"而不是每属性一个公式？
 *   本体的属性来源在框架期只有"基础 + 装备"，加法已足够且可解释；
 *   需要乘区/条件加成的 DLC 可以在调用前把结果算进 extras，或覆写战斗公式。
 *
 * 未知属性 id 原样进入结果（DLC 增量），非有限数按 0 处理（脏存档不污染整张表）。
 */
export function sumAttributeContributions(
  base: Readonly<Record<string, number>> = {},
  equipment: Readonly<Record<string, number>> = {},
  extras: ReadonlyArray<Readonly<Record<string, number>>> = [],
): PlayerAttributes {
  const total: Record<string, number> = {};
  const add = (source: Readonly<Record<string, number>>) => {
    for (const [id, raw] of Object.entries(source)) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      total[id] = (total[id] ?? 0) + raw;
    }
  };
  add(base);
  add(equipment);
  for (const extra of extras) add(extra);
  return total;
}

/**
 * 找出属性表里"未登记"的 id。
 *
 * 为什么单独成函数而不是在聚合里抛错？
 *   未登记属性在开发期是配置错误，在运行期可能是 DLC 内容尚未加载；
 *   返回可诊断的 id 列表让调用方决定是警告、记日志还是拒绝，
 *   而不是让一次结算因为一个陌生 id 整段崩掉。
 */
export function findUnregisteredAttributes(
  attributes: Readonly<Record<string, number>>,
  registeredIds: ReadonlySet<string> = registeredAttributeIds(),
): string[] {
  return Object.keys(attributes)
    .filter((id) => !registeredIds.has(id))
    .sort();
}
