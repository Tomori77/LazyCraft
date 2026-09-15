/**
 * 词缀池（《框架设计》6.1）。
 *
 * 词缀 = 装备生成时从词缀池随机抽取的"修饰名 + 属性加成"，例如
 * "锋利的短剑"（短剑模板 + 锋利词缀）。
 *
 * 为什么词缀与"装备模板"分离、按槽位（前缀/后缀）存放？
 *   6.1 的 player_equipment 数据形态是 template_id + prefix_affix + suffix_affix，
 *   一件装备最多各取一个词缀。把词缀做成独立配置、按槽引用，
 *   新增"带毒的"这种词缀时不动任何模板，只往词缀表加一行 —— 内容即数据。
 *
 * 为什么是"词缀池"而不是"词缀全表"？
 *   不同玩法阶段开放的修饰不同（新手村不掉史诗前缀，DLC 可加专属词缀池），
 *   掉落表里挂的是池 id，引擎只查池，不关心全局词缀总量。
 */

import type { Quality } from '../types.js';

/** 词缀槽位：前缀修饰名、后缀补充名（"锋利的短剑·屠鸡者"） */
export type AffixSlot = 'prefix' | 'suffix';

/** 词缀可影响的战斗属性维度，增量直接加到装备主属性上 */
export type AffixStatKey = 'attack' | 'defense' | 'hp';

/** 单个词缀定义 */
export interface Affix {
  id: string;
  /** 显示名（例如 "锋利的"），最终装备名 = 词缀名 + 模板名 */
  name: string;
  /** 只能被装到前缀或后缀槽（词缀自身语义固定，不允许"带毒的"跑去当后缀） */
  slot: AffixSlot;
  /** 属性加成：逐项相加，允许负值（减重词缀） */
  add_stats: Partial<Record<AffixStatKey, number>>;
  /** 只有装备品质 ≥ min_quality 时才允许抽到此词缀——稀有词缀配稀有装备 */
  min_quality: Quality;
}

/**
 * 词缀池：挂到掉落表上的一组可抽词缀。
 *
 * 为什么用"权重"而不是"概率百分比"？
 *   池子会随时增删条目，概率百分比重算成本高；权重只要求相对比例，
 *   新增一个词缀不需要回头把旧词缀的百分比改一遍。
 */
export interface AffixPool {
  id: string;
  /** 池内词缀：affix = 词缀表 id，weight = 相对权重 */
  entries: ReadonlyArray<{ affix: Affix['id']; weight: number }>;
}

/* ------------------------------------------------------------------ */
/* 词缀表（示例量，平衡数值留给战斗 DLC）                                 */
/* ------------------------------------------------------------------ */

/** 锋利的：战斗系最基础前缀，新手村的"第一把加攻武器"来源 */
export const AFFIX_SHARP: Affix = {
  id: 'sharp',
  name: '锋利的',
  slot: 'prefix',
  add_stats: { attack: 1 },
  min_quality: 'common',
};

/** 坚固的：防御前缀，白装也能抽到，让玩家尽早感受"词缀 = 加成"的反馈 */
export const AFFIX_STURDY: Affix = {
  id: 'sturdy',
  name: '坚固的',
  slot: 'prefix',
  add_stats: { defense: 1 },
  min_quality: 'common',
};

/** 精巧的：蓝装起步的攻击前缀（白装不再掉落，驱动玩家追蓝装） */
export const AFFIX_MASTERFUL: Affix = {
  id: 'masterful',
  name: '精巧的',
  slot: 'prefix',
  add_stats: { attack: 2 },
  min_quality: 'uncommon',
};

/** 屠鸡者：占位后缀（后缀槽通路必须有至少一条示例才能测试完整生成流程） */
export const AFFIX_CHICKEN_SLAYER: Affix = {
  id: 'chicken_slayer',
  name: '·屠鸡者',
  slot: 'suffix',
  add_stats: { attack: 1 },
  min_quality: 'common',
};

/** 坚不可摧的：紫装起步的防御后缀，演示"高品质才配拥有"的进阶词缀 */
export const AFFIX_UNBREAKABLE: Affix = {
  id: 'unbreakable',
  name: '·坚不可摧',
  slot: 'suffix',
  add_stats: { defense: 3, hp: 5 },
  min_quality: 'rare',
};

/** 全部词缀的索引表：rollLoot / generateEquipment 都从这里查词缀本体 */
export const AFFIXES: Readonly<Record<string, Affix>> = Object.freeze({
  [AFFIX_SHARP.id]: AFFIX_SHARP,
  [AFFIX_STURDY.id]: AFFIX_STURDY,
  [AFFIX_MASTERFUL.id]: AFFIX_MASTERFUL,
  [AFFIX_CHICKEN_SLAYER.id]: AFFIX_CHICKEN_SLAYER,
  [AFFIX_UNBREAKABLE.id]: AFFIX_UNBREAKABLE,
});

/* ------------------------------------------------------------------ */
/* 词缀池配置（挂到 loot_table.affix_pools 上）                           */
/* ------------------------------------------------------------------ */

/**
 * 新手村基础词缀池：白装为主、蓝紫点缀。
 *
 * 数值刻意保守——鸡是 1 级怪，让玩家第一次见词缀时不要觉得"这游戏数值爆炸"。
 */
export const AFFIX_POOL_STARTER: AffixPool = {
  id: 'starter',
  entries: [
    { affix: AFFIX_SHARP.id, weight: 40 },
    { affix: AFFIX_STURDY.id, weight: 40 },
    { affix: AFFIX_MASTERFUL.id, weight: 10 },
    { affix: AFFIX_CHICKEN_SLAYER.id, weight: 10 },
  ],
};

/**
 * 进阶防御词缀池：给后期防御向副本预留的示例。
 *
 * 挂在未来的精英怪身上——这里先放出来让 DLC 作者参考"怎么按主题切池"。
 */
export const AFFIX_POOL_BULWARK: AffixPool = {
  id: 'bulwark',
  entries: [
    { affix: AFFIX_STURDY.id, weight: 30 },
    { affix: AFFIX_UNBREAKABLE.id, weight: 10 },
  ],
};

export const AFFIX_POOLS: Readonly<Record<string, AffixPool>> = Object.freeze({
  [AFFIX_POOL_STARTER.id]: AFFIX_POOL_STARTER,
  [AFFIX_POOL_BULWARK.id]: AFFIX_POOL_BULWARK,
});

/* ------------------------------------------------------------------ */
/* 抽词缀：掉落系统的纯函数                                                */
/* ------------------------------------------------------------------ */

/**
 * 从指定词缀池抽一个词缀。
 *
 * 为什么"品质过滤 + 槽过滤"在抽词缀之前做完而不是抽完再校验？
 *   抽完发现不合法要重抽，会让"有效词缀的真实概率"不等于配置上写的权重，
 *   玩家和策划都会对不上账；过滤后按剩余权重抽，概率表就是配置表本身。
 *
 * @param pool 目标词缀池
 * @param quality 已确定的装备品质（用于 min_quality 过滤）
 * @param slot 期望的槽位；不传表示不限槽
 * @param rng 0~1 均匀随机数
 * @returns 命中的词缀 id；池内无可抽词缀时返回 null（调用方决定要不要给装备留空槽）
 */
export function rollAffix(
  pool: AffixPool,
  quality: Quality,
  slot: AffixSlot | undefined,
  rng: () => number,
): Affix['id'] | null {
  const qualityRank = (q: Quality): number => {
    switch (q) {
      case 'common':
        return 0;
      case 'uncommon':
        return 1;
      case 'rare':
        return 2;
      case 'epic':
        return 3;
    }
  };
  const targetRank = qualityRank(quality);

  const candidates = pool.entries
    .map((e) => {
      const affix = AFFIXES[e.affix];
      /* 词缀 id 未注册 / 槽位不符 / 品质不足 都视为不可抽 */
      if (!affix) return null;
      if (slot !== undefined && affix.slot !== slot) return null;
      if (qualityRank(affix.min_quality) > targetRank) return null;
      return { entry: e, affix } as const;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (candidates.length === 0) return null;

  const total = candidates.reduce((sum, c) => sum + Math.max(0, c.entry.weight), 0);
  if (total <= 0) return null;

  let cursor = rng() * total;
  for (const c of candidates) {
    cursor -= Math.max(0, c.entry.weight);
    if (cursor < 0) return c.affix.id;
  }
  return candidates[candidates.length - 1].affix.id;
}

/** 按 id 查词缀本体；找不到返回 undefined（调用方决定容错策略） */
export function findAffixById(id: string): Affix | undefined {
  return AFFIXES[id];
}

/** 按 id 查词缀池；找不到返回 undefined */
export function findAffixPoolById(id: string): AffixPool | undefined {
  return AFFIX_POOLS[id];
}
