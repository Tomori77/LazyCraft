/**
 * 版本迁移脚本：从存档 v1 迁移到 v2
 *
 * v1 → v2 的结构变化：新增 `current_combat` 字段（task-18 战斗系统落地）。
 * v1 是没有战斗概念的老存档，升级时该字段一律置 null（未在战斗中），
 * 由后续战斗接口按需写入。migrated_at 保留"此存档被服务端正写过"的审计痕迹。
 */

import type { SaveData, SaveDataV2 } from '../save-shape.js';

export interface SaveDataV2WithTimestamp extends SaveDataV2 {
  /** 迁移发生时的服务端时间戳（毫秒），用于事后审计与玩家申诉排查 */
  migrated_at: number;
}

/**
 * 把 v1 存档升级为 v2。
 *
 * @param oldData 数据库里读到的存档原文（version=1）
 * @returns 新结构的存档；调用方负责把 saves.version 也写到 2
 */
export function migrate(oldData: SaveData): SaveDataV2WithTimestamp {
  return {
    ...oldData,
    // 为什么直接置 null：v1 存档里没有任何战斗数据，无从推断；
    // null 是"还没开打"的唯一正确解释，战斗接口读取时按"空闲"处理即可
    current_combat: null,
    // 审计时间戳：标记"这份存档在 v2 时被服务端正写过"
    migrated_at: Date.now(),
  };
}