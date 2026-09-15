/**
 * 版本迁移脚本：从存档 v1 迁移到 v2 的示例
 *
 * 为什么需要显式迁移函数而不是"读取时按需打补丁"？
 *   存档写入频繁但是结构版本变化低频；把迁移做成纯函数 migrate()，
 *   保证每次升级都可以在单元测试里精确回放（同一个 oldData 永远产出同一份 newData）。
 *
 * 该示例演示的演化路径：v1 没有 `migrated_at` 字段，v2 给设置面板增加"迁移时间戳"。
 * 实际业务里 v2 可能是"背包从数组改成 {id, qty}[]"这类破坏性变更，
 * 总之必须保证 oldData（来自 DB 的 jsonb）→ newData（新结构 + CURRENT_SAVE_VERSION）是纯函数。
 */

import type { SaveData } from '../save-shape.js';

export interface SaveDataV2 extends SaveData {
  /** 迁移发生时的服务端时间戳（毫秒） */
  migrated_at: number;
}

/**
 * 把 v1 存档升级为 v2。
 *
 * @param oldData 数据库里读到的存档原文（version=1）
 * @returns 新结构的存档；调用方负责把 saves.version 也写到 2
 */
export function migrate(oldData: SaveData): SaveDataV2 {
  return {
    ...oldData,
    // 用显式时间戳标记"这份存档在 v2 时被服务端正写过"，便于事后审计与玩家申诉排查
    migrated_at: Date.now(),
  };
}
