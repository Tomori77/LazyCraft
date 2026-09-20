/**
 * 内置 pack 清单与启用集合测试（task-41）。
 *
 * 覆盖：
 *   1. `selectEnabledPacks` 的三种语义：省略=全启用、命中集合过滤、空数组=全停；
 *   2. `createCoreRegistry(enabledIds)` 只注册启用包；
 *   3. 部分启用时 `validate()` 的可诊断行为（引用缺失被报出）；
 *   4. 快照 `packs` 元信息与"实际注册结果"同源。
 */

import { describe, expect, it } from 'vitest';
import type { ContentPack } from '../types.js';
import { CorePack } from './core/index.js';
import { BUILTIN_PACKS, selectEnabledPacks } from './index.js';
import { createCoreRegistry, buildContentSnapshot } from '../content/index.js';
import { createRegistry } from '../registry/index.js';

/** 合成第二个 pack：注册一个引用 core 技能的物品，用于验证"停用 core 会报引用缺失" */
const DependentPack: ContentPack = {
  id: 'dependent',
  name: '依赖包',
  version: '0.0.1',
  register(registry) {
    registry.item({
      id: 'dependent_item',
      name: '依赖物',
      type: 'material',
      tier: 1,
      stack_max: 10,
      tradeable: false,
      quality: ['common'],
      source_skill: 'mining',
      use_tags: [],
      rarity: 'normal',
      broadcast_threshold: 'epic',
    });
  },
};

describe('BUILTIN_PACKS 清单', () => {
  it('当前包含核心包，且 id 唯一', () => {
    expect(BUILTIN_PACKS).toContain(CorePack);
    const ids = BUILTIN_PACKS.map((pack) => pack.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('selectEnabledPacks', () => {
  const packs: ContentPack[] = [CorePack, DependentPack];

  it('省略 enabledIds = 全部启用（向后兼容）', () => {
    expect(selectEnabledPacks(packs)).toEqual([CorePack, DependentPack]);
  });

  it('只保留命中集合的 pack', () => {
    expect(selectEnabledPacks(packs, ['dependent'])).toEqual([DependentPack]);
  });

  it('空数组 = 一个都不启用', () => {
    expect(selectEnabledPacks(packs, [])).toEqual([]);
  });
});

describe('createCoreRegistry(enabledIds)', () => {
  it('省略参数 = 注册全部内置包（既有行为不变）', () => {
    const { registry, errors } = createCoreRegistry();
    expect(errors).toEqual([]);
    expect(registry.listPacks()).toEqual(['core@0.1.0']);
    expect(registry.get('mining', 'skill')).toBeDefined();
  });

  it('空数组 = 不注册任何包，内容为空', () => {
    const { registry } = createCoreRegistry([]);
    expect(registry.listPacks()).toEqual([]);
    expect(registry.list('skill')).toHaveLength(0);
    expect(registry.list('item')).toHaveLength(0);
  });

  it('传入未知 id 不报错也不注册任何包（未知 id 由管理 API 负责 404）', () => {
    const { registry } = createCoreRegistry(['no_such_pack']);
    expect(registry.listPacks()).toEqual([]);
  });
});

describe('部分启用下的 validate 可诊断行为', () => {
  it('停用被依赖的包后，validate 报出引用缺失而不是静默', () => {
    // 直接对 Registry 复现"core 未启用、dependent 启用了"的部分启用态：
    // 真实场景里 pack 间可交叉引用，停用其中一个会让另一个的引用悬空。
    const registry = createRegistry();
    registry.register(DependentPack);
    const result = registry.validate();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join('\n')).toContain('mining');
  });

  it('core 启用时 createCoreRegistry 校验通过（本体内置自洽）', () => {
    const { errors } = createCoreRegistry(['core']);
    expect(errors).toEqual([]);
  });

  it('停用所有内置包时 validate 通过（空注册表没有悬空引用）', () => {
    // 这是"停用 core"的真实行为：不是崩溃，而是内容为空；
    // 引用缺失只会在"一个依赖包启用、被依赖包停用"时出现（见上一用例）。
    const { errors } = createCoreRegistry([]);
    expect(errors).toEqual([]);
  });
});

describe('快照 packs 元信息', () => {
  it('全启用时 packs 覆盖全部内置包且 enabled=true', () => {
    const snapshot = buildContentSnapshot(createCoreRegistry().registry);
    expect(snapshot.packs).toHaveLength(BUILTIN_PACKS.length);
    const core = snapshot.packs.find((pack) => pack.id === 'core');
    expect(core).toMatchObject({ id: 'core', name: CorePack.name, version: '0.1.0', enabled: true });
  });

  it('停用后 packs 只含实际启用的包（与 Registry 同源）', () => {
    const snapshot = buildContentSnapshot(createCoreRegistry([]).registry);
    expect(snapshot.packs).toEqual([]);
  });
});
