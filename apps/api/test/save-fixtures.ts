/**
 * e2e 存档构造辅助：v3 起 inventory 是 CarriedItem[]，逐文件手写堆叠实例
 * 既啰嗦又容易漏 kind/uid。这里集中提供确定性 uid 的堆叠工厂与空档构造，
 * 让各 e2e 只需描述"有什么物品"，不必关心实例形状。
 */

import { createEmptySaveData, type SaveDataV3 } from '../src/save/save-shape.js';
import type { Quality, StackItemInstance } from '@lazycraft/shared';

let seq = 0;

/** 造一个带确定性 uid 的堆叠实例；quality 缺省不写（与真实采集产出一致） */
export function stack(item_id: string, quantity: number, quality?: Quality): StackItemInstance {
  seq += 1;
  return {
    kind: 'stack',
    uid: `test-uid-${seq}`,
    item_id,
    quantity,
    ...(quality !== undefined ? { quality } : {}),
  };
}

/** v3 空档 + 覆写字段；避免每个 e2e 各写一份 base 结构 */
export function v3Data(overrides: Partial<SaveDataV3> & Record<string, unknown> = {}): SaveDataV3 {
  return { ...createEmptySaveData(), ...overrides };
}
