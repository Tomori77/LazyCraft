import { apiGet, apiPatch, apiPost } from '../lib/api.ts';
import type { CarriedItem, EquipmentInstance, PlayerAttributes } from '@lazycraft/shared';

/**
 * 玩家管理接口客户端（task-40）。
 *
 * 为什么单独一个文件而不是沿用 admin/api.ts / shop-api.ts？
 *   与 task-39 的选择一致：每个管理页的契约各自闭包在一个文件里，
 *   只有 admin-panel.tsx 需要最小接线，避免并行开发时互相覆盖。
 *
 * 契约对应 apps/api/src/admin/admin-player.{controller,service}.ts：
 *   GET    /admin/players?query=&page=&limit=   → 分页列表（含摘要）
 *   GET    /admin/players/:id                   → 账号 + 角色 + 只读存档快照
 *   PATCH  /admin/players/:id/role              → { role }
 *   PATCH  /admin/players/:id/ban               → { banned }
 *   POST   /admin/players/:id/grant-items       → { items?, equipments? }
 *   POST   /admin/players/:id/grant-resources   → { resources }
 *   POST   /admin/players/:id/reset-state       → { what }
 *
 * 服务端非 2xx 的 message（引用未注册 / 容量不足 / 资源非法）由 lib/api.ts 抛成 Error，
 * 管理页只需展示 Error.message——校验的权威始终在后端，前端不重做规则。
 */

/** 列表摘要：与后端 PlayerSummary 一一对应 */
export interface AdminPlayerSummary {
  level: number;
  abstract_resources: Record<string, number>;
  inventory_used: number;
  inventory_capacity: number;
  storage_used: number;
  storage_capacity: number;
}

export interface AdminPlayerListItem {
  id: string;
  account_id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  created_at: number;
  summary: AdminPlayerSummary;
}

export interface AdminPlayerPage {
  items: AdminPlayerListItem[];
  page: number;
  limit: number;
  total: number;
}

/** 玩家详情里的只读快照：后端复用 buildPlayerData，字段与 /api/player 同构（去掉自身 role） */
export interface AdminPlayerSnapshot {
  name: string;
  level: number;
  attributes: PlayerAttributes;
  skills: Record<string, { exp: number; level: number }>;
  abstract_resources: Record<string, number>;
  equipment: Record<string, EquipmentInstance | null>;
  inventory: CarriedItem[];
  storage: CarriedItem[];
  carry: {
    inventory_used: number;
    inventory_capacity: number;
    storage_used: number;
    storage_capacity: number;
  };
}

export interface AdminPlayerDetail {
  id: string;
  account_id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  created_at: number;
  snapshot: AdminPlayerSnapshot;
}

export interface GrantItemEntry {
  item_id: string;
  quantity: number;
}

export interface GrantEquipmentEntry {
  template_id: string;
  quality?: string;
}

export interface GrantItemsInput {
  items?: GrantItemEntry[];
  equipments?: GrantEquipmentEntry[];
}

export function fetchPlayers(
  token: string,
  params: { query?: string; page?: number; limit?: number } = {},
): Promise<AdminPlayerPage> {
  const search = new URLSearchParams();
  if (params.query) search.set('query', params.query);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const suffix = search.toString();
  return apiGet(`/admin/players${suffix ? `?${suffix}` : ''}`, token);
}

export function fetchPlayerDetail(token: string, playerId: string): Promise<AdminPlayerDetail> {
  return apiGet(`/admin/players/${encodeURIComponent(playerId)}`, token);
}

export function updatePlayerRole(
  token: string,
  playerId: string,
  role: 'player' | 'admin',
): Promise<{ id: string; role: string; changed: boolean }> {
  return apiPatch(`/admin/players/${encodeURIComponent(playerId)}/role`, { role }, token);
}

export function updatePlayerBan(
  token: string,
  playerId: string,
  banned: boolean,
): Promise<{ id: string; banned: boolean; changed: boolean }> {
  return apiPatch(`/admin/players/${encodeURIComponent(playerId)}/ban`, { banned }, token);
}

export function grantItems(
  token: string,
  playerId: string,
  input: GrantItemsInput,
): Promise<unknown> {
  return apiPost(`/admin/players/${encodeURIComponent(playerId)}/grant-items`, input, token);
}

export function grantResources(
  token: string,
  playerId: string,
  resources: Record<string, number>,
): Promise<unknown> {
  return apiPost(`/admin/players/${encodeURIComponent(playerId)}/grant-resources`, { resources }, token);
}

export function resetPlayerState(
  token: string,
  playerId: string,
  what: 'action' | 'combat' | 'all',
): Promise<unknown> {
  return apiPost(`/admin/players/${encodeURIComponent(playerId)}/reset-state`, { what }, token);
}
