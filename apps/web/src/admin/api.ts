import { apiGet } from '../lib/api.ts';

/**
 * 管理后台接口客户端（task-38）。
 *
 * 为什么先只定义审计？
 *   「商店 / 玩家 / 内容」三个页签由 task-39/40/41 填充，各自的请求函数届时
 *   放在本文件同一处；现在只声明本任务真正调用的审计契约，避免留空壳函数。
 */
export interface AdminAuditLog {
  id: string;
  admin_account_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  detail: unknown;
  created_at: number;
}

export interface AdminAuditPage {
  items: AdminAuditLog[];
  page: number;
  limit: number;
  total: number;
}

/** 审计列表：分页 + 可选按目标/动作过滤（后端 admin only，非 admin 会 403） */
export function fetchAuditLogs(
  token: string,
  params: { page?: number; limit?: number; targetType?: string; targetId?: string } = {},
): Promise<AdminAuditPage> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.targetType) query.set('target_type', params.targetType);
  if (params.targetId) query.set('target_id', params.targetId);
  const suffix = query.toString();
  return apiGet(`/admin/audit-logs${suffix ? `?${suffix}` : ''}`, token);
}
