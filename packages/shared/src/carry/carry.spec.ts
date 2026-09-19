/**
 * 可携带物模型与装备规则测试（task-22）
 *
 * 覆盖：canEquip 四种路径、sumEquipmentStats 含 null、生成中间产物到实例的映射、
 * uid 注入与默认、CorePack 注册后 SKILLS/ACTIONS/ITEMS 全部可从 Registry 取到。
 */

import { describe, expect, it } from 'vitest';

import {
  EQUIP_FAILURE_REASONS,
  canEquip,
  newUid,
  sumEquipmentStats,
  toCarriedItems,
  toEquipmentInstance,
  toStackItems,
  type EquipmentInstance,
} from './index.js';
import {
  ACTIONS,
  ABSTRACT_RESOURCES,
  ITEMS,
  SKILLS,
  buildContentSnapshot,
  createCoreRegistry,
} from '../index.js';
import { generateEquipment } from '../loot/generate-equipment.js';

/** 手工构造一个装备实例：属性数值与模板无关，测试只关心槽位/等级/聚合语义 */
function makeInstance(overrides: Partial<EquipmentInstance> = {}): EquipmentInstance {
  return {
    kind: 'equipment',
    uid: 'uid-1',
    template_id: 'short_sword',
    quality: 'common',
    prefix_affix: null,
    suffix_affix: null,
    display_name: '短剑',
    final_stats: { attack: 2, defense: 0, hp: 0 },
    slot: 'main_hand',
    required_level: 1,
    ...overrides,
  };
}

describe('canEquip', () => {
  it('槽位匹配且等级足够时 ok', () => {
    expect(canEquip(makeInstance(), 'main_hand', 1)).toEqual({ ok: true });
  });

  it('槽位不符返回 slot_mismatch', () => {
    expect(canEquip(makeInstance(), 'head', 99)).toEqual({
      ok: false,
      reason: EQUIP_FAILURE_REASONS.SLOT_MISMATCH,
    });
  });

  it('等级不足返回 level_too_low', () => {
    const item = makeInstance({ slot: 'chest', required_level: 15 });
    expect(canEquip(item, 'chest', 14)).toEqual({
      ok: false,
      reason: EQUIP_FAILURE_REASONS.LEVEL_TOO_LOW,
    });
  });

  it('戒指两槽视为同类可互换', () => {
    const ring = makeInstance({ slot: 'ring1', required_level: 1 });
    expect(canEquip(ring, 'ring2', 1)).toEqual({ ok: true });
    expect(canEquip(makeInstance({ slot: 'ring2' }), 'ring1', 1)).toEqual({ ok: true });
  });

  it('戒指与非戒指槽位不互通', () => {
    const ring = makeInstance({ slot: 'ring1' });
    expect(canEquip(ring, 'main_hand', 99)).toEqual({
      ok: false,
      reason: EQUIP_FAILURE_REASONS.SLOT_MISMATCH,
    });
  });
});

describe('sumEquipmentStats', () => {
  it('空数组返回全 0', () => {
    expect(sumEquipmentStats([])).toEqual({ attack: 0, defense: 0, hp: 0 });
  });

  it('跳过 null 槽位并逐项相加', () => {
    const a = makeInstance({ final_stats: { attack: 3, defense: 1, hp: 2 } });
    const b = makeInstance({ final_stats: { attack: 1, defense: 4, hp: 0 } });
    expect(sumEquipmentStats([a, null, b])).toEqual({ attack: 4, defense: 5, hp: 2 });
  });
});

describe('toEquipmentInstance', () => {
  it('模板存在时补齐 slot / required_level 并保留属性快照', () => {
    const generated = generateEquipment({
      template_id: 'short_sword',
      quality: 'common',
      affix_pool_ids: [],
      rng: () => 0,
    });
    expect(generated).not.toBeNull();

    const instance = toEquipmentInstance(generated!, 'uid-abc');
    expect(instance).not.toBeNull();
    expect(instance).toMatchObject({
      kind: 'equipment',
      uid: 'uid-abc',
      template_id: 'short_sword',
      slot: 'main_hand',
      required_level: 1,
    });
    expect(instance!.final_stats).toEqual(generated!.final_stats);
  });

  it('模板不存在时返回 null（与 generateEquipment 的 null 出口一致）', () => {
    expect(
      toEquipmentInstance(
        {
          template_id: 'not_exist',
          display_name: '幽灵',
          quality: 'common',
          prefix_affix: null,
          suffix_affix: null,
          final_stats: { attack: 0, defense: 0, hp: 0 },
        },
        'uid-1',
      ),
    ).toBeNull();
  });
});

describe('toStackItems / toCarriedItems', () => {
  it('映射为带 uid 的堆叠实例并保留数量', () => {
    const result = toStackItems(
      [
        { item_id: 'copper_ore', quantity: 3 },
        { item_id: 'maple_log', quantity: 5 },
      ],
      () => 'fixed',
    );
    expect(result).toEqual([
      { kind: 'stack', uid: 'fixed', item_id: 'copper_ore', quantity: 3 },
      { kind: 'stack', uid: 'fixed', item_id: 'maple_log', quantity: 5 },
    ]);
  });

  it('uidFactory 可注入以实现确定性回放', () => {
    let seq = 0;
    const result = toCarriedItems([{ item_id: 'wood', quantity: 1 }], () => `u${seq++}`);
    expect(result[0].uid).toBe('u0');
  });

  it('默认 uid 工厂产出非空且互不相同', () => {
    const result = toStackItems([
      { item_id: 'wood', quantity: 1 },
      { item_id: 'wood', quantity: 2 },
    ]);
    expect(result[0].uid).toBeTruthy();
    expect(result[0].uid).not.toBe(result[1].uid);
  });
});

describe('newUid', () => {
  it('默认实现直接使用运行时提供的 randomUUID', () => {
    expect(newUid()).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('CorePack 统一事实源', () => {
  it('注册核心包后 validate 通过', () => {
    expect(createCoreRegistry().errors).toEqual([]);
  });

  it('SKILLS / ACTIONS / ITEMS 全部可从 Registry 取到', () => {
    const { registry } = createCoreRegistry();

    const skillIds = new Set(registry.list('skill').map((c) => c.id));
    for (const skill of SKILLS) expect(skillIds.has(skill.id)).toBe(true);

    const actionIds = new Set(registry.list('action').map((c) => c.id));
    for (const action of ACTIONS) expect(actionIds.has(action.id)).toBe(true);

    const itemIds = new Set(registry.list('item').map((c) => c.id));
    for (const item of ITEMS) expect(itemIds.has(item.id)).toBe(true);
  });

  it('内容快照以 Registry 为准且结构齐全', () => {
    const snapshot = buildContentSnapshot(createCoreRegistry().registry);

    expect(snapshot.skills).toHaveLength(SKILLS.length);
    // 动作数 = data/actions 4 条 + CorePack 专有 2 条
    expect(snapshot.actions).toHaveLength(ACTIONS.length + 2);
    for (const action of snapshot.actions) {
      expect(typeof action.tier).toBe('number');
    }
    expect(snapshot.abstractResources).toEqual(ABSTRACT_RESOURCES);
    expect(snapshot.equipmentSlots.length).toBeGreaterThan(0);
    expect(snapshot.itemCatalog.length).toBe(ITEMS.length + 3);
  });
});
