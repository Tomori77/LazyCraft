/**
 * 图标入库测试（task-29）
 *
 * 覆盖：
 *   1. CorePack 注册后图标桶数量 = 本体手绘图标数（31），可按名精确取
 *   2. validate() 对"空 name / 空 paths / 空 d"的坏图标报错
 *   3. buildContentSnapshot().icons 非空且与 Registry 同源
 */

import { describe, expect, it } from 'vitest';
import { HAND_DRAWN_ICONS } from '@lazycraft/icons';
import type { ContentPack, IconDef } from '../types.js';
import { CorePack } from '../packs/core/index.js';
import { ContentRegistry, createRegistry } from '../registry/index.js';
import { buildContentSnapshot } from './index.js';

function packOf(...icons: IconDef[]): ContentPack {
  return {
    id: 'bad_icon_pack',
    name: '坏图标包',
    version: '0.0.1',
    register(registry) {
      for (const icon of icons) registry.icon(icon);
    },
  };
}

describe('图标注册（Registry icon 桶）', () => {
  it('CorePack 注册后 list(icon) 数量 = 本体手绘图标数', () => {
    const registry = createRegistry();
    registry.register(CorePack);

    const icons = registry.list('icon') as IconDef[];
    expect(icons).toHaveLength(HAND_DRAWN_ICONS.length);
    expect(icons).toHaveLength(31);
  });

  it('get(name, icon) 可按名字精确取回', () => {
    const registry = createRegistry();
    registry.register(CorePack);

    expect(registry.get('skill.mining', 'icon')).toEqual(
      HAND_DRAWN_ICONS.find((i) => i.name === 'skill.mining'),
    );
    expect(registry.get('nope.none', 'icon')).toBeUndefined();
    // 类别隔离：图标桶的 name 是 'skill.mining'，技能桶的 id 是 'mining'，互不串桶
    expect(registry.get('mining', 'skill')).toBeDefined();
    expect(registry.get('skill.mining', 'skill')).toBeUndefined();
    expect(registry.get('skill.mining', 'item')).toBeUndefined();
  });

  it('图标桶与其他桶互不干扰：同名 name 只落到 icon 桶', () => {
    const registry = createRegistry();
    const shadow: IconDef = {
      name: 'mining',
      source: 'hand-drawn',
      paths: [{ d: 'M0 0' }],
    };
    registry.icon(shadow);

    expect(registry.get('mining', 'icon')).toEqual(shadow);
    expect(registry.list('skill')).toHaveLength(0);
  });

  it('DLC 覆盖同名图标时以最后一次登记为准', () => {
    const registry = createRegistry();
    const override: IconDef = {
      name: 'skill.mining',
      source: 'hand-drawn',
      paths: [{ d: 'M1 1' }],
    };
    registry.icon(override);
    expect(registry.get('skill.mining', 'icon')).toEqual(override);
  });
});

describe('validate 图标校验', () => {
  it('空 name 报错', () => {
    const registry = createRegistry();
    registry.register(packOf({ name: '', source: 'hand-drawn', paths: [{ d: 'M0 0' }] }));

    const result = registry.validate();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('name 不能是空字符串');
  });

  it('空 paths 报错', () => {
    const registry = createRegistry();
    registry.register(packOf({ name: 'ui.empty', source: 'hand-drawn', paths: [] }));

    const result = registry.validate();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('[icon:ui.empty]');
    expect(result.errors.join('\n')).toContain('paths 不能为空数组');
  });

  it('path 的 d 为空字符串报错', () => {
    const registry = createRegistry();
    registry.register(
      packOf({ name: 'ui.blank', source: 'hand-drawn', paths: [{ d: '' }] }),
    );

    const result = registry.validate();
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('[icon:ui.blank]');
    expect(result.errors.join('\n')).toContain('d 为空');
  });

  it('注册 CorePack 后 validate 仍通过（本体内置图标无坏数据）', () => {
    const registry = new ContentRegistry();
    registry.register(CorePack);
    expect(registry.validate()).toEqual({ ok: true, errors: [] });
  });
});

describe('内容快照 icons', () => {
  it('buildContentSnapshot().icons 非空且覆盖本体图标', () => {
    const registry = createRegistry();
    registry.register(CorePack);

    const snapshot = buildContentSnapshot(registry);
    expect(Array.isArray(snapshot.icons)).toBe(true);
    expect(snapshot.icons).toHaveLength(HAND_DRAWN_ICONS.length);

    const names = new Set(snapshot.icons.map((i) => i.name));
    for (const icon of HAND_DRAWN_ICONS) expect(names.has(icon.name)).toBe(true);
  });

  it('DLC 追加的图标也进入快照', () => {
    const registry = createRegistry();
    registry.register(CorePack);
    registry.register(
      packOf({ name: 'dlc.custom', source: 'hand-drawn', paths: [{ d: 'M2 2' }] }),
    );

    const snapshot = buildContentSnapshot(registry);
    expect(snapshot.icons.some((i) => i.name === 'dlc.custom')).toBe(true);
  });
});
