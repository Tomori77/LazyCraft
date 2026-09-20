/**
 * 版本迁移脚本：从存档 v3 迁移到 v4
 *
 * v3 → v4 的结构变化：新增 `action_queue` 字段（task-36 动作队列落地）。
 * v3 没有队列概念，升级时一律置空数组（无待办）；玩家入队后由队列接口写入。
 *
 * "不许丢数据"是本迁移的硬性验收：只用展开原样保留 v3 的全部字段，
 * 不删除 / 不改写任何既有值。
 */

import type { ActionQueueItem } from '@lazycraft/shared';
import type { SaveDataV3, SaveDataV4 } from '../save-shape.js';

/** 迁移产物：沿用 001/002 的审计时间戳风格 */
export interface SaveDataV4WithTimestamp extends SaveDataV4 {
  /** 迁移发生时的服务端时间戳（毫秒），用于事后审计与玩家申诉排查 */
  migrated_at: number;
}

/**
 * 把 v3 存档升级为 v4。
 *
 * @param oldData 数据库里读到的存档原文（version=3）
 * @returns 新结构的存档；调用方负责把 saves.version 也写到 4
 */
export function migrate(oldData: SaveDataV3 & Partial<SaveDataV4>): SaveDataV4WithTimestamp {
  // 已有 action_queue（迁移产物被重复执行 / 未来 DLC 预写）则原样尊重，避免二次迁移清空队列
  const action_queue: ActionQueueItem[] = Array.isArray(oldData.action_queue)
    ? oldData.action_queue
    : [];

  return {
    ...oldData,
    action_queue,
    // 审计时间戳：标记"这份存档在 v4 时被服务端正写过"
    migrated_at: Date.now(),
  };
}
