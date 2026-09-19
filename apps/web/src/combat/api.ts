import { apiGet, apiPost } from '../lib/api.ts';
import type { CombatReport, Enemy } from '@lazycraft/shared';

/**
 * 战斗接口的请求/响应类型
 *
 * 为什么单独抽出来而不是在 panel 里内联？
 *   战斗有三个消费端（开始按钮、中栏面板、结算卡片），
 *   类型集中在 api.ts 与后端 DTO 对齐，改契约时只动这一处。
 */

/** start / current 共用的响应切片 */
export interface CombatStatus {
  /** 当前战斗；null = 空闲 */
  current_combat: { enemy_id: string; started_at: number } | null;
  /** 敌人配置（与 current_combat 联动返回；空闲时不返回） */
  enemy?: Enemy;
  /** 截至"now"的实时战报（空闲时不返回） */
  report?: CombatReport;
}

/** POST /api/combat/start */
export function startCombat(token: string, enemyId: string): Promise<CombatStatus> {
  return apiPost<CombatStatus>('/combat/start', { enemyId }, token);
}

/** POST /api/combat/stop */
export function stopCombat(token: string): Promise<{ report: CombatReport; current_combat: null }> {
  return apiPost<{ report: CombatReport; current_combat: null }>('/combat/stop', {}, token);
}

/** GET /api/combat/current */
export function fetchCurrentCombat(token: string): Promise<CombatStatus> {
  return apiGet<CombatStatus>('/combat/current', token);
}
