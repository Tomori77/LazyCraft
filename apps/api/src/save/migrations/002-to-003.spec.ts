/**
 * v2 → v3 迁移纯函数测试（本任务核心验收：不丢数据）。
 */

import { describe, expect, it } from 'vitest';
import { generateEquipment } from '@lazycraft/shared';
import type { SaveDataV2 } from '../save-shape.js';
import { migrate } from './002-to-003.js';
import { migrateSave } from './index.js';

/** 确定性 uid：迁移断言不应依赖随机值 */
function fixedUidFactory() {
  let n = 0;
  return () => `uid-${n++}`;
}

function makeGeneratedEquipment() {
  const eq = generateEquipment({
    template_id: 'short_sword',
    quality: 'rare',
    affix_pool_ids: [],
    rng: () => 0,
  });
  if (!eq) throw new Error('测试前置失败：short_sword 模板应存在');
  return eq;
}

describe('migrate v2 → v3', () => {
  it('旧堆叠补 kind/uid，数量与品质原样保留', () => {
    const legacy = {
      skills: { mining: { exp: 100 } },
      inventory: [
        { item_id: 'copper_ore', quantity: 7 },
        { item_id: 'iron_ore', quantity: 2, quality: 'rare' },
      ],
      equipment: {},
      abstract_resources: { gold: 42 },
      current_action: null,
      current_combat: null,
      settings: { audio: { muted: true } },
    } as unknown as SaveDataV2;

    const result = migrate(legacy, fixedUidFactory());

    expect(result.inventory).toEqual([
      { kind: 'stack', uid: 'uid-0', item_id: 'copper_ore', quantity: 7 },
      { kind: 'stack', uid: 'uid-1', item_id: 'iron_ore', quantity: 2, quality: 'rare' },
    ]);
    // 其余字段不丢
    expect(result.skills).toEqual(legacy.skills);
    expect(result.settings).toEqual(legacy.settings);
    expect(result.current_combat).toBeNull();
  });

  it('combat_equipment_drops 中的装备迁入 inventory，键被删除，其它抽象资源保留', () => {
    const gear = makeGeneratedEquipment();
    const legacy = {
      skills: {},
      inventory: [{ item_id: 'maple_log', quantity: 1 }],
      equipment: {},
      abstract_resources: { gold: 10, res_wood: 3, combat_equipment_drops: [gear] },
      current_action: null,
      current_combat: null,
      settings: {},
    } as unknown as SaveDataV2;

    const result = migrate(legacy, fixedUidFactory());

    // 装备被转成 EquipmentInstance 追加到背包末尾
    const equipment = result.inventory.filter((i) => i.kind === 'equipment');
    expect(equipment).toHaveLength(1);
    expect(equipment[0]).toMatchObject({
      kind: 'equipment',
      template_id: 'short_sword',
      quality: 'rare',
      slot: 'main_hand',
      display_name: gear.display_name,
    });
    expect((equipment[0] as { final_stats: unknown }).final_stats).toEqual(gear.final_stats);

    // 抽象资源里不再有 combat_equipment_drops，gold / res_wood 原样保留
    expect(result.abstract_resources).toEqual({ gold: 10, res_wood: 3 });
    expect(result.abstract_resources).not.toHaveProperty('combat_equipment_drops');
  });

  it('模板缺失的装备被安全丢弃，不影响其它条目', () => {
    const legacy = {
      skills: {},
      inventory: [{ item_id: 'copper_ore', quantity: 1 }],
      equipment: {},
      abstract_resources: {
        gold: 5,
        combat_equipment_drops: [
          {
            template_id: 'not_exist',
            display_name: '幽灵',
            quality: 'common',
            prefix_affix: null,
            suffix_affix: null,
            final_stats: { attack: 0, defense: 0, hp: 0 },
          },
        ],
      },
      current_action: null,
      current_combat: null,
      settings: {},
    } as unknown as SaveDataV2;

    const result = migrate(legacy, fixedUidFactory());

    expect(result.inventory).toHaveLength(1);
    expect(result.inventory[0]).toMatchObject({ kind: 'stack', item_id: 'copper_ore' });
    expect(result.abstract_resources).toEqual({ gold: 5 });
  });

  it('补默认 storage / 容量；已有值则尊重', () => {
    const legacyDefault = {
      skills: {},
      inventory: [],
      equipment: {},
      abstract_resources: {},
      current_action: null,
      current_combat: null,
      settings: {},
    } as unknown as SaveDataV2;

    const result = migrate(legacyDefault, fixedUidFactory());
    expect(result.storage).toEqual([]);
    expect(result.inventory_capacity).toBe(100);
    expect(result.storage_capacity).toBe(500);
    expect(result.migrated_at).toBeGreaterThan(0);

    const legacyExpanded = {
      ...legacyDefault,
      storage: [{ kind: 'stack', uid: 's1', item_id: 'wood', quantity: 1 }],
      inventory_capacity: 200,
      storage_capacity: 1000,
    } as unknown as SaveDataV2;
    const expanded = migrate(legacyExpanded, fixedUidFactory());
    expect(expanded.inventory_capacity).toBe(200);
    expect(expanded.storage_capacity).toBe(1000);
    expect(expanded.storage).toHaveLength(1);
  });

  it('迁移具备幂等性：已升级的堆叠实例保留原 uid', () => {
    const legacy = {
      skills: {},
      inventory: [
        { kind: 'stack', uid: 'stable', item_id: 'copper_ore', quantity: 3 },
      ],
      equipment: {},
      abstract_resources: {},
      current_action: null,
      current_combat: null,
      settings: {},
    } as unknown as SaveDataV2;

    const result = migrate(legacy, fixedUidFactory());
    expect(result.inventory).toEqual([
      { kind: 'stack', uid: 'stable', item_id: 'copper_ore', quantity: 3 },
    ]);
  });
});

describe('migrateSave 链路 v1 → v3', () => {
  it('连续跑两段迁移，v1 存档得到完整 v3 形态', () => {
    const legacyV1 = {
      skills: { woodcutting: { level: 5, exp: 250 } },
      inventory: [{ item_id: 'maple_log', quantity: 4 }],
      equipment: {},
      abstract_resources: { gold: 1 },
      current_action: null,
      settings: {},
    } as unknown as SaveDataV2;

    const result = migrateSave(1, legacyV1);

    expect(result).toMatchObject({
      current_combat: null,
      inventory_capacity: 100,
      storage_capacity: 500,
    });
    expect(Array.isArray(result.storage)).toBe(true);
    expect((result.inventory as unknown[])[0]).toMatchObject({
      kind: 'stack',
      item_id: 'maple_log',
      quantity: 4,
    });
  });
});
