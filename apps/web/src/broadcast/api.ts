import { apiGet } from '../lib/api.ts';

/**
 * 全服广播 HTTP 客户端（task-17）
 *
 * 服务端约定：
 *   GET /api/broadcasts?limit=N
 *   - 不需要 JWT（广播是全服公共事件流）
 *   - limit 不传/非法时由后端兜底为 20，硬上限 50
 */

export interface BroadcastEntry {
  id: string;
  type: string;
  playerId: string;
  itemId: string;
  quality: 'common' | 'uncommon' | 'rare' | 'epic';
  createdAt: string;
}

export interface BroadcastListResponse {
  broadcasts: BroadcastEntry[];
}

export function fetchRecentBroadcasts(limit = 20): Promise<BroadcastListResponse> {
  return apiGet(`/api/broadcasts?limit=${limit}`);
}
