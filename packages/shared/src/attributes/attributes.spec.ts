/**
 * 人物属性体系单测（task-34 / P4-5）。
 *
 * 覆盖：
 *   1. 本体属性 id 稳定集合与元数据（order 唯一、默认值有限）
 *   2. 聚合纯函数：基础 + 装备 + extras；未知属性 id 原样接纳
 *   3. 脏值（非数/NaN/Infinity）不污染结果
 *   4. 未登记属性的可诊断检测
 */

import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_BASE,
  ATTRIBUTE_DEFINITIONS,
  ATTRIBUTE_IDS,
  findUnregisteredAttributes,
  registeredAttributeIds,
  sumAttributeContributions,
} from './index.js';

describe('属性 id 与元数据', () => {
  it('稳定集合覆盖 P4-5 要求的全部属性', () => {
    const ids = Object.values(ATTRIBUTE_IDS);
    for (const required of [
      'hp',
      'mp',
      'defense',
      'damage_reduction',
      'evasion_melee',
      'evasion_ranged',
      'evasion_magic',
      'accuracy',
      'max_hit',
      'min_hit',
      'crit_chance',
      'crit_damage',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('每条元数据的 order 唯一、default_value 为有限数、name_key 非空', () => {
    const orders = new Set<number>();
    for (const def of ATTRIBUTE_DEFINITIONS) {
      expect(def.name_key.length).toBeGreaterThan(0);
      expect(Number.isFinite(def.default_value)).toBe(true);
      expect(orders.has(def.order)).toBe(false);
      orders.add(def.order);
    }
  });

  it('基础常量含生命 100 / 魔力 30 / 防御 0，其余本体属性存在', () => {
    expect(ATTRIBUTE_BASE[ATTRIBUTE_IDS.HP]).toBe(100);
    expect(ATTRIBUTE_BASE[ATTRIBUTE_IDS.MP]).toBe(30);
    expect(ATTRIBUTE_BASE[ATTRIBUTE_IDS.DEFENSE]).toBe(0);
    for (const def of ATTRIBUTE_DEFINITIONS) {
      expect(Object.prototype.hasOwnProperty.call(ATTRIBUTE_BASE, def.id)).toBe(true);
    }
  });
});

describe('sumAttributeContributions', () => {
  it('基础 + 装备 + 多个 extras 逐项相加', () => {
    const total = sumAttributeContributions(
      { hp: 100, attack: 5 },
      { hp: 10, defense: 2 },
      [{ attack: 1 }, { crit_chance: 5 }],
    );
    expect(total).toEqual({ hp: 110, attack: 6, defense: 2, crit_chance: 5 });
  });

  it('缺失的键不出现，空来源不产生属性', () => {
    expect(sumAttributeContributions()).toEqual({});
    expect(sumAttributeContributions({}, {}, [])).toEqual({});
  });

  it('接纳未知属性 id（DLC 增量），不改引擎', () => {
    const total = sumAttributeContributions(
      { hp: 100 },
      { lifesteal: 3 } as Record<string, number>,
      [{ lifesteal: 2, berserk: 1 } as Record<string, number>],
    );
    expect(total.hp).toBe(100);
    expect(total.lifesteal).toBe(5);
    expect(total.berserk).toBe(1);
  });

  it('脏值（非数 / NaN / Infinity）按跳过处理，不污染结果', () => {
    const total = sumAttributeContributions(
      { hp: 100 },
      { mp: Number.NaN, attack: Infinity } as Record<string, number>,
      [{ crit_chance: 'oops' as unknown as number }],
    );
    expect(total).toEqual({ hp: 100 });
  });
});

describe('findUnregisteredAttributes', () => {
  it('返回未登记 id 列表（排序），本体属性不报', () => {
    const unknown = findUnregisteredAttributes({
      hp: 1,
      crit_chance: 0,
      lifesteal: 1,
      berserk: 1,
    });
    expect(unknown).toEqual(['berserk', 'lifesteal']);
  });

  it('可注入自定义已登记集合（DLC 注册自己的属性后不再报警）', () => {
    const ids = registeredAttributeIds();
    ids.add('lifesteal');
    expect(findUnregisteredAttributes({ hp: 1, lifesteal: 1 }, ids)).toEqual([]);
  });
});
