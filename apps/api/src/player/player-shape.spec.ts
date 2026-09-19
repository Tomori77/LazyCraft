/**
 * 玩家信息聚合纯函数单测（task-26 核心验收：契约形状 + 脏存档容忍）。
 */

import { describe, expect, it } from 'vitest';
import { buildCoreSnapshot, levelFromExp } from '@lazycraft/shared';
import { equipment, stack, v3Data } from '../../test/save-fixtures.js';
import {
  buildEquipmentSlots,
  buildPlayerData,
  buildSkillLevels,
  readPlayerLevel,
} from './player-shape.js';

const snapshot = buildCoreSnapshot();
const SKILL_IDS = snapshot.skills.map((s) => s.id);
const SLOT_IDS = snapshot.equipmentSlots.map((s) => s.id);

describe('buildSkillLevels', () => {
  it('以内容快照为骨架：全部技能都返回，未记录的技能为 exp=0/level=1', () => {
    const levels = buildSkillLevels(SKILL_IDS, { attack: { exp: 27 } });

    expect(Object.keys(levels).sort()).toEqual([...SKILL_IDS].sort());
    expect(levels.attack).toEqual({ exp: 27, level: 3 });
    expect(levels.mining).toEqual({ exp: 0, level: 1 });
  });

  it('等级现算自 levelFromExp，存档里的 level 字段被忽略', () => {
    const levels = buildSkillLevels(['attack'], { attack: { exp: 1000, level: 99 } });
    expect(levels.attack.level).toBe(levelFromExp(1000));
    expect(levels.attack.level).toBe(10);
  });

  it('脏经验（负数/非数/字符串）一律按 0 处理且不抛错', () => {
    const levels = buildSkillLevels(['attack', 'mining'], {
      attack: { exp: -5 },
      mining: { exp: 'abc' },
    });
    expect(levels.attack).toEqual({ exp: 0, level: 1 });
    expect(levels.mining).toEqual({ exp: 0, level: 1 });
  });
});

describe('readPlayerLevel', () => {
  it('取攻击技能等级；无记录时 1 级', () => {
    expect(readPlayerLevel(undefined)).toBe(1);
    expect(readPlayerLevel({})).toBe(1);
    expect(readPlayerLevel({ mining: { exp: 1000 } })).toBe(1);
    expect(readPlayerLevel({ attack: { exp: 1000 } })).toBe(10);
  });
});

describe('buildEquipmentSlots', () => {
  it('覆盖快照全部槽位，空槽为 null', () => {
    const slots = buildEquipmentSlots(SLOT_IDS, {});
    expect(Object.keys(slots).sort()).toEqual([...SLOT_IDS].sort());
    expect(new Set(Object.values(slots))).toEqual(new Set([null]));
  });

  it('合法装备原样返回', () => {
    const sword = equipment({ slot: 'main_hand' });
    const slots = buildEquipmentSlots(SLOT_IDS, { main_hand: sword });
    expect(slots.main_hand).toBe(sword);
    expect(slots.head).toBeNull();
  });

  it('脏槽位（null / 非对象 / 缺 final_stats）按 null 处理不崩', () => {
    const slots = buildEquipmentSlots(SLOT_IDS, {
      head: null,
      neck: 'oops',
      main_hand: { kind: 'equipment', uid: 'x' },
      chest: [],
      legs: { kind: 'equipment', uid: 'y', final_stats: null },
    });
    for (const id of SLOT_IDS) expect(slots[id]).toBeNull();
  });

  it('只输出快照登记的槽位：存档里多出的槽位不进入结果', () => {
    const slots = buildEquipmentSlots(['head'], {
      head: equipment({ slot: 'head' }),
      unknown_slot: equipment({ slot: 'main_hand' }),
    });
    expect(Object.keys(slots)).toEqual(['head']);
  });
});

describe('buildPlayerData', () => {
  it('组装完整契约：技能 map / 槽位 map / 容器 / 容量', () => {
    const sword = equipment({ slot: 'main_hand' });
    const data = v3Data({
      skills: { attack: { exp: 1728 } },
      inventory: [sword, stack('copper_ore', 5)],
      storage: [stack('wood', 1)],
      equipment: { main_hand: sword },
      abstract_resources: { gold: 12 },
    });

    const player = buildPlayerData('player-abc12345', snapshot, data);

    expect(player.name).toBe('player-abc12345');
    expect(player.level).toBe(12);
    expect(player.skills.attack).toEqual({ exp: 1728, level: 12 });
    expect(player.abstract_resources).toEqual({ gold: 12 });
    expect(player.equipment.main_hand).toBe(sword);
    expect(player.inventory).toEqual([sword, data.inventory[1]]);
    expect(player.storage).toEqual(data.storage);
    // used 是格数而非物品总数（copper_ore 5 个只占 1 格）
    expect(player.carry).toEqual({
      inventory_used: 2,
      inventory_capacity: 100,
      storage_used: 1,
      storage_capacity: 500,
    });
  });

  it('老存档字段缺失时回落到空结构与默认容量', () => {
    const player = buildPlayerData('player-x', snapshot, {} as never);
    expect(player.level).toBe(1);
    expect(player.inventory).toEqual([]);
    expect(player.storage).toEqual([]);
    expect(player.abstract_resources).toEqual({});
    expect(player.carry.inventory_capacity).toBe(100);
    expect(player.carry.storage_capacity).toBe(500);
  });

  it('尊重存档里的扩容容量', () => {
    const player = buildPlayerData(
      'player-x',
      snapshot,
      v3Data({ inventory_capacity: 200, storage_capacity: 1000 }),
    );
    expect(player.carry.inventory_capacity).toBe(200);
    expect(player.carry.storage_capacity).toBe(1000);
  });
});
