/**
 * 挂机核心单元测试：5 个验收场景 + 边界条件
 */

import { describe, expect, it } from 'vitest';

import type { SkillAction } from '../types.js';
import {
  OFFLINE_CAP_MS,
  StopReason,
  settle,
  startAction,
  type PlayerState,
} from './index.js';

/* ---------------------------------------------------------------- */
/* 测试夹具                                                          */
/* ---------------------------------------------------------------- */

/** 无消耗的采矿动作：1 秒一次，产 1 铜矿，给 10 经验 */
const MINE_COPPER: SkillAction = {
  id: 'mine_copper',
  skill_id: 'mining',
  name: '采铜矿',
  interval_ms: 1000,
  exp: 10,
  input_items: {},
  output_items: { copper_ore: 1 },
  output_exp: 0,
  required_level: 1,
  tier: 1,
};

/** 有消耗的动作：1 秒一次，耗 1 木头，产 1 木炭 */
const BURN_WOOD: SkillAction = {
  id: 'burn_wood',
  skill_id: 'firemaking',
  name: '烧木头',
  interval_ms: 1000,
  exp: 5,
  input_items: { wood: 1 },
  output_items: { charcoal: 1 },
  output_exp: 0,
  required_level: 1,
  tier: 1,
};

/** 造一个新玩家：默认背包 100 格，无动作 */
function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    inventory: [],
    inventory_capacity: 100,
    skill_exp: {},
    current_action: null,
    ...overrides,
  };
}

/* ---------------------------------------------------------------- */
/* 开始动作                                                          */
/* ---------------------------------------------------------------- */

describe('startAction', () => {
  it('空闲玩家开始动作后进入"执行中"状态', () => {
    const p = makePlayer();
    const next = startAction({ player: p, action: MINE_COPPER, now: 1000 });
    expect(next.current_action).toEqual({
      action_id: 'mine_copper',
      started_at: 1000,
    });
  });

  it('重复开始同一个动作不重置 started_at——防止误操作吞掉收益', () => {
    const p = makePlayer({
      current_action: { action_id: 'mine_copper', started_at: 500 },
    });
    const next = startAction({ player: p, action: MINE_COPPER, now: 10_000 });
    expect(next.current_action?.started_at).toBe(500);
  });

  it('正在执行 A 时开始 B 会切换动作（A 的收益由调用方先 settle 结算）', () => {
    const p = makePlayer({
      current_action: { action_id: 'mine_copper', started_at: 500 },
    });
    const next = startAction({ player: p, action: BURN_WOOD, now: 2000 });
    expect(next.current_action).toEqual({
      action_id: 'burn_wood',
      started_at: 2000,
    });
  });
});

/* ---------------------------------------------------------------- */
/* 离线结算：5 个验收场景                                             */
/* ---------------------------------------------------------------- */

describe('settle', () => {
  it('空闲玩家结算：零收益，零消耗，动作保持 null', () => {
    const p = makePlayer();
    const { player, report } = settle({
      player: p,
      action: MINE_COPPER,
      now: 9999,
    });
    expect(report.ticks).toBe(0);
    expect(report.effective_seconds).toBe(0);
    expect(report.gained).toEqual([]);
    expect(report.stop_reason).toBe(StopReason.NoTicks);
    expect(player.current_action).toBeNull();
  });

  it('场景 1 ▸ 离线 1 分钟：得到 60 铜矿 / 600 经验', () => {
    const t0 = 1_000_000;
    const started = startAction({ player: makePlayer(), action: MINE_COPPER, now: t0 });
    const { player, report } = settle({
      player: started,
      action: MINE_COPPER,
      now: t0 + 60_000,
    });
    expect(report.ticks).toBe(60);
    expect(report.effective_seconds).toBe(60);
    expect(report.stop_reason).toBe(StopReason.DurationCap);
    expect(report.gained).toEqual([{ item_id: 'copper_ore', amount: 60 }]);
    expect(report.consumed).toEqual([]);
    expect(report.exp_gained).toEqual({ mining: 600 });
    expect(player.current_action).toBeNull();
    expect(player.inventory).toEqual([{ item_id: 'copper_ore', quantity: 60 }]);
    expect(player.skill_exp).toEqual({ mining: 600 });
  });

  it('场景 2 ▸ 离线 1 小时：得到 3600 铜矿（按堆叠 999 拆 4 格）', () => {
    const t0 = 0;
    const started = startAction({ player: makePlayer(), action: MINE_COPPER, now: t0 });
    const { player, report } = settle({
      player: started,
      action: MINE_COPPER,
      now: t0 + 3_600_000,
    });
    expect(report.ticks).toBe(3600);
    expect(report.effective_seconds).toBe(3600);
    expect(report.gained).toEqual([{ item_id: 'copper_ore', amount: 3600 }]);
    // 3600 / 999 = 3 格满 + 1 格 603
    expect(player.inventory).toEqual([
      { item_id: 'copper_ore', quantity: 999 },
      { item_id: 'copper_ore', quantity: 999 },
      { item_id: 'copper_ore', quantity: 999 },
      { item_id: 'copper_ore', quantity: 603 },
    ]);
  });

  it('场景 3 ▸ 离线刚好 24 小时：触发时长上限，收益按 24h 全额', () => {
    const t0 = 0;
    const started = startAction({ player: makePlayer(), action: MINE_COPPER, now: t0 });
    const { report } = settle({
      player: started,
      action: MINE_COPPER,
      now: t0 + OFFLINE_CAP_MS,
    });
    expect(report.effective_seconds).toBe(86_400);
    expect(report.ticks).toBe(86_400);
    expect(report.stop_reason).toBe(StopReason.DurationCap);
    expect(report.gained).toEqual([{ item_id: 'copper_ore', amount: 86_400 }]);
  });

  it('场景 4 ▸ 离线超过 24 小时（36h）：超出的 12h 被吃掉', () => {
    const t0 = 0;
    const started = startAction({ player: makePlayer(), action: MINE_COPPER, now: t0 });
    const { player, report } = settle({
      player: started,
      action: MINE_COPPER,
      now: t0 + 36 * 3_600_000,
    });
    expect(report.effective_seconds).toBe(86_400);
    expect(report.ticks).toBe(86_400);
    expect(report.stop_reason).toBe(StopReason.DurationCap);
    // 86400 铜矿按 999 拆 87 格，100 格背包够用
    const total = player.inventory
      .filter((s) => s.item_id === 'copper_ore')
      .reduce((sum, s) => sum + s.quantity, 0);
    expect(total).toBe(86_400);
  });

  it('场景 5 ▸ 材料在第 30 次动作前耗尽：只算前 29 次', () => {
    const t0 = 0;
    const player = makePlayer({
      inventory: [{ item_id: 'wood', quantity: 29 }],
      skill_exp: { firemaking: 100 },
    });
    const started = startAction({ player, action: BURN_WOOD, now: t0 });
    const { player: done, report } = settle({
      player: started,
      action: BURN_WOOD,
      now: t0 + 60_000, // 想要跑 60 次，但第 30 次没材料
    });
    expect(report.ticks).toBe(29);
    expect(report.stop_reason).toBe(StopReason.InputExhausted);
    expect(report.gained).toEqual([{ item_id: 'charcoal', amount: 29 }]);
    expect(report.consumed).toEqual([{ item_id: 'wood', amount: 29 }]);
    expect(report.exp_gained).toEqual({ firemaking: 29 * 5 });
    // 材料清零，背包只剩木炭；经验在原有基础上累加
    expect(done.inventory).toEqual([{ item_id: 'charcoal', quantity: 29 }]);
    expect(done.skill_exp).toEqual({ firemaking: 100 + 29 * 5 });
  });
});

/* ---------------------------------------------------------------- */
/* 边界条件                                                           */
/* ---------------------------------------------------------------- */

describe('边界条件', () => {
  it('离线 0 秒：不足一个 tick，零收益', () => {
    const t0 = 1234;
    const started = startAction({ player: makePlayer(), action: MINE_COPPER, now: t0 });
    const { report } = settle({ player: started, action: MINE_COPPER, now: t0 });
    expect(report.ticks).toBe(0);
    expect(report.effective_seconds).toBe(0);
    expect(report.stop_reason).toBe(StopReason.NoTicks);
  });

  it('离线 0.9 秒（未达 1s 间隔）：仍然零收益', () => {
    const t0 = 0;
    const started = startAction({ player: makePlayer(), action: MINE_COPPER, now: t0 });
    const { report } = settle({ player: started, action: MINE_COPPER, now: 900 });
    expect(report.ticks).toBe(0);
    expect(report.stop_reason).toBe(StopReason.NoTicks);
  });

  it('背包只剩 1 格时：离线 10 秒只能再产 1 次，然后触发背包满', () => {
    const t0 = 0;
    // stack_max 显式设为 1：1 格容量被 stone 占住，新格只能放 1 铜矿
    const player = makePlayer({
      inventory: [{ item_id: 'stone', quantity: 5 }],
      inventory_capacity: 2,
    });
    const started = startAction({ player, action: MINE_COPPER, now: t0 });
    const { player: done, report } = settle({
      player: started,
      action: MINE_COPPER,
      now: t0 + 10_000, // 理论 10 次
      stack_max: { copper_ore: 1 },
    });
    expect(report.stop_reason).toBe(StopReason.InventoryFull);
    expect(report.ticks).toBe(1);
    expect(report.gained).toEqual([{ item_id: 'copper_ore', amount: 1 }]);
    expect(done.inventory).toEqual([
      { item_id: 'stone', quantity: 5 },
      { item_id: 'copper_ore', quantity: 1 },
    ]);
  });

  it('同种物品可堆叠：已有 998 铜矿（堆叠 999），第 1 次动作补满，第 2 次开新格', () => {
    const t0 = 0;
    const player = makePlayer({
      inventory: [{ item_id: 'copper_ore', quantity: 998 }],
      inventory_capacity: 2,
    });
    const started = startAction({ player, action: MINE_COPPER, now: t0 });
    const { player: done, report } = settle({
      player: started,
      action: MINE_COPPER,
      now: t0 + 3_000,
    });
    expect(report.ticks).toBe(3);
    expect(report.stop_reason).toBe(StopReason.DurationCap);
    expect(done.inventory).toEqual([
      { item_id: 'copper_ore', quantity: 999 },
      { item_id: 'copper_ore', quantity: 2 },
    ]);
  });
});
