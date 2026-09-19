/**
 * 可携带物模型与装备规则测试（task-22）
 *
 * 覆盖：canEquip 四种路径、sumEquipmentStats 含 null、生成中间产物到实例的映射、
 * uid 注入与默认、CorePack 注册后 SKILLS/ACTIONS/ITEMS 全部可从 Registry 取到。
 */

import { describe, expect, it } from 'vitest';

import {
  EQUIP_FAILURE_REASONS,
  addStacksToCarried,
  addToContainer,
  canAddToContainer,
  canEquip,
  countNewSlotsNeeded,
  mergeSettledStacks,
  newUid,
  stackQuality,
  sumEquipmentStats,
  toCarriedItems,
  toEquipmentInstance,
  toStackItems,
  type CarriedItem,
  type EquipmentInstance,
  type StackItemInstance,
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

  it('保留条目上的 quality；缺省时不写该字段', () => {
    const [withQuality, withoutQuality] = toStackItems(
      [
        { item_id: 'copper_ore', quantity: 3, quality: 'rare' },
        { item_id: 'wood', quantity: 1 },
      ],
      () => 'fixed',
    );
    expect(withQuality.quality).toBe('rare');
    expect(withoutQuality).not.toHaveProperty('quality');
  });
});

describe('stackQuality', () => {
  it('缺失时按 common 归一化', () => {
    const stack: StackItemInstance = { kind: 'stack', uid: 'u', item_id: 'wood', quantity: 1 };
    expect(stackQuality(stack)).toBe('common');
  });

  it('显式品质原样返回', () => {
    expect(stackQuality({ kind: 'stack', uid: 'u', item_id: 'wood', quantity: 1, quality: 'epic' })).toBe('epic');
  });
});

describe('mergeSettledStacks', () => {
  const equip: EquipmentInstance = {
    kind: 'equipment',
    uid: 'eq-1',
    template_id: 'short_sword',
    quality: 'common',
    prefix_affix: null,
    suffix_affix: null,
    display_name: '短剑',
    final_stats: { attack: 2, defense: 0, hp: 0 },
    slot: 'main_hand',
    required_level: 1,
  };

  it('同 (item_id, quality) 复用已有 uid，数量就地变化', () => {
    const current: CarriedItem[] = [
      { kind: 'stack', uid: 'keep-A', item_id: 'copper_ore', quantity: 3 },
      { kind: 'stack', uid: 'keep-B', item_id: 'maple_log', quantity: 5 },
    ];
    const next = mergeSettledStacks(
      current,
      [
        { item_id: 'copper_ore', quantity: 7 },
        { item_id: 'maple_log', quantity: 2 },
      ],
      () => 'new-uid',
    );
    expect(next).toEqual([
      { kind: 'stack', uid: 'keep-A', item_id: 'copper_ore', quantity: 7 },
      { kind: 'stack', uid: 'keep-B', item_id: 'maple_log', quantity: 2 },
    ]);
  });

  it('被消耗的堆叠消失；结算新增的堆叠分配新 uid', () => {
    const current: CarriedItem[] = [
      { kind: 'stack', uid: 'keep-A', item_id: 'copper_ore', quantity: 3 },
      { kind: 'stack', uid: 'gone', item_id: 'maple_log', quantity: 5 },
    ];
    const next = mergeSettledStacks(
      current,
      [
        { item_id: 'copper_ore', quantity: 1 },
        { item_id: 'raw_stone', quantity: 4 },
      ],
      () => 'brand-new',
    );
    expect(next).toEqual([
      { kind: 'stack', uid: 'keep-A', item_id: 'copper_ore', quantity: 1 },
      { kind: 'stack', uid: 'brand-new', item_id: 'raw_stone', quantity: 4 },
    ]);
    // maple_log（uid=gone）不在结算结果中 → 被消耗，不应出现
    expect(next.some((i) => i.uid === 'gone')).toBe(false);
  });

  it('装备实例原样保留且不受堆叠合并影响', () => {
    const current: CarriedItem[] = [
      equip,
      { kind: 'stack', uid: 'keep-A', item_id: 'copper_ore', quantity: 3 },
    ];
    const next = mergeSettledStacks(current, [{ item_id: 'copper_ore', quantity: 9 }], () => 'x');
    expect(next[0]).toBe(equip);
    expect(next[1]).toEqual({ kind: 'stack', uid: 'keep-A', item_id: 'copper_ore', quantity: 9 });
  });

  it('不同品质不互相复用 uid', () => {
    const current: CarriedItem[] = [
      { kind: 'stack', uid: 'common-A', item_id: 'copper_ore', quantity: 3 },
      { kind: 'stack', uid: 'rare-A', item_id: 'copper_ore', quantity: 1, quality: 'rare' },
    ];
    const next = mergeSettledStacks(
      current,
      [
        { item_id: 'copper_ore', quantity: 4, quality: 'rare' },
        { item_id: 'copper_ore', quantity: 2 },
      ],
      () => 'new',
    );
    const rare = next.find((i) => i.kind === 'stack' && i.quality === 'rare') as StackItemInstance;
    const common = next.find(
      (i) => i.kind === 'stack' && (i as StackItemInstance).quality === undefined,
    ) as StackItemInstance;
    expect(rare.uid).toBe('rare-A');
    expect(common.uid).toBe('common-A');
  });

  it('全新堆叠按传入 quality 落盘', () => {
    const next = mergeSettledStacks([], [{ item_id: 'copper_ore', quantity: 2, quality: 'epic' }], () => 'u1');
    expect(next).toEqual([
      { kind: 'stack', uid: 'u1', item_id: 'copper_ore', quantity: 2, quality: 'epic' },
    ]);
  });
});

describe('addStacksToCarried', () => {
  it('同 (item_id, quality) 合并进第一格并保留 uid', () => {
    const current: CarriedItem[] = [
      { kind: 'stack', uid: 'keep', item_id: 'copper_ore', quantity: 3 },
      { kind: 'equipment', uid: 'eq', template_id: 'short_sword', quality: 'common', prefix_affix: null, suffix_affix: null, display_name: '短剑', final_stats: { attack: 2, defense: 0, hp: 0 }, slot: 'main_hand', required_level: 1 },
    ];
    const next = addStacksToCarried(current, [{ item_id: 'copper_ore', quantity: 2 }], () => 'new');
    expect(next[0]).toEqual({ kind: 'stack', uid: 'keep', item_id: 'copper_ore', quantity: 5 });
    expect(next[1]).toBe(current[1]);
  });

  it('不同品质新增独立格；不删除既有堆叠', () => {
    const current: CarriedItem[] = [{ kind: 'stack', uid: 'keep', item_id: 'copper_ore', quantity: 3 }];
    const next = addStacksToCarried(
      current,
      [{ item_id: 'copper_ore', quantity: 1, quality: 'rare' }],
      () => 'rare-uid',
    );
    expect(next).toEqual([
      { kind: 'stack', uid: 'keep', item_id: 'copper_ore', quantity: 3 },
      { kind: 'stack', uid: 'rare-uid', item_id: 'copper_ore', quantity: 1, quality: 'rare' },
    ]);
  });

  it('quantity<=0 的条目被忽略', () => {
    expect(addStacksToCarried([], [{ item_id: 'wood', quantity: 0 }], () => 'x')).toEqual([]);
  });
});

describe('容器容量（addToContainer / countNewSlotsNeeded / canAddToContainer）', () => {
  const stackOf = (uid: string, item_id: string, quantity: number, quality?: StackItemInstance['quality']): StackItemInstance => ({
    kind: 'stack',
    uid,
    item_id,
    quantity,
    ...(quality !== undefined ? { quality } : {}),
  });

  it('并入同 (item_id, quality) 已有叠时不占新格，且保留 uid', () => {
    const container: CarriedItem[] = [stackOf('keep', 'copper_ore', 10)];
    const next = addToContainer(container, [{ item_id: 'copper_ore', quantity: 5 }], () => 'new');
    expect(next).toEqual([{ kind: 'stack', uid: 'keep', item_id: 'copper_ore', quantity: 15 }]);
    expect(countNewSlotsNeeded(container, [{ item_id: 'copper_ore', quantity: 5 }])).toBe(0);
  });

  it('尊重 stack_max：已有叠补满后余量另开新格', () => {
    // stack_max=10：已有 8，加 5 → 补 2 进旧叠，余 3 开新格
    const container: CarriedItem[] = [stackOf('a', 'copper_ore', 8)];
    const next = addToContainer(
      container,
      [{ item_id: 'copper_ore', quantity: 5 }],
      () => 'b',
      () => 10,
    );
    expect(next).toEqual([
      { kind: 'stack', uid: 'a', item_id: 'copper_ore', quantity: 10 },
      { kind: 'stack', uid: 'b', item_id: 'copper_ore', quantity: 3 },
    ]);
    expect(countNewSlotsNeeded(container, [{ item_id: 'copper_ore', quantity: 5 }], () => 10)).toBe(1);
  });

  it('装备实例恒占一格，不与堆叠合并', () => {
    const equip = makeInstance({ uid: 'eq' });
    const next = addToContainer([stackOf('a', 'copper_ore', 1)], [equip]);
    expect(next).toHaveLength(2);
    expect(next[1]).toBe(equip);
  });

  it('不同品质不合并：同物品不同品质各占一格', () => {
    const container: CarriedItem[] = [stackOf('a', 'copper_ore', 1, 'common')];
    const next = addToContainer(
      container,
      [{ item_id: 'copper_ore', quantity: 1, quality: 'rare' }],
      () => 'r',
    );
    expect(next).toHaveLength(2);
  });

  it('canAddToContainer 按剩余格数判定，边界相等可放', () => {
    const container: CarriedItem[] = [stackOf('a', 'copper_ore', 1)];
    // 容量 2：再加一格刚好放得下
    expect(canAddToContainer(container, [{ item_id: 'wood', quantity: 1 }], 2)).toBe(true);
    // 容量 1：放不下
    expect(canAddToContainer(container, [{ item_id: 'wood', quantity: 1 }], 1)).toBe(false);
  });

  it('空加入物恒可放，即使容器已满', () => {
    const container: CarriedItem[] = [stackOf('a', 'copper_ore', 1)];
    expect(canAddToContainer(container, [], 1)).toBe(true);
  });

  it('quantity<=0 的堆叠增量被忽略', () => {
    expect(addToContainer([], [{ item_id: 'wood', quantity: 0 }], () => 'x')).toEqual([]);
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
    // 抽象资源 / 槽位改为从 Registry 取后，内容与注册顺序仍与常量表一致
    expect(snapshot.abstractResources).toEqual(ABSTRACT_RESOURCES);
    expect(snapshot.abstractResources).toHaveLength(4);
    expect(snapshot.equipmentSlots).toHaveLength(10);
    expect(snapshot.itemCatalog.length).toBe(ITEMS.length + 3);
  });
});
