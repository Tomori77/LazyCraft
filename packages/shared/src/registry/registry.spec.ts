/**
 * Registry / ContentPack 行为测试
 *
 * 覆盖 task-09 验收标准：
 *   1. 正常流程：register CorePack -> validate() 通过 -> get/list 查询
 *   2. 异常流程：往包里加一个引用不存在 ID 的物品 -> validate() 报错并指出缺失 ID
 *   3. 多错误聚合：一个包里有多个缺失引用时，errors 数组包含全部
 */

import { describe, expect, it } from 'vitest';

import type { ContentPack, Item, SkillAction } from '../types.js';
import { CorePack } from '../packs/core/index.js';
import {
  ACTION_CHOP_TREE,
  ACTION_MINE_TINY_VEIN,
  ENEMY_CHICKEN,
  ITEM_FEATHER,
  ITEM_TINY_COPPER_VEIN,
  ITEM_WOOD,
} from '../packs/core/index.js';
import { ContentRegistry, createRegistry } from './index.js';

describe('ContentRegistry', () => {
  it('注册 CorePack 后 validate 通过', () => {
    const registry = new ContentRegistry();
    registry.register(CorePack);

    const result = registry.validate();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('get(id, type) 精确返回已注册内容', () => {
    const registry = createRegistry();
    registry.register(CorePack);

    expect(registry.get(ACTION_MINE_TINY_VEIN.id, 'action')).toEqual(
      ACTION_MINE_TINY_VEIN,
    );
    expect(registry.get(ITEM_WOOD.id, 'item')).toEqual(ITEM_WOOD);
    expect(registry.get(ENEMY_CHICKEN.id, 'enemy')).toEqual(ENEMY_CHICKEN);
    expect(registry.get('not_exist', 'item')).toBeUndefined();
    // 同一个 ID 可能在不同类别共存，这里验证类别隔离
    expect(registry.get(ACTION_CHOP_TREE.id, 'skill')).toBeUndefined();
  });

  it('list(type) 返回该类别的全部内容', () => {
    const registry = createRegistry();
    registry.register(CorePack);

    const items = registry.list('item');
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id).sort()).toEqual(
      [ITEM_TINY_COPPER_VEIN.id, ITEM_WOOD.id, ITEM_FEATHER.id].sort(),
    );

    const actions = registry.list('action');
    expect(actions).toHaveLength(2);

    const enemies = registry.list('enemy');
    expect(enemies).toHaveLength(1);

    const skills = registry.list('skill');
    expect(skills.length).toBeGreaterThan(0);
  });

  it('listPacks 返回已注册包的 id@version 列表', () => {
    const registry = createRegistry();
    registry.register(CorePack);
    expect(registry.listPacks()).toEqual(['core@0.1.0']);
  });

  it('validate 失败时报告缺失的动作输出物品 ID', () => {
    // 构造一个引用了不存在物品的 action，覆盖 task-09 验收场景
    const badAction: SkillAction = {
      ...ACTION_MINE_TINY_VEIN,
      id: 'mine_tiny_vein_bad',
      output_items: { diamond_ore_not_exist: 1 },
    };
    const badPack: ContentPack = {
      id: 'bad_pack',
      name: '坏包',
      version: '0.0.1',
      register(registry) {
        registry.action(badAction);
      },
    };

    const registry = new ContentRegistry();
    registry.register(CorePack);
    registry.register(badPack);

    const result = registry.validate();
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('[action:mine_tiny_vein_bad]');
    expect(result.errors[0]).toContain('output_items');
    expect(result.errors[0]).toContain('diamond_ore_not_exist');
    expect(result.errors[0]).toContain('未注册');
  });

  it('validate 失败时报告缺失的物品 source_skill', () => {
    const badItem: Item = {
      ...ITEM_WOOD,
      id: 'wood_bad',
      source_skill: 'fishing_not_exist',
    };
    const badPack: ContentPack = {
      id: 'bad_pack',
      name: '坏包',
      version: '0.0.1',
      register(registry) {
        registry.item(badItem);
      },
    };

    const registry = new ContentRegistry();
    registry.register(CorePack);
    registry.register(badPack);

    const result = registry.validate();
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('[item:wood_bad]');
    expect(result.errors[0]).toContain('fishing_not_exist');
  });

  it('validate 聚合多个缺失引用而不是只报第一个', () => {
    const badActionA: SkillAction = {
      ...ACTION_MINE_TINY_VEIN,
      id: 'bad_a',
      output_items: { not_exist_a: 1 },
    };
    const badActionB: SkillAction = {
      ...ACTION_CHOP_TREE,
      id: 'bad_b',
      input_items: { not_exist_b: 1 },
      output_items: { not_exist_c: 1 },
    };
    const badPack: ContentPack = {
      id: 'bad_pack',
      name: '坏包',
      version: '0.0.1',
      register(registry) {
        registry.action(badActionA);
        registry.action(badActionB);
      },
    };

    const registry = new ContentRegistry();
    registry.register(CorePack);
    registry.register(badPack);

    const result = registry.validate();
    expect(result.ok).toBe(false);
    // 3 个缺失引用必须一次全部报出来
    expect(result.errors).toHaveLength(3);
    const allErrors = result.errors.join('\n');
    expect(allErrors).toContain('not_exist_a');
    expect(allErrors).toContain('not_exist_b');
    expect(allErrors).toContain('not_exist_c');
  });

  it('validate 检查动作引用的 skill_id 存在', () => {
    const badAction: SkillAction = {
      ...ACTION_MINE_TINY_VEIN,
      id: 'orphan_action',
      skill_id: 'skill_not_exist',
    };
    const badPack: ContentPack = {
      id: 'bad_pack',
      name: '坏包',
      version: '0.0.1',
      register(registry) {
        registry.action(badAction);
      },
    };

    const registry = new ContentRegistry();
    registry.register(CorePack);
    registry.register(badPack);

    const result = registry.validate();
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('skill_not_exist');
  });
});
