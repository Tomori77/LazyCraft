/**
 * 词缀生成 / 装备实例生成（rollAffix / generateEquipment）行为测试
 *
 * 覆盖 task-14 验收标准：
 *   1. rollAffix 按权重与品质门槛正确过滤候选
 *   2. rollAffix 槽位过滤：前缀词缀不会跑到后缀槽
 *   3. generateEquipment 按品质倍率 + 词缀加成算出 final_stats
 *   4. 品质超出模板 quality_range 时返回 null（防御策划错配）
 *   5. 显示名拼接规则：前缀 + 模板名 + 后缀
 */

import { describe, expect, it } from 'vitest';

import {
  AFFIX_POOL_STARTER,
  AFFIX_SHARP,
  AFFIX_STURDY,
  AFFIX_UNBREAKABLE,
  generateEquipment,
  rollAffix,
  type AffixPool,
} from './index.js';

function scriptRng(seq: number[]): () => number {
  let i = 0;
  return () => {
    const v = seq[i % seq.length];
    i += 1;
    return Math.max(0, Math.min(0.999999, v));
  };
}

describe('rollAffix', () => {
  it('按权重命中对应词缀（确定性）', () => {
    /* starter 池（common 品质）：
     * 锋利 40 / 坚固 40 / 屠鸡者 10（精巧 min=uncommon 被过滤）
     * 总权重 90，累计 [0,40) [40,80) [80,90)
     */
    expect(
      rollAffix(AFFIX_POOL_STARTER, 'common', undefined, scriptRng([0.0])),
    ).toBe(AFFIX_SHARP.id);
    expect(
      rollAffix(AFFIX_POOL_STARTER, 'common', undefined, scriptRng([0.5])),
    ).toBe(AFFIX_STURDY.id);
    /* 0.9 落在屠鸡者 */
    expect(
      rollAffix(AFFIX_POOL_STARTER, 'common', undefined, scriptRng([0.9])),
    ).toBe('chicken_slayer');
  });

  it('品质过滤：common 品质永远抽不到 min_quality=uncommon 的词缀', () => {
    /* 反复抽样都不应出现 masterful */
    for (let i = 0; i < 20; i += 1) {
      const hit = rollAffix(
        AFFIX_POOL_STARTER,
        'common',
        'prefix',
        scriptRng([i / 20]),
      );
      expect(hit).not.toBe('masterful');
    }
  });

  it('品质过滤反向：uncommon 品质可以抽到 masterful', () => {
    /* uncommon 下 starter 池前缀：锋利 40 / 坚固 40 / 精巧 10，总 90
     * rng=0.9 → 累计 81/90 落在精巧 */
    const hit = rollAffix(AFFIX_POOL_STARTER, 'uncommon', 'prefix', scriptRng([0.9]));
    expect(hit).toBe('masterful');
  });

  it('槽位过滤：slot=suffix 时只抽后缀词缀', () => {
    /* starter 池中唯一后缀（min_quality=common）是 chicken_slayer */
    const hit = rollAffix(AFFIX_POOL_STARTER, 'common', 'suffix', scriptRng([0.1]));
    expect(hit).toBe('chicken_slayer');
  });

  it('池内无可抽词缀时返回 null（调用方决定给装备留空槽）', () => {
    const emptyPool: AffixPool = { id: 'empty', entries: [] };
    expect(rollAffix(emptyPool, 'common', 'prefix', scriptRng([0.5]))).toBeNull();

    /* 池里全是 rare 起步的词缀，common 品质一个都配不上 */
    const highOnly: AffixPool = {
      id: 'high',
      entries: [{ affix: AFFIX_UNBREAKABLE.id, weight: 100 }],
    };
    expect(rollAffix(highOnly, 'common', 'suffix', scriptRng([0.5]))).toBeNull();
  });
});

describe('generateEquipment', () => {
  it('白装 + 锋利前缀：数值 = 基础 × 1.0 + 词缀加成', () => {
    const eq = generateEquipment({
      template_id: 'short_sword',
      quality: 'common',
      affix_pool_ids: ['starter'],
      /* 前缀 rng=0.0 → 锋利；后缀 rng=0.0 → starter 中唯一 common 后缀 = 屠鸡者 */
      rng: scriptRng([0.0, 0.0]),
    });

    expect(eq).not.toBeNull();
    if (!eq) return;
    expect(eq.quality).toBe('common');
    expect(eq.prefix_affix).toBe('sharp');
    expect(eq.suffix_affix).toBe('chicken_slayer');
    /* 基础攻 2 + 锋利 1 + 屠鸡者 1 = 4 */
    expect(eq.final_stats).toEqual({ attack: 4, defense: 0, hp: 0 });
    expect(eq.display_name).toBe('锋利的短剑·屠鸡者');
  });

  it('蓝装：属性按 1.25 倍率放大并四舍五入', () => {
    const eq = generateEquipment({
      template_id: 'short_sword',
      quality: 'uncommon',
      affix_pool_ids: ['starter'],
      /* 前缀命中"坚固"（防御向，便于和攻击放大隔离）
       * uncommon 前缀：锋利 40 / 坚固 40 / 精巧 10，rng=0.5 → 坚固
       * 后缀池 uncommon 下只有屠鸡者 → 必中
       */
      rng: scriptRng([0.5, 0.0]),
    });

    expect(eq).not.toBeNull();
    if (!eq) return;
    /* base 攻 2 * 1.25 = 2.5 → round = 3；坚固 +1 防 → 攻 3、防 1；屠鸡者 +1 攻 → 攻 4 */
    expect(eq.prefix_affix).toBe('sturdy');
    expect(eq.suffix_affix).toBe('chicken_slayer');
    expect(eq.final_stats).toEqual({ attack: 4, defense: 1, hp: 0 });
  });

  it('模板没有后缀槽时 suffix_affix 恒为 null', () => {
    const eq = generateEquipment({
      template_id: 'worn_leather_armor',
      quality: 'common',
      affix_pool_ids: ['starter'],
      rng: scriptRng([0.0]),
    });
    expect(eq).not.toBeNull();
    if (!eq) return;
    expect(eq.suffix_affix).toBeNull();
  });

  it('品质超出模板允许区间时返回 null（防御配置错）', () => {
    /* worn_leather_armor 只允许 common~uncommon，硬塞 epic 应该被拒绝 */
    const eq = generateEquipment({
      template_id: 'worn_leather_armor',
      quality: 'epic',
      affix_pool_ids: ['starter'],
      rng: scriptRng([0.0]),
    });
    expect(eq).toBeNull();
  });

  it('未知模板 id 返回 null 而不是抛错', () => {
    const eq = generateEquipment({
      template_id: 'not_exist',
      quality: 'common',
      affix_pool_ids: [],
      rng: scriptRng([0.5]),
    });
    expect(eq).toBeNull();
  });

  it('词缀池 id 未注册时对应槽位留空但仍能生成装备', () => {
    const eq = generateEquipment({
      template_id: 'short_sword',
      quality: 'common',
      affix_pool_ids: ['not_exist_pool'],
      rng: scriptRng([0.0, 0.0]),
    });
    expect(eq).not.toBeNull();
    if (!eq) return;
    expect(eq.prefix_affix).toBeNull();
    expect(eq.suffix_affix).toBeNull();
    /* 没有词缀，纯白板属性 */
    expect(eq.final_stats).toEqual({ attack: 2, defense: 0, hp: 0 });
    expect(eq.display_name).toBe('短剑');
  });

  it('显示名拼接：只有前缀 / 只有后缀 / 全无三种形态', () => {
    /* 只有前缀：suffix 槽被 worn_armor 模板天然置 0 */
    const onlyPrefix = generateEquipment({
      template_id: 'worn_leather_armor',
      quality: 'common',
      affix_pool_ids: ['starter'],
      rng: scriptRng([0.0]),
    });
    expect(onlyPrefix?.display_name).toBe('锋利的破旧的皮甲');

    /* 全无：词缀池 id 未注册 */
    const none = generateEquipment({
      template_id: 'short_sword',
      quality: 'common',
      affix_pool_ids: [],
      rng: scriptRng([0.5]),
    });
    expect(none?.display_name).toBe('短剑');
  });
});
