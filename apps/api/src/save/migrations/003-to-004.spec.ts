/**
 * v3 → v4 迁移纯函数测试（task-36 核心验收：不丢数据）。
 */

import { describe, expect, it } from 'vitest';
import type { SaveDataV3 } from '../save-shape.js';
import { migrate } from './003-to-004.js';
import { migrateSave } from './index.js';

/** 构造一份字段齐全的 v3 存档 */
function makeV3(overrides: Partial<SaveDataV3> = {}): SaveDataV3 {
  return {
    skills: { mining: { exp: 100 } },
    inventory: [
      { kind: 'stack', uid: 'u1', item_id: 'copper_ore', quantity: 7 },
    ],
    equipment: {},
    abstract_resources: { gold: 42 },
    current_action: { skill_id: 'mining', action_id: 'mine_copper', started_at: 1000 },
    current_combat: null,
    settings: { audio: { muted: true } },
    storage: [{ kind: 'stack', uid: 's1', item_id: 'wood', quantity: 3 }],
    inventory_capacity: 100,
    storage_capacity: 500,
    ...overrides,
  };
}

describe('migrate v3 → v4', () => {
  it('补 action_queue: []，其余字段原样保留（不丢数据）', () => {
    const legacy = makeV3();
    const result = migrate(legacy);

    expect(result.action_queue).toEqual([]);
    // 关键字段不丢
    expect(result.skills).toEqual(legacy.skills);
    expect(result.inventory).toEqual(legacy.inventory);
    expect(result.storage).toEqual(legacy.storage);
    expect(result.abstract_resources).toEqual({ gold: 42 });
    expect(result.current_action).toEqual(legacy.current_action);
    expect(result.settings).toEqual(legacy.settings);
    expect(result.inventory_capacity).toBe(100);
    expect(result.storage_capacity).toBe(500);
    expect(result.migrated_at).toBeGreaterThan(0);
  });

  it('迁移幂等：已有 action_queue（重复执行）时不覆盖、不清空', () => {
    const legacy = makeV3() as SaveDataV3 & { action_queue: unknown };
    legacy.action_queue = [{ action_id: 'mine_copper', skill_id: 'mining', count: 5 }];

    const result = migrate(legacy as never);
    expect(result.action_queue).toEqual([
      { action_id: 'mine_copper', skill_id: 'mining', count: 5 },
    ]);
  });

  it('action_queue 非法值（非数组）时重置为空数组而不是崩溃', () => {
    const legacy = makeV3() as SaveDataV3 & { action_queue: unknown };
    legacy.action_queue = 'not-an-array';

    const result = migrate(legacy as never);
    expect(result.action_queue).toEqual([]);
  });
});

describe('migrateSave 链路 v1 → v4', () => {
  it('连续跑三段迁移，v1 存档得到完整 v4 形态', () => {
    const legacyV1 = {
      skills: { woodcutting: { level: 5, exp: 250 } },
      inventory: [{ item_id: 'maple_log', quantity: 4 }],
      equipment: {},
      abstract_resources: { gold: 1 },
      current_action: null,
      settings: {},
    };

    const result = migrateSave(1, legacyV1 as never);

    expect(result).toMatchObject({
      current_combat: null,
      inventory_capacity: 100,
      storage_capacity: 500,
      action_queue: [],
    });
    expect((result.inventory as unknown[])[0]).toMatchObject({
      kind: 'stack',
      item_id: 'maple_log',
      quantity: 4,
    });
  });
});
