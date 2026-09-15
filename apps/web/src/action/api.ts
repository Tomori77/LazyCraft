import { apiGet, apiPost } from '../lib/api.ts';
import type { SettleReport } from '@lazycraft/shared';

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
  next_tick_at?: number;
  interval_ms?: number;
}

export function startAction(token: string, skillId: string, actionId: string): Promise<StartActionResponse> {
  return apiPost('/api/action/start', { skillId, actionId }, token);
}

export function stopAction(token: string): Promise<StopActionResponse> {
  return apiPost('/api/action/stop', {}, token);
}

export function fetchCurrentAction(token: string): Promise<CurrentActionResponse> {
  return apiGet('/api/action/current', token);
}
