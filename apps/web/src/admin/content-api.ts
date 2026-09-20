import { apiGet, apiPatch } from '../lib/api.ts';

/**
 * 内容包（DLC）管理接口客户端（task-41）。
 *
 * 与 shop-api / player-api 同处 admin 目录，遵循同一约定：
 * 只声明本页真正调用的契约，不提前留空壳。
 */
export interface AdminPack {
  id: string;
  name: string;
  version: string;
  /** 持久化的启用状态（改了但没重启时，与 active 可能不一致） */
  enabled: boolean;
  /** 当前进程快照里是否真的注册了这个包 */
  active: boolean;
  /** true = 需要重启 API 才能让开关生效 */
  restart_required: boolean;
}

/** 停用影响面（只读统计）：供确认停用前提示 */
export interface PackImpact {
  affected_saves: number;
  affected_actions: string[];
  sampled_items: string[];
}

/** 列出全部已编译 pack + 启用状态（后端 admin only） */
export function fetchPacks(token: string): Promise<AdminPack[]> {
  return apiGet('/admin/content/packs', token);
}

/** 启用 / 停用：后端落库 + 审计，改动重启后生效 */
export function updatePackEnabled(
  token: string,
  id: string,
  enabled: boolean,
): Promise<AdminPack> {
  return apiPatch(`/admin/content/packs/${encodeURIComponent(id)}`, { enabled }, token);
}

/** 停用影响面（只读）：不修改任何玩家数据 */
export function fetchPackImpact(token: string, id: string): Promise<PackImpact> {
  return apiGet(`/admin/content/packs/${encodeURIComponent(id)}/impact`, token);
}
