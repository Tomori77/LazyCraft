/**
 * 装备实例生成（《框架设计》6.1 的 player_equipment 数据形态在内存中的投影）。
 *
 * 一件"已经掉落生成"的装备 = 模板 + 品质 + 至多两个词缀（前 / 后）。
 * 属性最终值由 generateEquipment 在生成那一刻算死并写入实例 ——
 * 之后装备在仓库、市场、战斗里流转时永远不再重算，
 * 保证玩家看到的数值就是它背包里那一件的数值（避免"穿一会儿属性变了"）。
 *
 * 为什么不在实例里只存 template_id + 词缀 id，每次用的时候再算属性？
 *   策划可能要回调某个词缀的数值；如果数值是"用时计算"，
 *   全服所有已生成装备的属性会瞬间变化，玩家会感知到"我的装备被砍了"。
 *   把属性快照进实例，旧的装备保留旧数值（这就是 ARPG 里"遗产装"的做法）。
 */

import { AFFIXES, AFFIX_POOLS, rollAffix, type Affix, type AffixPool } from './affix-pool.js';
import { findTemplateById } from './equipment-template.js';
import type { Quality } from '../types.js';

/* ------------------------------------------------------------------ */
/* 类型                                                                  */
/* ------------------------------------------------------------------ */

/** 一件已生成的装备（数据库 player_equipment 行的运行时形态） */
export interface Equipment {
  /** 模板 id */
  template_id: string;
  /** 显示名（含词缀，例如 "锋利的短剑·屠鸡者"） */
  display_name: string;
  /** 品质 */
  quality: Quality;
  /** 词缀（槽位为空时为 null，与 6.1 的 prefix_affix / suffix_affix 对齐） */
  prefix_affix: Affix['id'] | null;
  suffix_affix: Affix['id'] | null;
  /** 最终属性快照（基础 × 品质倍率 + 词缀加成） */
  final_stats: {
    attack: number;
    defense: number;
    hp: number;
  };
}

/** generateEquipment 入参 */
export interface GenerateEquipmentInput {
  template_id: string;
  /** 已确定的品质（由 rollQuality 提前抽出；不接受"随机"，保证可回放） */
  quality: Quality;
  /** 词缀池 id 列表，按顺序尝试，取第一个有可用词缀的池 */
  affix_pool_ids: ReadonlyArray<AffixPool['id']>;
  /** 0~1 均匀随机数 */
  rng: () => number;
}

/* ------------------------------------------------------------------ */
/* 品质 → 属性倍率（平衡参数，调整时只动这一处）                          */
/* ------------------------------------------------------------------ */

/**
 * 品质对基础属性的倍率。
 *
 * 为什么用乘法而不是直接 +N？
 *   装备模板基础属性跨度大（短剑 2 攻 vs 未来的巨斧 30 攻），加法加成
 *   会让"蓝巨斧"只比"白巨斧"强一点点——体感不出颜色差异；
 *   乘法则让品质天然按装备自身强度伸缩，符合玩家对"紫装 ≈ 白装 × 1.5"的预期。
 */
const QUALITY_STAT_MULTIPLIER: Readonly<Record<Quality, number>> = {
  common: 1.0,
  uncommon: 1.25,
  rare: 1.6,
  epic: 2.0,
};

/* ------------------------------------------------------------------ */
/* 核心生成函数                                                          */
/* ------------------------------------------------------------------ */

/**
 * 生成一件装备实例；模板 id 不存在或品质超出模板允许区间时返回 null。
 *
 * 为什么返回 null 而不是抛错？
 *   上层（rollLoot / 市场购买回放 / 赛季迁移）在配置错时应该得到"没有装备"，
 *   而不是让整个战斗 / 回放流程崩掉；这里 null = 配置错误的安全出口。
 *   真正的配置错误由启动期 validate（task-15）暴露。
 */
export function generateEquipment(input: GenerateEquipmentInput): Equipment | null {
  const { template_id, quality, affix_pool_ids, rng } = input;

  const template = findTemplateById(template_id);
  if (!template) return null;

  /* 品质必须在模板允许区间内；超界视为配置错误，返回 null 兜底 */
  if (!isQualityInRange(quality, template.quality_range.min, template.quality_range.max)) {
    return null;
  }

  /* 抽前后词缀：
   * 槽位为 0 时词缀位恒为 null；
   * 槽位 > 0 时按 affix_pool_ids 顺序尝试，取第一个产出词缀的池。
   */
  const prefix_affix =
    template.affix_slots.prefix > 0
      ? rollFromPools(affix_pool_ids, quality, 'prefix', rng)
      : null;
  const suffix_affix =
    template.affix_slots.suffix > 0
      ? rollFromPools(affix_pool_ids, quality, 'suffix', rng)
      : null;

  /* 最终属性 = round(基础 × 品质倍率) + 词缀加成 */
  const multiplier = QUALITY_STAT_MULTIPLIER[quality];
  const addStats = collectAffixStats(prefix_affix, suffix_affix);

  const final_stats = {
    attack: Math.round((template.base_stats.attack ?? 0) * multiplier) + addStats.attack,
    defense: Math.round((template.base_stats.defense ?? 0) * multiplier) + addStats.defense,
    hp: Math.round((template.base_stats.hp ?? 0) * multiplier) + addStats.hp,
  };

  /* 显示名 = 前缀名 + 模板名 + 后缀名（后缀自带分隔符，见词缀表里的 "·xxx"） */
  const display_name =
    (prefix_affix ? AFFIXES[prefix_affix]?.name ?? '' : '') +
    template.base_name +
    (suffix_affix ? AFFIXES[suffix_affix]?.name ?? '' : '');

  return {
    template_id,
    display_name,
    quality,
    prefix_affix,
    suffix_affix,
    final_stats,
  };
}

/* ------------------------------------------------------------------ */
/* 内部工具（纯函数，不导出）                                              */
/* ------------------------------------------------------------------ */

/** 品质是否落在 [min, max] 区间内（按 QUALITY_ORDER 里的稀有度递进比较） */
function isQualityInRange(q: Quality, min: Quality, max: Quality): boolean {
  const rank = (x: Quality): number => {
    switch (x) {
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
  return rank(q) >= rank(min) && rank(q) <= rank(max);
}

/**
 * 按 affix_pool_ids 顺序尝试抽词缀；返回第一个抽到的词缀 id。
 *
 * 为什么"顺序尝试"而不是"合并池"？
 *   策划配的词缀池是有主题优先级的（先专属池、后通用池），
 *   合并会把专属词缀的权重稀释掉，失去"词缀池分主题"的意义。
 */
function rollFromPools(
  poolIds: ReadonlyArray<AffixPool['id']>,
  quality: Quality,
  slot: 'prefix' | 'suffix',
  rng: () => number,
): Affix['id'] | null {
  for (const id of poolIds) {
    /* 未注册的池 id 视为跳过——rollAffix 对空池 / 全过滤后也会返回 null，
     * 由它兜底返回类型，这里只管"顺序尝试"的分发语义 */
    const pool = AFFIX_POOLS[id];
    if (!pool) continue;
    const affixId = rollAffix(pool, quality, slot, rng);
    if (affixId !== null) return affixId;
  }
  return null;
}

/** 汇总前后词缀的属性加成 */
function collectAffixStats(
  prefix: Affix['id'] | null,
  suffix: Affix['id'] | null,
): { attack: number; defense: number; hp: number } {
  const total = { attack: 0, defense: 0, hp: 0 };
  for (const id of [prefix, suffix]) {
    if (!id) continue;
    const affix = AFFIXES[id];
    if (!affix) continue;
    total.attack += affix.add_stats.attack ?? 0;
    total.defense += affix.add_stats.defense ?? 0;
    total.hp += affix.add_stats.hp ?? 0;
  }
  return total;
}
