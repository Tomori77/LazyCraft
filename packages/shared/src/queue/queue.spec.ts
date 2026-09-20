/**
 * 动作队列结算纯函数测试（task-36）。
 *
 * 覆盖：队列推进、按圈数截断、材料耗尽中止、背包满中止、空队列、
 * 24h 上限、逐项报告正确、动作配置缺失容错。
 */

import { describe, expect, it } from 'vitest';
import type { SkillAction } from '../types.js';
import { OFFLINE_CAP_MS, StopReason, type PlayerState } from '../idle/index.js';
import {
  aggregateQueueReports,
  QUEUE_MAX_SLOTS,
  QUEUE_UNLOCKED_SLOTS,
  settleQueue,
  type ActionQueueItem,
} from './index.js';

/* ---------------------------------------------------------------- */
/* 夹具                                                              */
/* ---------------------------------------------------------------- */

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

const CHOP_MAPLE: SkillAction = {
  id: 'chop_maple',
  skill_id: 'woodcutting',
  name: '砍枫树',
  interval_ms: 2000,
  exp: 8,
  input_items: {},
  output_items: { maple_log: 1 },
  output_exp: 0,
  required_level: 1,
  tier: 1,
};

const CATALOG: Record<string, SkillAction> = {
  [MINE_COPPER.id]: MINE_COPPER,
  [BURN_WOOD.id]: BURN_WOOD,
  [CHOP_MAPLE.id]: CHOP_MAPLE,
};

const resolve = (id: string) => CATALOG[id];

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    inventory: [],
    inventory_capacity: 100,
    skill_exp: {},
    current_action: null,
    ...overrides,
  };
}

function item(actionId: string, count: number, skillId?: string): ActionQueueItem {
  return {
    action_id: actionId,
    skill_id: skillId ?? CATALOG[actionId]?.skill_id ?? 'unknown',
    count,
  };
}

/* ---------------------------------------------------------------- */
/* 常量                                                              */
/* ---------------------------------------------------------------- */

describe('队列常量', () => {
  it('10 槽，本体开放 3 槽', () => {
    expect(QUEUE_MAX_SLOTS).toBe(10);
    expect(QUEUE_UNLOCKED_SLOTS).toBe(3);
  });
});

/* ---------------------------------------------------------------- */
/* 推进与截断                                                        */
/* ---------------------------------------------------------------- */

describe('settleQueue 推进', () => {
  it('空队列：无报告，queue_empty', () => {
    const res = settleQueue({
      player: makePlayer(),
      queue: [],
      now: 10_000,
      resolveAction: resolve,
    });
    expect(res.stop_reason).toBe('queue_empty');
    expect(res.reports).toEqual([]);
    expect(res.queue).toEqual([]);
    expect(res.total_ticks).toBe(0);
  });

  it('空闲 + 队列非空：落队首 current_action，返回 queue_pending', () => {
    const res = settleQueue({
      player: makePlayer(),
      queue: [item('mine_copper', 5)],
      now: 1000,
      resolveAction: resolve,
    });
    expect(res.stop_reason).toBe('queue_pending');
    expect(res.player.current_action).toEqual({ action_id: 'mine_copper', started_at: 1000 });
    expect(res.queue).toEqual([item('mine_copper', 5)]);
    expect(res.reports).toEqual([]);
  });

  it('单项跑满设定圈数：产出正确并移出队列', () => {
    const res = settleQueue({
      player: makePlayer({ current_action: { action_id: 'mine_copper', started_at: 0 } }),
      queue: [item('mine_copper', 3)],
      now: 3000,
      resolveAction: resolve,
    });
    expect(res.reports).toHaveLength(1);
    expect(res.reports[0]).toMatchObject({
      action_id: 'mine_copper',
      ticks: 3,
      completed: true,
      stop_reason: StopReason.DurationCap,
    });
    expect(res.reports[0].gained).toEqual([{ item_id: 'copper_ore', amount: 3 }]);
    expect(res.queue).toEqual([]);
    expect(res.stop_reason).toBe('queue_empty');
    expect(res.total_ticks).toBe(3);
    expect(res.player.inventory).toEqual([{ item_id: 'copper_ore', quantity: 3 }]);
    expect(res.player.skill_exp).toEqual({ mining: 30 });
  });

  it('多项按顺序接续：前项完成后进入下一项，逐项报告顺序正确', () => {
    // 队列：3 圈铜矿(1s) + 2 圈枫木(2s)，总共 3 + 4 = 7s 的窗口
    const res = settleQueue({
      player: makePlayer({ current_action: { action_id: 'mine_copper', started_at: 0 } }),
      queue: [item('mine_copper', 3), item('chop_maple', 2)],
      now: 7000,
      resolveAction: resolve,
    });
    expect(res.reports.map((r) => r.action_id)).toEqual(['mine_copper', 'chop_maple']);
    expect(res.reports[0].ticks).toBe(3);
    expect(res.reports[1].ticks).toBe(2);
    expect(res.queue).toEqual([]);
    expect(res.total_ticks).toBe(5);
    expect(res.player.skill_exp).toEqual({ mining: 30, woodcutting: 16 });
    const copper = res.player.inventory.find((s) => s.item_id === 'copper_ore');
    const maple = res.player.inventory.find((s) => s.item_id === 'maple_log');
    expect(copper?.quantity).toBe(3);
    expect(maple?.quantity).toBe(2);
  });

  it('时间不足：按可完成圈数截断，剩余 count 留在队列，started_at 续到边界', () => {
    // 窗口 5s：3 圈铜矿(3s) 完成后，枫木每圈 2s 只够 1 圈
    const res = settleQueue({
      player: makePlayer({ current_action: { action_id: 'mine_copper', started_at: 0 } }),
      queue: [item('mine_copper', 3), item('chop_maple', 5)],
      now: 5000,
      resolveAction: resolve,
    });
    expect(res.reports).toHaveLength(2);
    expect(res.reports[0].completed).toBe(true);
    expect(res.reports[1]).toMatchObject({ action_id: 'chop_maple', ticks: 1, completed: false });
    expect(res.stop_reason).toBe('duration_cap');
    // 剩余 4 圈留队列，current_action 续到 3+2=5s
    expect(res.queue).toEqual([item('chop_maple', 4)]);
    expect(res.player.current_action).toEqual({ action_id: 'chop_maple', started_at: 5000 });
  });

  it('队首 count 被时间截断（尚未轮到后续项）', () => {
    const res = settleQueue({
      player: makePlayer({ current_action: { action_id: 'mine_copper', started_at: 0 } }),
      queue: [item('mine_copper', 10), item('chop_maple', 1)],
      now: 4000,
      resolveAction: resolve,
    });
    expect(res.reports).toHaveLength(1);
    expect(res.reports[0]).toMatchObject({ ticks: 4, completed: false });
    expect(res.queue).toEqual([item('mine_copper', 6), item('chop_maple', 1)]);
    expect(res.player.current_action).toEqual({ action_id: 'mine_copper', started_at: 4000 });
  });

  it('current_action 与队首不符（空闲残影）：视为队列未起跑', () => {
    const res = settleQueue({
      player: makePlayer({ current_action: { action_id: 'chop_maple', started_at: 0 } }),
      queue: [item('mine_copper', 3)],
      now: 5000,
      resolveAction: resolve,
    });
    expect(res.stop_reason).toBe('queue_pending');
    expect(res.player.current_action).toEqual({ action_id: 'mine_copper', started_at: 5000 });
    expect(res.total_ticks).toBe(0);
  });
});

/* ---------------------------------------------------------------- */
/* 中止条件                                                          */
/* ---------------------------------------------------------------- */

describe('settleQueue 中止', () => {
  it('材料耗尽：按实际圈数结算，剩余 count 保留并中止后续', () => {
    // 2 个木头，队列要烧 5 圈；第三项不该被执行
    const res = settleQueue({
      player: makePlayer({
        inventory: [{ item_id: 'wood', quantity: 2 }],
        current_action: { action_id: 'burn_wood', started_at: 0 },
      }),
      queue: [item('burn_wood', 5), item('mine_copper', 3)],
      now: 20_000,
      resolveAction: resolve,
    });
    expect(res.reports).toHaveLength(1);
    expect(res.reports[0]).toMatchObject({
      action_id: 'burn_wood',
      ticks: 2,
      completed: false,
      stop_reason: StopReason.InputExhausted,
    });
    expect(res.reports[0].gained).toEqual([{ item_id: 'charcoal', amount: 2 }]);
    expect(res.reports[0].consumed).toEqual([{ item_id: 'wood', amount: 2 }]);
    expect(res.stop_reason).toBe('input_exhausted');
    // 剩余 3 圈留在队列，后续项原样保留，动作停止
    expect(res.queue).toEqual([item('burn_wood', 3), item('mine_copper', 3)]);
    expect(res.player.current_action).toBeNull();
  });

  it('背包满：按实际圈数结算并中止', () => {
    // 容量 2 格，堆叠上限 1：第一圈占 1 格，第二圈起放不下
    const res = settleQueue({
      player: makePlayer({
        inventory: [{ item_id: 'stone', quantity: 1 }],
        inventory_capacity: 2,
        current_action: { action_id: 'mine_copper', started_at: 0 },
      }),
      queue: [item('mine_copper', 5)],
      now: 10_000,
      resolveAction: resolve,
      stack_max: { copper_ore: 1 },
    });
    expect(res.reports).toHaveLength(1);
    expect(res.reports[0]).toMatchObject({
      ticks: 1,
      completed: false,
      stop_reason: StopReason.InventoryFull,
    });
    expect(res.stop_reason).toBe('inventory_full');
    expect(res.queue).toEqual([item('mine_copper', 4)]);
    expect(res.player.current_action).toBeNull();
  });

  it('动作配置缺失：剔除该行并继续执行下一项', () => {
    const res = settleQueue({
      player: makePlayer({ current_action: { action_id: 'ghost_action', started_at: 0 } }),
      queue: [item('ghost_action', 3), item('mine_copper', 2)],
      now: 2000,
      resolveAction: resolve,
    });
    // 缺配置项留下 missing 报告后被剔除，时间窗继续用于下一项
    expect(res.reports[0]).toMatchObject({ action_id: 'ghost_action', missing: true, ticks: 0 });
    expect(res.reports[1]).toMatchObject({ action_id: 'mine_copper', ticks: 2, completed: true });
    expect(res.queue).toEqual([]);
    expect(res.stop_reason).toBe('queue_empty');
  });

  it('count<=0 的脏行被剔除，不产生死循环', () => {
    const res = settleQueue({
      player: makePlayer({ current_action: { action_id: 'mine_copper', started_at: 0 } }),
      queue: [item('mine_copper', 0), item('mine_copper', 2)],
      now: 2000,
      resolveAction: resolve,
    });
    expect(res.reports).toHaveLength(1);
    expect(res.total_ticks).toBe(2);
    expect(res.queue).toEqual([]);
  });
});

/* ---------------------------------------------------------------- */
/* 24h 上限                                                          */
/* ---------------------------------------------------------------- */

describe('settleQueue 24h 上限', () => {
  it('整条队列共享 24h：上限内的项完成，超出的项剩余留队', () => {
    // 每项 1s/圈：24h 内只够第一项 86400 圈 + 第二项 0 圈（时间恰好用尽）
    const res = settleQueue({
      player: makePlayer({ current_action: { action_id: 'mine_copper', started_at: 0 } }),
      queue: [item('mine_copper', 86_400), item('mine_copper', 10)],
      now: OFFLINE_CAP_MS * 3,
      resolveAction: resolve,
    });
    expect(res.reports[0].ticks).toBe(86_400);
    expect(res.reports[0].completed).toBe(true);
    expect(res.stop_reason).toBe('duration_cap');
    expect(res.queue).toEqual([item('mine_copper', 10)]);
    expect(res.total_ticks).toBe(86_400);
    expect(res.player.current_action).toEqual({ action_id: 'mine_copper', started_at: OFFLINE_CAP_MS });
  });

  it('单项需要超过 24h：只结算上限内圈数，剩余留队', () => {
    const res = settleQueue({
      player: makePlayer({ current_action: { action_id: 'mine_copper', started_at: 0 } }),
      queue: [item('mine_copper', 100_000)],
      now: OFFLINE_CAP_MS * 2,
      resolveAction: resolve,
    });
    expect(res.reports[0].ticks).toBe(86_400);
    expect(res.reports[0].completed).toBe(false);
    expect(res.stop_reason).toBe('duration_cap');
    expect(res.queue).toEqual([item('mine_copper', 100_000 - 86_400)]);
  });

  it('now 早于 started_at（时钟异常）时不出负圈', () => {
    const res = settleQueue({
      player: makePlayer({ current_action: { action_id: 'mine_copper', started_at: 10_000 } }),
      queue: [item('mine_copper', 5)],
      now: 5000,
      resolveAction: resolve,
    });
    expect(res.total_ticks).toBe(0);
    expect(res.queue).toEqual([item('mine_copper', 5)]);
  });
});

/* ---------------------------------------------------------------- */
/* 聚合报告                                                          */
/* ---------------------------------------------------------------- */

describe('aggregateQueueReports', () => {
  it('合并多技能经验 / 物品与圈数', () => {
    const res = settleQueue({
      player: makePlayer({ current_action: { action_id: 'mine_copper', started_at: 0 } }),
      queue: [item('mine_copper', 3), item('chop_maple', 2)],
      now: 7000,
      resolveAction: resolve,
    });
    const report = aggregateQueueReports(res.reports, res.stop_reason);
    expect(report.ticks).toBe(5);
    expect(report.exp_gained).toEqual({ mining: 30, woodcutting: 16 });
    expect(report.gained).toEqual([
      { item_id: 'copper_ore', amount: 3 },
      { item_id: 'maple_log', amount: 2 },
    ]);
    expect(report.stop_reason).toBe(StopReason.NoTicks);
  });

  it('把队列停止原因映射回单动作原因（供旧提示逻辑复用）', () => {
    expect(aggregateQueueReports([], 'input_exhausted').stop_reason).toBe(StopReason.InputExhausted);
    expect(aggregateQueueReports([], 'inventory_full').stop_reason).toBe(StopReason.InventoryFull);
    expect(aggregateQueueReports([], 'duration_cap').stop_reason).toBe(StopReason.DurationCap);
  });
});
