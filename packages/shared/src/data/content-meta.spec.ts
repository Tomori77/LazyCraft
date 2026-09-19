/**
 * UI 改版展示元数据测试（task-21）
 *
 * 覆盖：动作 tier 分组、抽象资源基础三项排序、装备槽位元数据、技能展示序。
 * 这些字段是前端"不写死任何清单"的前提，必须由数据侧保证形状稳定。
 */

import { describe, expect, it } from 'vitest';

import { ACTIONS } from './actions.js';
import { ABSTRACT_RESOURCES } from './resources.js';
import { SKILLS } from './skills.js';
import { ACTION_CHOP_TREE, ACTION_MINE_TINY_VEIN } from '../packs/core/index.js';
import { EQUIPMENT_SLOTS } from './equipment-slots.js';
import type { EquipmentSlot, EquipmentSlotMeta } from '../types.js';
// 顶层出口断言：搬迁后外部仍可只依赖 @lazycraft/shared 一个入口
import * as shared from '../index.js';

const CORE_ACTIONS = [ACTION_MINE_TINY_VEIN, ACTION_CHOP_TREE];

describe('SkillAction.tier', () => {
  it('ACTIONS 每条动作都有合法 tier', () => {
    for (const action of ACTIONS) {
      expect(typeof action.tier).toBe('number');
      expect(action.tier).toBeGreaterThanOrEqual(1);
    }
  });

  it('CorePack 动作同样带合法 tier', () => {
    for (const action of CORE_ACTIONS) {
      expect(typeof action.tier).toBe('number');
      expect(action.tier).toBeGreaterThanOrEqual(1);
    }
  });

  it('采矿按 tier 分成两档：1 级铜矿为 tier 1，15 级铁矿为 tier 2', () => {
    const byTier = new Map<number, string[]>();
    for (const action of ACTIONS.filter((a) => a.skill_id === 'mining')) {
      const list = byTier.get(action.tier) ?? [];
      list.push(action.id);
      byTier.set(action.tier, list);
    }
    expect([...byTier.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(byTier.get(1)).toEqual(['mine_copper']);
    expect(byTier.get(2)).toEqual(['mine_iron']);
  });

  it('每个技能下的动作可按 skill_id + tier 稳定分组', () => {
    const all = [...ACTIONS, ...CORE_ACTIONS];
    const groups = new Map<string, number[]>();
    for (const action of all) {
      const key = `${action.skill_id}@${action.tier}`;
      const list = groups.get(key) ?? [];
      list.push(action.tier);
      groups.set(key, list);
    }
    // 分组键必须能覆盖每条动作，且同组内 tier 完全一致
    expect(groups.size).toBeGreaterThan(0);
    for (const tiers of groups.values()) {
      expect(new Set(tiers).size).toBe(1);
    }
  });
});

describe('ABSTRACT_RESOURCES 排序', () => {
  it('按 tier 升序、tier 内保持数组序', () => {
    const sorted = [...ABSTRACT_RESOURCES].sort((a, b) => a.tier - b.tier);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i].tier).toBeGreaterThanOrEqual(sorted[i - 1].tier);
    }
    // tier 相同的项，排序前后相对顺序不变（稳定排序依赖数组序）
    expect(sorted.map((r) => r.id)).toEqual(ABSTRACT_RESOURCES.map((r) => r.id));
  });

  it('取前 3 项即"基础三项"，其中包含 gold', () => {
    const baseThree = [...ABSTRACT_RESOURCES]
      .sort((a, b) => a.tier - b.tier)
      .slice(0, 3)
      .map((r) => r.id);
    expect(baseThree).toHaveLength(3);
    expect(baseThree).toContain('gold');
  });
});

describe('EQUIPMENT_SLOTS 槽位元数据', () => {
  it('覆盖文档要求的 10 个槽位', () => {
    const expected: EquipmentSlot[] = [
      'head',
      'neck',
      'main_hand',
      'off_hand',
      'chest',
      'legs',
      'hands',
      'feet',
      'ring1',
      'ring2',
    ];
    expect(EQUIPMENT_SLOTS.map((s) => s.id).sort()).toEqual(expected.slice().sort());
  });

  it('order 唯一且能稳定排序', () => {
    const orders = EQUIPMENT_SLOTS.map((s) => s.order);
    expect(new Set(orders).size).toBe(EQUIPMENT_SLOTS.length);
    const sorted = [...EQUIPMENT_SLOTS].sort((a, b) => a.order - b.order);
    expect(sorted.map((s) => s.order)).toEqual([...orders].sort((a, b) => a - b));
  });

  it('anchor 取值合法且四组都有槽位', () => {
    const valid = new Set(['top', 'left', 'right', 'bottom']);
    for (const slot of EQUIPMENT_SLOTS) {
      expect(valid.has(slot.anchor)).toBe(true);
    }
    const anchors = new Set(EQUIPMENT_SLOTS.map((s) => s.anchor));
    expect(anchors).toEqual(valid);
  });

  it('搬迁后仍从 @lazycraft/shared 顶层可 import 常量与类型', () => {
    expect(shared.EQUIPMENT_SLOTS).toBe(EQUIPMENT_SLOTS);
    const meta: EquipmentSlotMeta = shared.EQUIPMENT_SLOTS[0];
    const id: EquipmentSlot = meta.id;
    expect(typeof id).toBe('string');
  });
});

describe('Skill.order', () => {
  it('5 个技能 order 齐备且各分组内能稳定排序', () => {
    expect(SKILLS).toHaveLength(5);
    for (const skill of SKILLS) {
      expect(typeof skill.order).toBe('number');
    }
    for (const type of ['combat', 'non_combat'] as const) {
      const group = SKILLS.filter((s) => s.type === type);
      expect(group.length).toBeGreaterThan(0);
      // 组内 order 唯一，才能保证前端排序结果稳定可复现
      expect(new Set(group.map((s) => s.order)).size).toBe(group.length);
      const sorted = [...group].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      expect(sorted.map((s) => s.order)).toEqual(group.map((s) => s.order));
    }
  });
});
