/**
 * 存档版本迁移注册中心
 *
 * 为什么用一个集中的 registry 而不是让 SaveService 直接 import 具体迁移脚本？
 *   存档结构会持续增长（v3, v4, ...），让 service 显式知道自己要按顺序跑哪些 migrate()，
 *   而不是散落一地的 `if (version === 1) migrate1to2(data)`；
 *   后续要加 v2→v3 时，只需要在这里追加一条，service 完全不用改。
 */

import { CURRENT_SAVE_VERSION, type SaveData } from '../save-shape.js';
import { migrate as migrate1to2 } from './001-to-002.js';
import { migrate as migrate2to3 } from './002-to-003.js';

/** 单个迁移步骤的统一签名 */
export type SaveMigration = (oldData: SaveData) => SaveData;

/**
 * 按版本号排序的迁移链条：migrations[i] 负责把 version=i+1 升级为 version=i+2
 *
 * 当前链：[v1 -> v2, v2 -> v3]
 */
const MIGRATIONS: ReadonlyArray<SaveMigration> = [
  migrate1to2 as unknown as SaveMigration,
  migrate2to3 as unknown as SaveMigration,
];

/**
 * 把任意旧版本存档迁移到 CURRENT_SAVE_VERSION。
 *
 * 服务器权威原则：版本号低于当前版本的存档必须立即迁移（即使客户端还在用旧字段），
 * 高于当前版本的存档视为异常——说明客户端拿着比服务端更新的存档来覆盖，直接拒绝。
 *
 * @param oldVersion 数据库读出的 version
 * @param oldData    数据库读出的 data
 * @returns 迁移完成后的新 data（此时 version 已等于 CURRENT_SAVE_VERSION）
 */
export function migrateSave(oldVersion: number, oldData: SaveData): SaveData {
  if (oldVersion > CURRENT_SAVE_VERSION) {
    // 服务端权威：版本超前说明数据可能被篡改或客户端绕过校验，必须拒绝而不是默默吞掉
    throw new Error(
      `存档版本（v${oldVersion}）高于服务端支持的 v${CURRENT_SAVE_VERSION}，拒绝迁移`,
    );
  }

  let data = oldData;
  for (let v = oldVersion; v < CURRENT_SAVE_VERSION; v += 1) {
    const migrate = MIGRATIONS[v - 1];
    if (!migrate) {
      throw new Error(`缺少 v${v} -> v${v + 1} 的迁移脚本，无法完成升级`);
    }
    data = migrate(data);
  }
  return data;
}
