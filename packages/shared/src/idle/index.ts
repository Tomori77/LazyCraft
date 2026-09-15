/**
 * 挂机/离线结算核心 —— 整个项目的灵魂。
 *
 * 为什么放在 packages/shared？
 *   《开发总纲》铁律：所有"游戏规则"一份代码，前端用它做收益预览，
 *   后端用它做权威结算（写入存档）。前后端永不打架。
 *
 * 为什么不做逐秒模拟？
 *   动作只有"间隔、消耗、产出"三个属性，纯数学关系即可解析出
 *   中途停顿点（材料耗尽 / 背包满在哪一次触发），逐次模拟只会把
 *   O(n) 的循环变成 bug 繁殖地，还无法证明与总账公式等价。
 *
 * 服务器权威：
 *   所有时间戳（started_at / now）必须由后端以服务器时钟传入，
 *   前端只用来"演出"进度条。本模块不读取任何客户端时钟。
 */

import type { SkillAction } from '../types.js';

/* ------------------------------------------------------------------ */
/* 类型                                                                  */
/* ------------------------------------------------------------------ */

/**
 * 背包中的一格：同种物品按堆叠拆成多格。
 *
 * 为什么结算是按"格"而不是按"数量"判满？
 *   背包 UI 按格显示（见设计清单：容量 12/100），堆叠上限来自物品配置表
 *   （stack_max），满仓判定自然以格为单位。
 */
export interface ItemStack {
  item_id: string;
  /** 该格当前堆叠数量（≥1） */
  quantity: number;
}

/** 结算引擎面对的"玩家状态"——存档 data 字段中与本模块相关的最小切片 */
export interface PlayerState {
  /** 物品背包：一格一份 ItemStack */
  inventory: ItemStack[];
  /** 背包总格数上限（默认 100，见设计清单） */
  inventory_capacity: number;
  /** 各技能累计经验，key 为 skill_id；离线结算会累加 action.exp */
  skill_exp: Record<string, number>;
  /** 当前正在执行的动作，null = 空闲 */
  current_action: ActiveAction | null;
}

/** 一个正在执行中的动作 */
export interface ActiveAction {
  /** 引用的动作配置 ID（SkillAction.id） */
  action_id: string;
  /** 服务器时间戳（毫秒）：动作开始时刻 */
  started_at: number;
}

/** 动作停止原因（写入结算报告，前端据此提示玩家） */
export enum StopReason {
  /** 离线时长达到 24h 硬上限（防数值失控 + 促使玩家每天回来） */
  DurationCap = 'duration_cap',
  /** 材料在第 N 次动作前耗尽 */
  InputExhausted = 'input_exhausted',
  /** 背包在产出第 N 格时满了 */
  InventoryFull = 'inventory_full',
  /** 手动停止（结算时长不足一个 tick 时的默认值） */
  NoTicks = 'no_ticks',
}

/** 单个物品的变动明细 */
export interface ItemDelta {
  item_id: string;
  /** 实际入包数量 */
  amount: number;
}

/** 结算报告：每一项资源变动都可追溯（见参考文档"离线结算建议"） */
export interface SettleReport {
  /** 实际参与结算的秒数（≤ 24h 上限，≥0） */
  effective_seconds: number;
  /** 完成的动作次数 */
  ticks: number;
  /** 产出物品 */
  gained: ItemDelta[];
  /** 消耗物品 */
  consumed: ItemDelta[];
  /**
   * 因背包满而未能入包的产出（玩家可理解的"丢失"维度）。
   *
   * 为什么 settle 在背包满时提前停止还要有 lost？
   *   背包满发生在某个 tick 中途：同一次 tick 可能先产出了能放下的物品，
   *   剩余物品才触发满格。gained 只记实际入包量，lost 记放不下的差额，
   *   结算报告才能给玩家一个总账（产出 = gained + lost）。
   */
  lost: ItemDelta[];
  /** 技能经验增加量 */
  exp_gained: Record<string, number>;
  /** 停止原因 */
  stop_reason: StopReason;
}

/** settle 返回值：新状态 + 报告 */
export interface SettleResult {
  player: PlayerState;
  report: SettleReport;
}

/** 开始动作的入参 */
export interface StartActionInput {
  player: PlayerState;
  action: SkillAction;
  /** 服务器当前时间（毫秒） */
  now: number;
}

/** 结算入参 */
export interface SettleInput {
  player: PlayerState;
  action: SkillAction;
  /** 服务器当前时间（毫秒） */
  now: number;
  /** 产出物品堆叠上限表：item_id -> stack_max（缺省按 999，与基础物品一致） */
  stack_max?: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* 常量                                                                  */
/* ------------------------------------------------------------------ */

/** 离线收益硬上限：24 小时（毫秒）。DLC 后续可通过扩展点放开。 */
export const OFFLINE_CAP_MS = 24 * 60 * 60 * 1000;

/** 缺省堆叠上限：与 types.ts 中基础物品的 stack_max 约定一致 */
const DEFAULT_STACK_MAX = 999;

/* ------------------------------------------------------------------ */
/* 内部工具（纯函数，不导出）                                              */
/* ------------------------------------------------------------------ */

type Inv = { stacks: ItemStack[]; capacity: number };

/** 某种物品在背包里的总数量 */
function countItem(stacks: ItemStack[], itemId: string): number {
  let sum = 0;
  for (const s of stacks) if (s.item_id === itemId) sum += s.quantity;
  return sum;
}

/** 一次动作消耗的材料是否足够（只读检查） */
function canConsume(inv: Inv, inputs: Record<string, number>): boolean {
  for (const [itemId, qty] of Object.entries(inputs)) {
    if (qty > 0 && countItem(inv.stacks, itemId) < qty) return false;
  }
  return true;
}

/** 应用一次动作的材料消耗（调用前必须已 canConsume 通过） */
function applyConsume(inv: Inv, inputs: Record<string, number>): void {
  for (const [itemId, qty] of Object.entries(inputs)) {
    if (qty <= 0) continue;
    // 从前往后扣：先扣靠前格子的堆叠，让背包自然向左压缩
    let remaining = qty;
    for (const s of inv.stacks) {
      if (s.item_id !== itemId || remaining <= 0) continue;
      const take = Math.min(s.quantity, remaining);
      s.quantity -= take;
      remaining -= take;
    }
    inv.stacks = inv.stacks.filter((s) => s.quantity > 0);
  }
}

/**
 * 一次动作的产出能否全部入包。
 *
 * 判定规则：先在已有同种格子内补满堆叠，再占用新格；
 * 任何一件放不下（容量用光）即判定"这次会触发背包满"。
 */
function canAdd(
  inv: Inv,
  outputs: Record<string, number>,
  stackMax: (id: string) => number,
): boolean {
  const simulate: ItemStack[] = inv.stacks.map((s) => ({ ...s }));
  let freeSlots = inv.capacity - simulate.length;
  for (const [itemId, qty] of Object.entries(outputs)) {
    if (qty <= 0) continue;
    const max = stackMax(itemId);
    let remaining = qty;
    for (const s of simulate) {
      if (s.item_id !== itemId || s.quantity >= max) continue;
      const space = max - s.quantity;
      const add = Math.min(space, remaining);
      s.quantity += add;
      remaining -= add;
      if (remaining <= 0) break;
    }
    while (remaining > 0) {
      if (freeSlots <= 0) return false;
      const take = Math.min(max, remaining);
      simulate.push({ item_id: itemId, quantity: take });
      freeSlots -= 1;
      remaining -= take;
    }
  }
  return true;
}

/** 应用一次动作的产出（调用前必须已 canAdd 通过） */
function applyAdd(
  inv: Inv,
  outputs: Record<string, number>,
  stackMax: (id: string) => number,
): void {
  for (const [itemId, qty] of Object.entries(outputs)) {
    if (qty <= 0) continue;
    const max = stackMax(itemId);
    let remaining = qty;
    // 先补已有格（从左到右），再开新格
    for (const s of inv.stacks) {
      if (s.item_id !== itemId || s.quantity >= max) continue;
      const space = max - s.quantity;
      const add = Math.min(space, remaining);
      s.quantity += add;
      remaining -= add;
      if (remaining <= 0) break;
    }
    while (remaining > 0) {
      const take = Math.min(max, remaining);
      inv.stacks.push({ item_id: itemId, quantity: take });
      remaining -= take;
    }
  }
}

/**
 * 计算一次产出中"能放得下"的部分与实际入包量。
 * 供 settle 在背包满时把差额记进 lost，而不是直接丢弃。
 */
function computeAddCapacity(
  inv: Inv,
  outputs: Record<string, number>,
  stackMax: (id: string) => number,
): Map<string, number> {
  const maxAddable = new Map<string, number>();
  const simulate: ItemStack[] = inv.stacks.map((s) => ({ ...s }));
  let freeSlots = inv.capacity - simulate.length;
  for (const [itemId, qty] of Object.entries(outputs)) {
    if (qty <= 0) continue;
    const max = stackMax(itemId);
    let remaining = qty;
    for (const s of simulate) {
      if (s.item_id !== itemId || s.quantity >= max) continue;
      const space = max - s.quantity;
      const add = Math.min(space, remaining);
      s.quantity += add;
      remaining -= add;
      if (remaining <= 0) break;
    }
    while (remaining > 0 && freeSlots > 0) {
      const take = Math.min(max, remaining);
      simulate.push({ item_id: itemId, quantity: take });
      freeSlots -= 1;
      remaining -= take;
    }
    maxAddable.set(itemId, qty - remaining);
  }
  return maxAddable;
}

/** 累计产出/消耗明细 */
function makeDeltaRecorder() {
  const map = new Map<string, ItemDelta>();
  return {
    add(itemId: string, amount: number) {
      if (amount === 0) return;
      const cur = map.get(itemId);
      if (cur) {
        cur.amount += amount;
      } else {
        map.set(itemId, { item_id: itemId, amount });
      }
    },
    list(): ItemDelta[] {
      return [...map.values()].sort((a, b) => a.item_id.localeCompare(b.item_id));
    },
  };
}

/* ------------------------------------------------------------------ */
/* 对外 API                                                               */
/* ------------------------------------------------------------------ */

/**
 * 开始一个动作。
 *
 * 服务器职责：调用前必须先对旧动作做 settle（玩家不会白打工）；
 * 本函数只负责"切换"，不检查材料是否够下一次（结算时材料耗尽自然会停）。
 */
export function startAction(input: StartActionInput): PlayerState {
  const { player, action, now } = input;
  // 重复开始同一个动作 = 无操作，避免误把 started_at 推后导致收益被吞
  if (player.current_action && player.current_action.action_id === action.id) {
    return player;
  }
  return {
    ...player,
    current_action: { action_id: action.id, started_at: now },
  };
}

/**
 * 离线结算：从 current_action.started_at 到 now 的一次性总账。
 *
 * 流程：
 *   1. 有效时长 = min(now - started_at, 24h 上限)
 *   2. 完整 tick 数 = floor(有效时长 / interval)
 *   3. 逐 tick 模拟（tick 数上界 24h/interval，可控）：
 *      - 每个 tick 开始前检查材料与背包，任一不满足则记录 stop_reason 提前结束
 *      - 该 tick 的产出完整入包（canAdd 已保证放得下）
 *   4. 输出新 PlayerState 与 SettleReport；调用方把报告展示给玩家
 *
 * 为什么逐 tick 模拟而不直接乘倍数？
 *   材料耗尽/背包满的"停顿点"是离散事件——必须找到第一个不满足条件的 tick。
 *   数学上可以解析求解，但代码复杂度更高；这里 tick 数上界受 24h/interval
 *   限制（最坏情况 86400 次/秒级间隔），现代 CPU 毫无压力。
 */
export function settle(input: SettleInput): SettleResult {
  const { player, action, now } = input;
  const stackMaxOf = (id: string) => input.stack_max?.[id] ?? DEFAULT_STACK_MAX;

  // 空闲状态：没有任何动作发生，报告全空
  if (!player.current_action) {
    return {
      player,
      report: {
        effective_seconds: 0,
        ticks: 0,
        gained: [],
        consumed: [],
        lost: [],
        exp_gained: {},
        stop_reason: StopReason.NoTicks,
      },
    };
  }

  const elapsedMs = Math.max(0, now - player.current_action.started_at);
  const effectiveMs = Math.min(elapsedMs, OFFLINE_CAP_MS);
  const intervalMs = Math.max(1, action.interval_ms); // 防御：配置表里 interval=0 会直接除零
  const maxTicks = Math.floor(effectiveMs / intervalMs);

  // 背包/材料的工作副本：结算成功才回填，失败/停顿时保持原貌
  const inv: Inv = {
    stacks: player.inventory.map((s) => ({ ...s })),
    capacity: player.inventory_capacity,
  };

  const gained = makeDeltaRecorder();
  const consumed = makeDeltaRecorder();
  const lost = makeDeltaRecorder();
  let stopReason: StopReason = StopReason.NoTicks;
  let ticks = 0;
  let expGained = 0;

  const hasInputs = Object.values(action.input_items).some((q) => q > 0);
  const hasOutputs = Object.values(action.output_items).some((q) => q > 0);

  for (; ticks < maxTicks; ticks++) {
    // 该 tick 开始前检查：任一条件不满足 → 记录原因并停
    if (hasInputs && !canConsume(inv, action.input_items)) {
      stopReason = ticks === 0 ? StopReason.NoTicks : StopReason.InputExhausted;
      break;
    }

    // 背包满拆成两档：能全放 → 正常入账；放不下 → 先入能放的，差额记 lost
    if (hasOutputs && !canAdd(inv, action.output_items, stackMaxOf)) {
      if (ticks === 0) {
        stopReason = StopReason.NoTicks;
      } else {
        stopReason = StopReason.InventoryFull;
        const maxAddable = computeAddCapacity(inv, action.output_items, stackMaxOf);
        for (const [itemId, qty] of Object.entries(action.output_items)) {
          const addable = maxAddable.get(itemId) ?? 0;
          if (addable > 0) {
            applyAdd(inv, { [itemId]: addable }, stackMaxOf);
            gained.add(itemId, addable);
          }
          const missing = qty - addable;
          if (missing > 0) lost.add(itemId, missing);
        }
        expGained += action.exp;
      }
      break;
    }

    // 应用该 tick：先扣材料，再算产出
    applyConsume(inv, action.input_items);
    applyAdd(inv, action.output_items, stackMaxOf);
    for (const [itemId, qty] of Object.entries(action.output_items)) {
      gained.add(itemId, qty);
    }
    for (const [itemId, qty] of Object.entries(action.input_items)) {
      consumed.add(itemId, qty);
    }
    expGained += action.exp;
  }

  // 循环自然跑满 maxTicks：停顿原因只能是时长上限或"不足一次"
  if (ticks === maxTicks && stopReason === StopReason.NoTicks) {
    stopReason =
      ticks === 0
        ? StopReason.NoTicks
        : elapsedMs >= OFFLINE_CAP_MS
          ? StopReason.DurationCap
          : // 未触发 24h 上限但仍跑满，等价于"玩家在这段时间内一直在挂"，
            // 报告 stop_reason 仍用 duration_cap，前端统一按"已挂满"展示
            StopReason.DurationCap;
  }

  const nextPlayer: PlayerState = {
    ...player,
    inventory: inv.stacks,
    skill_exp:
      expGained > 0
        ? {
            ...player.skill_exp,
            [action.skill_id]: (player.skill_exp[action.skill_id] ?? 0) + expGained,
          }
        : { ...player.skill_exp },
    // 无论是否跑满 24h，结算后都视为"动作已消费"，玩家需要重新开始
    current_action: null,
  };

  return {
    player: nextPlayer,
    report: {
      effective_seconds: Math.floor(effectiveMs / 1000),
      ticks,
      gained: gained.list(),
      consumed: consumed.list(),
      lost: lost.list(),
      exp_gained: expGained > 0 ? { [action.skill_id]: expGained } : {},
      stop_reason: stopReason,
    },
  };
}

/**
 * 手动停止动作 = settle 的别名（业务语义不同，但引擎处理完全一致）。
 *
 * 单独命名是为了让上层（NestJS controller）的代码读起来是"玩家主动停止"，
 * 而不是"离线结算"。
 */
export const stopAction = settle;
