import { apiGet, apiPost } from '../lib/api.ts';
import type { PlayerSettings } from '../settings/settings.ts';

/**
 * 存档 HTTP 客户端
 *
 * 服务端约定（task-03）：一个账号一份当前存档，懒创建；
 * 写入是"整份 data 覆盖 + version 乐观锁"，冲突返回 409。
 */

export interface SavePayload {
  version: number;
  /** 完整存档结构见 api 侧 save-shape.ts；设置模块只关心 settings 字段 */
  data: Record<string, unknown> & { settings?: Record<string, unknown> };
  updatedAt: string;
}

export function readSave(token: string): Promise<SavePayload> {
  return apiGet('/api/save', token);
}

export function writeSave(token: string, version: number, data: SavePayload['data']): Promise<SavePayload> {
  return apiPost('/api/save', { version, data }, token);
}

/**
 * 把玩家设置同步到云端存档的 settings 字段。
 *
 * 为什么不能只 POST { settings }？
 *   服务端写入是整份覆盖而不是按字段合并，只发 settings 会把
 *   skills / inventory 等字段清空。所以必须先拉取完整存档，就地替换
 *   settings，再整体写回。
 *
 * 为什么 409 后无条件重试一次而不是无限重试？
 *   设置属于低频写入；首次冲突几乎总是因为别处的低频写入（或登录刚拉了存档）
 *   刚改过 version。重试一次基于最新存档再写即可覆盖该场景。
 *   若重试仍失败（同一账号两个标签页同时改设置），服从服务器权威直接放弃。
 */
export async function syncSettingsToCloud(token: string, settings: PlayerSettings): Promise<void> {
  // settings 展开为普通对象字面量以满足索引签名约束；字段本身不变
  const settingsJson = { ...settings };
  try {
    const save = await readSave(token);
    await writeSave(token, save.version, { ...save.data, settings: settingsJson });
  } catch {
    const save = await readSave(token);
    await writeSave(token, save.version, { ...save.data, settings: settingsJson });
  }
}
