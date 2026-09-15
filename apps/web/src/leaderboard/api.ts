import { apiGet } from '../lib/api.ts';

/**
 * 排行榜 HTTP 客户端（task-16）
 *
 * 服务端约定：
 *   GET /api/leaderboard/total-level
 *   - 需带 JWT；响应里 me 是"当前登录账号默认角色"的名次
 *   - limit 可选；不传/传 0 = 全量（当前 UI 一次性渲染，暂不分页）
 */

export interface LeaderboardEntry {
  playerId: string;
  totalLevel: number;
  rank: number;
}

export interface TotalLevelResponse {
  entries: LeaderboardEntry[];
  /** 当前玩家名次；视图还没刷新到该玩家时为 null */
  me: LeaderboardEntry | null;
}

export function fetchTotalLevelLeaderboard(token: string, limit = 0): Promise<TotalLevelResponse> {
  const query = limit > 0 ? `?limit=${limit}` : '';
  return apiGet(`/api/leaderboard/total-level${query}`, token);
}
