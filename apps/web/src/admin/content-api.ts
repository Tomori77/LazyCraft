import { apiGet, apiPatch, apiPost } from '../lib/api.ts';

/**
 * 内容包（DLC）管理接口客户端（task-41 / task-42）。
 *
 * 与 shop-api / player-api 同处 admin 目录，遵循同一约定：
 * 只声明本页真正调用的契约，不提前留空壳。
 */
export interface AdminPack {
  id: string;
  name: string;
  version: string;
  /** true = 来自外部 DLC（挂载目录），false = 内置包 */
  external: boolean;
  /** 持久化的启用状态（改了但未应用重载时，与 active 可能不一致） */
  enabled: boolean;
  /** 当前进程快照里是否真的注册了这个包 */
  active: boolean;
  /** true = 落盘值 ≠ 当前生效值，需点「应用重载」 */
  restart_required: boolean;
}

/** 停用影响面（只读统计）：供确认停用前提示 */
export interface PackImpact {
  affected_saves: number;
  affected_actions: string[];
  sampled_items: string[];
}

/** 外部 DLC 加载失败的一条记录（task-43） */
export interface DlcLoadError {
  dir: string;
  stage: 'scan' | 'manifest' | 'import' | 'shape' | 'conflict';
  message: string;
}

/** 加载失败列表（含当前扫描目录） */
export interface DlcErrorReport {
  dir: string;
  errors: DlcLoadError[];
}

/** 重载结果：重载后启用集合 + 校验错误数 + 中断统计 + DLC 加载失败 */
export interface ContentReloadResult {
  /** 重载后实际生效的 pack id 集合 */
  enabled_packs: string[];
  /** 重载前实际生效的 pack id 集合 */
  previous_packs: string[];
  /** 重载时的 validate() 错误数（>0 也照样重载成功） */
  validate_errors: number;
  /** 重扫挂载目录时加载失败的 DLC 数（task-43） */
  load_errors: number;
  /** 加载失败明细（目录 + 阶段 + 可诊断信息） */
  load_error_details: DlcLoadError[];
  /** 被中断的存档数（引用了已停用 pack 的动作） */
  affected_players: number;
  /** 被中断的动作 id 列表 */
  interrupted_actions: string[];
  /** 重载后的 pack 列表，省一次额外拉取 */
  packs: AdminPack[];
}

/** 列出全部已编译 pack + 启用状态（后端 admin only） */
export function fetchPacks(token: string): Promise<AdminPack[]> {
  return apiGet('/admin/content/packs', token);
}

/** 启用 / 停用：后端落库 + 审计，需点「应用重载」才生效 */
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

/** 应用重载：按最新启用开关重建服务端内存快照 + 重扫挂载目录 + 中断引用停用内容的动作 */
export function reloadPacks(token: string): Promise<ContentReloadResult> {
  return apiPost('/admin/content/reload', {}, token);
}

/** 加载失败的外部 DLC 列表（只读；加载器不提供任何上传/编辑 DLC 的写接口） */
export function fetchDlcErrors(token: string): Promise<DlcErrorReport> {
  return apiGet('/admin/content/dlc-errors', token);
}
