/**
 * 掉落计算（rollLoot / rollQuality）行为测试
 *
 * 覆盖 task-14 验收标准：
 *   1. 品质权重按权重比例收敛（统计性）
 *   2. rollLoot 对 item 词条能稳定产出预期数量区间
 *   3. rollLoot 能走到 equipment 词条并生成带词缀的装备
 *   4. 词条没有覆盖 quality_weights 时回退到表级权重
 *   5. 表级 / 词条级权重全空时优雅降级（返回 undefined 而不是抛错）
 */

import { describe, expect, it } from 'vitest';

import {
  LOOT_TABLE_CHICKEN,
  rollLoot,
  rollQuality,
  type LootTable,
} from './index.js';

/**
 * 确定性 rng 工厂：依次吐给定的浮点序列，到底后循环。
 * 掉落测试需要"精确命中某一权重桶"，必须用脚本化 rng；
 * 真实游戏走 Math.random()，由调用方注入。
 */
function scriptRng(seq: number[]): () => number {
  let i = 0;
  return () => {
    const v = seq[i % seq.length];
    i += 1;
    /* 防止调用方传 1.0 这种临界值 */
    return Math.max(0, Math.min(0.999999, v));
  };
}

describe('rollQuality', () => {
  it('全空权重时兜底返回 common（防御策划配错）', () => {
    expect(rollQuality({}, () => 0.5)).toBe('common');
    expect(rollQuality({ common: 0, uncommon: 0 }, () => 0.5)).toBe('common');
  });

  it('按权重命中对应品质桶（确定性脚本验证边界）', () => {
    /* 权重 70/20/8/2：累计区间 [0,70) [70,90) [90,98) [98,100) */
    const weights = { common: 70, uncommon: 20, rare: 8, epic: 2 };
    expect(rollQuality(weights, () => 0.0)).toBe('common');
    expect(rollQuality(weights, () => 0.69)).toBe('common');
    expect(rollQuality(weights, () => 0.70)).toBe('uncommon');
    expect(rollQuality(weights, () => 0.89)).toBe('uncommon');
    expect(rollQuality(weights, () => 0.90)).toBe('rare');
    expect(rollQuality(weights, () => 0.97)).toBe('rare');
    expect(rollQuality(weights, () => 0.98)).toBe('epic');
    expect(rollQuality(weights, () => 0.999)).toBe('epic');
  });

  it('统计意义下稀有度排序 common > uncommon > rare > epic', () => {
    /* 用简单 LCG 保证确定性，避免测试偶发失败 */
    let seed = 42;
    const lcg = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const counts: Record<string, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 0,
    };
    const N = 10_000;
    for (let i = 0; i < N; i += 1) {
      counts[rollQuality({ common: 70, uncommon: 20, rare: 8, epic: 2 }, lcg)] += 1;
    }
    /* 允许 ±5% 的浮动：只要相对顺序稳定即可，不追求精确百分比 */
    expect(counts.common).toBeGreaterThan(counts.uncommon);
    expect(counts.uncommon).toBeGreaterThan(counts.rare);
    expect(counts.rare).toBeGreaterThan(counts.epic);
    /* 白装占比必须在 65%~75% 之间（期望 70%） */
    expect(counts.common / N).toBeGreaterThan(0.65);
    expect(counts.common / N).toBeLessThan(0.75);
  });
});

describe('rollLoot', () => {
  it('空表 / 全 0 权重表：返回 undefined', () => {
    const emptyTable: LootTable = {
      id: 'empty',
      monster_id: 'ghost',
      quality_weights: {},
      drops: [],
    };
    expect(rollLoot({ table: emptyTable, rng: () => 0.5 })).toBeUndefined();

    const zeroTable: LootTable = {
      ...LOOT_TABLE_CHICKEN,
      id: 'zero',
      drops: LOOT_TABLE_CHICKEN.drops.map((d) => ({ ...d, weight: 0 })),
    };
    expect(rollLoot({ table: zeroTable, rng: () => 0.5 })).toBeUndefined();
  });

  it('命中 item 词条时返回稳定数量区间的物品', () => {
    /* 构造一张只有羽毛词条的表，避免装备分支干扰 */
    const featherOnly: LootTable = {
      ...LOOT_TABLE_CHICKEN,
      id: 'feather_only',
      drops: [{ kind: 'item', item_id: 'feather', weight: 100, min: 1, max: 2 }],
    };
    /* 词条选择 rng=0（命中羽毛），数量 rng=0 → min=1 */
    const r1 = rollLoot({ table: featherOnly, rng: scriptRng([0, 0]) });
    expect(r1).toEqual({ kind: 'item', item_id: 'feather', quantity: 1 });

    /* 数量 rng=0.999 → max=2 */
    const r2 = rollLoot({ table: featherOnly, rng: scriptRng([0, 0.999]) });
    expect(r2).toEqual({ kind: 'item', item_id: 'feather', quantity: 2 });
  });

  it('鸡掉落表：低权重桶命中"破旧的皮甲"，生成装备', () => {
    /* 鸡表 drops 顺序：feather(80) → worn_armor(15) → short_sword(5)
     * 词条选择 rng 取 0.85 → 累计 85/100 命中 worn_armor。
     * 品质 rng 取 0.5 → 70/20/8/2 中 50 落在 common。
     * 词缀 rng 取 0.1 → starter 池前缀桶（锋利 40 / 坚固 40 / 精巧 10 / 屠鸡者 10），
     * 品质 = common 过滤后剩 [锋利 40, 坚固 40, 屠鸡者 10]，总 90；10/90=0.11 落在锋利。
     */
    const result = rollLoot({
      table: LOOT_TABLE_CHICKEN,
      rng: scriptRng([0.85, 0.5, 0.1]),
    });

    expect(result).toBeDefined();
    expect(result?.kind).toBe('equipment');
    if (result?.kind !== 'equipment') return;

    const eq = result.equipment;
    expect(eq.template_id).toBe('worn_leather_armor');
    expect(eq.quality).toBe('common');
    expect(eq.prefix_affix).toBe('sharp');
    /* worn_leather_armor 没有 suffix 槽 */
    expect(eq.suffix_affix).toBeNull();
    /* 白板皮甲 1 防 2 血 + 锋利 +1 攻 */
    expect(eq.final_stats).toEqual({ attack: 1, defense: 1, hp: 2 });
    expect(eq.display_name).toBe('锋利的破旧的皮甲');
  });

  it('词条覆盖 quality_weights 时，装备品质按词条权重而不是表级', () => {
    /* 词条 short_sword 覆盖权重 {uncommon:20, rare:8, epic:2} —— 不允许 common */
    const result = rollLoot({
      table: LOOT_TABLE_CHICKEN,
      /* 词条 rng=0.99 命中 short_sword；品质 rng=0.0 → 在覆盖权重里命中 uncommon */
      rng: scriptRng([0.99, 0.0, 0.3, 0.3]),
    });

    expect(result?.kind).toBe('equipment');
    if (result?.kind !== 'equipment') return;
    expect(result.equipment.template_id).toBe('short_sword');
    expect(result.equipment.quality).toBe('uncommon');
    /* 短剑 base 攻 2 * 1.25 = 2.5 → 四舍五入 3；再叠词缀。
     * uncommon 品质下 starter 池可用前缀：锋利(40)/坚固(40)/精巧(10)（min_quality ≤ uncommon）
     * rng=0.3 命中 0.3*90=27 → 锋利(40)，attack +1。
     * 后缀词缀：starter 池中 slot=suffix 且 min_quality ≤ uncommon 的只有屠鸡者(10)，
     * rng=0.3 → 0.3*10=3 落在屠鸡者，attack +1。
     * 总 attack = 3 + 1 + 1 = 5。
     */
    expect(result.equipment.final_stats).toEqual({ attack: 5, defense: 0, hp: 0 });
  });

  it('item 词条的权重为 0 时不会被命中', () => {
    const noFeather: LootTable = {
      ...LOOT_TABLE_CHICKEN,
      id: 'no_feather',
      drops: [
        { kind: 'item', item_id: 'feather', weight: 0, min: 1, max: 2 },
        { kind: 'item', item_id: 'wood', weight: 100, min: 1, max: 1 },
      ],
    };
    /* rng=0 本应在有权重时命中第一条；这里 feather 权重 0 被跳过 */
    const r = rollLoot({ table: noFeather, rng: scriptRng([0, 0]) });
    expect(r).toEqual({ kind: 'item', item_id: 'wood', quantity: 1 });
  });
});
