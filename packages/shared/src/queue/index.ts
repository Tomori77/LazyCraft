/**
 * 动作队列 —— task-36（P4-7）。
 *
 * 为什么放在 packages/shared？
 *   《开发总纲》铁律：所有"游戏规则"一份代码。队列的推进/截断/中止规则
 *   属于游戏规则，必须与 idle 的 settle() 同源，前后端永不打架。
 *
 * 与 idle 的关系：
 *   本模块**不重写**结算数学，只做"把队列切成一段段"的编排：
 *   每段仍调用 settle() 一次，因此材料耗尽 / 背包满 / 24h 上限的判定
 *   与单动作完全一致，不存在第二套口径。
 *
 * 服务器权威：
 *   now 必须由后端以服务器时钟传入；本模块不读取任何客户端时钟。
 */

import {
  actionBlockReason,
  OFFLINE_CAP_MS,
  StopReason,
  settle,
  type ActiveAction,
  type ItemDelta,
  type PlayerState,
  type SettleReport,
} from '../idle/index.js';
import type { SkillAction } from '../types.js';

/* ------------------------------------------------------------------ */
/* 类型                                                                  */
/* ------------------------------------------------------------------ */

/**
 * 队列中的一项。
 *
 * count 是**剩余圈数**而不是"总圈数"：每结算掉一圈就减一，
 * 完成后该项从队列移除。存"剩余量"而不是"总量 + 已做量"，
 * 是为了让离线结算中断（材料耗尽/时间用完）时直接落盘即可续跑，
 * 不需要额外记录进度游标。
 */
export interface ActionQueueItem {
  action_id: string;
  skill_id: string;
  /** 剩余圈数（≥1）；N 圈 = N 次产出，与 idle/settle 的 tick 口径一致 */
  count: number;
}

export type ActionQueue = ActionQueueItem[];

/** 槽位总数（DLC 可扩展；本体只开放前 N 个） */
export const QUEUE_MAX_SLOTS = 10;
/** 本体开放的槽位数；其余待 DLC 解锁 */
export const QUEUE_UNLOCKED_SLOTS = 3;

/** 单次队列结算里，每一项的逐项报告 */
export interface QueueItemReport {
  action_id: string;
  skill_id: string;
  /** 本次实际完成的圈数（≤ 该项结算前的剩余 count） */
  ticks: number;
  gained: ItemDelta[];
  consumed: ItemDelta[];
  lost: ItemDelta[];
  exp_gained: Record<string, number>;
  /** 该项自身的停止原因（与单动作 settle 同一枚举） */
  stop_reason: StopReason;
  /** true = 该项按设定圈数全部完成，已从队列移除 */
  completed: boolean;
  /** true = 动作配置已不存在（内容被删），该行被剔除而非卡死 */
  missing?: boolean;
  /** 该项实际参与结算的秒数（聚合用） */
  effective_seconds: number;
}

/** 队列整体停止原因 */
export type QueueStopReason =
  /** 队列已跑完 */
  | 'queue_empty'
  /** 队首尚未开始（空闲 + 队列非空，等待起跑） */
  | 'queue_pending'
  /** 时间被 24h 上限用尽，队列尚有剩余 */
  | 'duration_cap'
  /** 材料耗尽，按实际圈数结算并中止后续 */
  | 'input_exhausted'
  /** 背包满，按实际圈数结算并中止后续 */
  | 'inventory_full'
  /** 队首动作配置不存在（已剔除该行） */
  | 'action_missing';

export interface QueueSettleInput {
  player: PlayerState;
  queue: readonly ActionQueueItem[];
  /** 服务器当前时间（毫秒） */
  now: number;
  /** 动作解析器：id → SkillAction；返回 undefined 视为内容被删 */
  resolveAction: (actionId: string) => SkillAction | undefined;
  /** 产出物品堆叠上限表，透传给 settle */
  stack_max?: Record<string, number>;
}

export interface QueueSettleResult {
  /** 结算后的玩家状态；current_action 为 null 或"续跑的队首项" */
  player: PlayerState;
  /** 结算后的剩余队列（完成项已移除，部分完成项保留剩余圈数） */
  queue: ActionQueueItem[];
  /** 逐项报告（按执行顺序） */
  reports: QueueItemReport[];
  /** 队列整体停止原因 */
  stop_reason: QueueStopReason;
  /** 本次合计完成的圈数 */
  total_ticks: number;
}

/* ------------------------------------------------------------------ */
/* 逐项结算                                                              */
/* ------------------------------------------------------------------ */

/**
 * 按队列顺序结清"截至 now 可完成的圈数"。
 *
 * 算法（时间轴推进）：
 *   1. 起点 = 当前动作的 started_at（队首正在跑时）；空闲则队列尚未起跑，
 *      直接返回 queue_pending 让调用方落一个 current_action。
 *   2. 全局截止 = min(now, 起点 + 24h)：离线收益上限是**整条队列共享**的，
 *      否则每项各吃 24h 会得到 N×24h。
 *   3. 每一轮取队首，按 min(剩余 count, 剩余时间) 调 settle() 一次：
 *        - 跑满 count → 移除该项，时间轴前进 count×interval，继续下一项；
 *        - 材料耗尽/背包满 → 该项按实际圈数结算，剩余 count 留下，中止后续；
 *        - 时间用尽 → 该项剩余 count 留下，current_action 续到停止边界，中止。
 *   4. 动作配置缺失 → 剔除该行并继续，不让单条坏数据卡死整条队列。
 *
 * 为什么逐项调用 settle 而不是整条队列一次性算？
 *   每项的 interval / 消耗 / 产出都不同，且中途停顿点是离散事件；
 *   复用 settle 能让判定口径与单动作 100% 一致，避免第二套数学。
 */
export function settleQueue(input: QueueSettleInput): QueueSettleResult {
  const { player, now, resolveAction, stack_max } = input;
  const remaining: ActionQueueItem[] = input.queue.map((item) => ({ ...item }));

  if (remaining.length === 0) {
    return { player, queue: [], reports: [], stop_reason: 'queue_empty', total_ticks: 0 };
  }

  const current = player.current_action;
  // 队首正在跑：时间轴从其 started_at 起算；空闲或 current_action 与队首不符
  // 则队列尚未起跑（服务端会随后落 current_action），本次无可结算时间
  if (!current || current.action_id !== remaining[0].action_id) {
    return {
      player: {
        ...player,
        current_action: { action_id: remaining[0].action_id, started_at: now } satisfies ActiveAction,
      },
      queue: remaining,
      reports: [],
      stop_reason: 'queue_pending',
      total_ticks: 0,
    };
  }

  const start = current.started_at;
  const end = Math.min(now, start + OFFLINE_CAP_MS);
  let cursor = start;
  let state = player;
  let totalTicks = 0;
  let stopReason: QueueStopReason = 'queue_empty';
  let resumeCurrent: ActiveAction | null = null;
  const reports: QueueItemReport[] = [];

  let index = 0;
  while (index < remaining.length) {
    const item = remaining[index];
    // 防御：count 应为正；异常 0 直接视为完成，避免死循环
    if (item.count <= 0) {
      remaining.splice(index, 1);
      continue;
    }

    const action = resolveAction(item.action_id);
    if (!action) {
      reports.push({
        action_id: item.action_id,
        skill_id: item.skill_id,
        ticks: 0,
        gained: [],
        consumed: [],
        lost: [],
        exp_gained: {},
        stop_reason: StopReason.NoTicks,
        completed: false,
        missing: true,
        effective_seconds: 0,
      });
      remaining.splice(index, 1);
      stopReason = 'action_missing';
      continue;
    }

    const itemStart = cursor;
    // 该项最多做到 count 圈，且不越过全局截止
    const itemEnd = Math.min(itemStart + item.count * action.interval_ms, end);
    const settled = settle({
      player: {
        ...state,
        current_action: { action_id: action.id, started_at: itemStart },
      },
      action,
      now: itemEnd,
      stack_max,
    });
    state = settled.player;
    totalTicks += settled.report.ticks;

    const completed = settled.report.ticks >= item.count;
    reports.push({
      action_id: action.id,
      skill_id: action.skill_id,
      ticks: settled.report.ticks,
      gained: settled.report.gained,
      consumed: settled.report.consumed,
      lost: settled.report.lost,
      exp_gained: settled.report.exp_gained,
      stop_reason: settled.report.stop_reason,
      completed,
      effective_seconds: settled.report.effective_seconds,
    });

    if (!completed) {
      // 部分完成：扣掉已做圈数，剩余留在队列
      item.count -= settled.report.ticks;
      // settle 在 0 圈时统一报 NoTicks，无法区分"时间没到"与"条件不满足"；
      // 用只读的 actionBlockReason 复核，口径与 settle 内部判断完全一致。
      const blockReason = actionBlockReason(state, action, stack_max);
      if (blockReason) {
        // 硬阻塞（材料/背包）：清空当前动作，剩余队列保留，等待玩家处理后重试
        stopReason = blockReason === StopReason.InputExhausted ? 'input_exhausted' : 'inventory_full';
      } else {
        // 时间用尽：从停止边界续跑，不丢任何圈
        stopReason = 'duration_cap';
        resumeCurrent = {
          action_id: action.id,
          started_at: itemStart + settled.report.ticks * action.interval_ms,
        };
      }
      break;
    }

    // 完整完成：移除该项，时间轴推进其全部时长
    cursor = itemStart + item.count * action.interval_ms;
    remaining.splice(index, 1);
    // splice 后 index 不动，指向原本的下一项

    if (cursor >= end) {
      if (remaining.length > 0) {
        // 时间已用尽但还有后续项：续跑下一项，等待下一次结算
        stopReason = 'duration_cap';
        resumeCurrent = { action_id: remaining[0].action_id, started_at: cursor };
      } else {
        stopReason = 'queue_empty';
      }
      break;
    }
  }

  return {
    player: { ...state, current_action: resumeCurrent },
    queue: remaining,
    reports,
    stop_reason: stopReason,
    total_ticks: totalTicks,
  };
}

/* ------------------------------------------------------------------ */
/* 聚合报告（给前端复用既有 SettleReport 形态）                            */
/* ------------------------------------------------------------------ */

/** 把 QueueStopReason 映射回单动作 StopReason，供沿用旧前端提示逻辑 */
export function stopReasonFromQueue(reason: QueueStopReason): StopReason {
  switch (reason) {
    case 'input_exhausted':
      return StopReason.InputExhausted;
    case 'inventory_full':
      return StopReason.InventoryFull;
    case 'duration_cap':
      return StopReason.DurationCap;
    default:
      return StopReason.NoTicks;
  }
}

/**
 * 把逐项报告合并成一份 SettleReport。
 *
 * 为什么需要聚合？
 *   前端 / 任务监听器消费的是既有 SettleReport 形态；队列逐项报告是新增维度，
 *   两者同时下发，旧的消费路径无需改动即可工作。
 */
export function aggregateQueueReports(
  reports: readonly QueueItemReport[],
  stopReason: QueueStopReason,
): SettleReport {
  const gained = new Map<string, ItemDelta>();
  const consumed = new Map<string, ItemDelta>();
  const lost = new Map<string, ItemDelta>();
  const exp: Record<string, number> = {};
  let ticks = 0;
  let seconds = 0;

  const merge = (target: Map<string, ItemDelta>, list: readonly ItemDelta[]) => {
    for (const delta of list) {
      const cur = target.get(delta.item_id);
      if (cur) cur.amount += delta.amount;
      else target.set(delta.item_id, { item_id: delta.item_id, amount: delta.amount });
    }
  };

  for (const report of reports) {
    ticks += report.ticks;
    seconds += report.effective_seconds;
    merge(gained, report.gained);
    merge(consumed, report.consumed);
    merge(lost, report.lost);
    for (const [skillId, value] of Object.entries(report.exp_gained)) {
      exp[skillId] = (exp[skillId] ?? 0) + value;
    }
  }

  const byItem = (map: Map<string, ItemDelta>) =>
    [...map.values()].sort((a, b) => a.item_id.localeCompare(b.item_id));

  return {
    effective_seconds: seconds,
    ticks,
    gained: byItem(gained),
    consumed: byItem(consumed),
    lost: byItem(lost),
    exp_gained: exp,
    stop_reason: stopReasonFromQueue(stopReason),
  };
}
