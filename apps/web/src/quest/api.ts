import { apiGet, apiPost } from '../lib/api.ts';

/**
 * 任务 HTTP 客户端
 *
 * 与后端 /api/quests 对齐：返回的 i18n key 由前端用 useT() 查文案，
 * 后端只传结构与进度，不返文案（与活动面板对动作 i18n key 的处理一致）。
 */

export type QuestGoalType = 'collect_item' | 'craft_item' | 'kill_enemy';

export interface QuestReward {
  items: Record<string, number>;
  abstract_resources?: Record<string, number>;
}

export interface QuestView {
  id: string;
  i18n_key: string;
  goal_type: QuestGoalType;
  goal_target: string;
  goal_count: number;
  reward: QuestReward;
  accepted: boolean;
  completed: boolean;
  progress: number;
}

export interface QuestListResponse {
  quests: QuestView[];
}

export interface QuestSingleResponse {
  quest: QuestView;
}

export interface QuestClaimResponse {
  quest: QuestView;
  reward: QuestReward;
}

export function listQuests(token: string): Promise<QuestListResponse> {
  return apiGet('/api/quests', token);
}

export function acceptQuest(token: string, id: string): Promise<QuestSingleResponse> {
  return apiPost(`/api/quests/${encodeURIComponent(id)}/accept`, {}, token);
}

export function fetchQuestProgress(token: string, id: string): Promise<QuestSingleResponse> {
  return apiGet(`/api/quests/${encodeURIComponent(id)}/progress`, token);
}

export function claimQuest(token: string, id: string): Promise<QuestClaimResponse> {
  return apiPost(`/api/quests/${encodeURIComponent(id)}/claim`, {}, token);
}
