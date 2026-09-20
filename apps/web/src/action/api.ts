import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api.ts';
import type { ActionQueueItem, SettleReport } from '@lazycraft/shared';

/**
 * 活动 HTTP 客户端（task-08 后端接口的前端封装）
 *
 * 为什么单独抽 api.ts 而不是直接散落在组件里 fetch？
 *   服务器权威规则下所有跟"当前活动"有关的请求都被同一组状态消费，
 *   把请求集中在一处，组件只面对数据形状，不关心路径与鉴权细节。
 */

/** 后端 current_action 字段的形状（与 save-shape.ts ActiveActionData 一致） */
export interface ActiveActionData {
  skill_id: string;
  action_id: string;
  /** 服务器时间戳（毫秒）：动作开始时刻 */
  started_at: number;
}

export interface StartActionResponse {
  current_action: ActiveActionData;
  next_tick_at: number;
}

export interface StopActionResponse {
  report: SettleReport;
  current_action: null;
}

export interface CurrentActionResponse {
  current_action: ActiveActionData | null;
  action_queue?: ActionQueueItem[];
  next_tick_at?: number;
  interval_ms?: number;
}

/**
 * settle-due 响应（逐圈结算）。
 *
 * report 含本次结清的 ticks / gained / consumed / exp_gained / stop_reason；
 * current_action 为 null 表示动作已因材料耗尽/背包满结束；
 * next_tick_at / interval_ms 由后端按新边界一次算好，前端无需再多一次往返。
 * action_queue / queue_reports 为 task-36 队列维度的附带信息。
 */
export interface SettleDueResponse {
  report: SettleReport;
  current_action: ActiveActionData | null;
  action_queue?: ActionQueueItem[];
  queue_reports?: unknown[];
  next_tick_at: number | null;
  interval_ms: number | null;
}

/* ------------------------------------------------------------------ */
/* 动作队列（task-36）                                                */
/* ------------------------------------------------------------------ */

export interface QueueSlots {
  max: number;
  unlocked: number;
}

export interface QueueResponse {
  action_queue: ActionQueueItem[];
  queue_slots: QueueSlots;
  current_action: ActiveActionData | null;
}

export function fetchQueue(token: string): Promise<QueueResponse> {
  return apiGet('/action/queue', token);
}

export function enqueueAction(
  token: string,
  skillId: string,
  actionId: string,
  count: number,
): Promise<QueueResponse> {
  return apiPost('/action/queue', { skillId, actionId, count }, token);
}

export function updateQueueItem(
  token: string,
  index: number,
  patch: { skillId?: string; actionId?: string; count?: number },
): Promise<QueueResponse> {
  return apiPatch(`/action/queue/${index}`, patch, token);
}

export function removeQueueItem(token: string, index: number): Promise<QueueResponse> {
  return apiDelete(`/action/queue/${index}`, token);
}

export function clearActionQueue(token: string): Promise<QueueResponse> {
  return apiDelete('/action/queue', token);
}

export function startAction(token: string, skillId: string, actionId: string): Promise<StartActionResponse> {
  return apiPost('/action/start', { skillId, actionId }, token);
}

export function stopAction(token: string): Promise<StopActionResponse> {
  return apiPost('/action/stop', {}, token);
}

export function fetchCurrentAction(token: string): Promise<CurrentActionResponse> {
  return apiGet('/action/current', token);
}

/** 结清截至现在的所有到期整圈，返回本次产出；action 继续时 current_action 非 null */
export function settleDueAction(token: string): Promise<SettleDueResponse> {
  return apiPost('/action/settle-due', {}, token);
}
