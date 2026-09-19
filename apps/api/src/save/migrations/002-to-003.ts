/**
 * 版本迁移脚本：从存档 v2 迁移到 v3
 *
 * v2 → v3 的结构变化（《04 §2.5 / §2.6》）：
 *   1. `inventory` 由 `{item_id,quantity,quality?}[]` 升级为带 uid 的 `CarriedItem[]`
 *      （堆叠物补 `kind:'stack'` + `uid`）；
 *   2. `abstract_resources.combat_equipment_drops`（历史战斗暂存的 `Equipment[]`）
 *      转为 `EquipmentInstance` 并迁入 inventory，随后从抽象资源中移除；
 *   3. 补 `storage: []` 与 `inventory_capacity` / `storage_capacity` 默认值。
 *
 * "不许丢数据"是本迁移的硬性验收：所有能映射的堆叠物与装备都保留，
 * 只有配置错误（模板查不到）的装备才丢弃，且必须不崩。
 */

import {
  DEFAULT_INVENTORY_CAPACITY,
  DEFAULT_STORAGE_CAPACITY,
  type SaveDataV2,
  type SaveDataV3,
} from '../save-shape.js';
import {
  newUid,
  toEquipmentInstance,
  type CarriedItem,
  type Equipment,
  type Quality,
  type StackItemInstance,
} from '@lazycraft/shared';

/** v2 里的背包格形态：v3 之前只有堆叠物，quality 可选 */
interface LegacyInventoryStack {
  item_id: string;
  quantity: number;
  quality?: Quality;
}

/** v3 迁移产物：沿用 001 的审计时间戳风格，标记"此存档在 v3 时被服务端正写过" */
export interface SaveDataV3WithTimestamp extends SaveDataV3 {
  migrated_at: number;
}

/**
 * 旧背包格 → 带 uid 的堆叠实例。
 *
 * 品质处理：旧档若已带 quality 则原样保留，缺失则不写入该字段
 * （读取侧 stackQuality() 统一按 common 兜底）——选"缺省不写"而非"显式写 common"，
 * 是为了让迁移产物与真实采集产出（quality 缺省）保持同形，减少无意义的字段膨胀。
 *
 * 已带 uid / kind 的条目原样保留（防御性：允许迁移产物被重复执行而不换 uid）。
 */
function toStackInstance(
  stack: LegacyInventoryStack | StackItemInstance,
  uidFactory: () => string,
): StackItemInstance {
  const anyStack = stack as Partial<StackItemInstance>;
  if (anyStack.kind === 'stack' && typeof anyStack.uid === 'string') {
    return stack as StackItemInstance;
  }
  const instance: StackItemInstance = {
    kind: 'stack',
    uid: uidFactory(),
    item_id: stack.item_id,
    quantity: stack.quantity,
  };
  if (stack.quality !== undefined) instance.quality = stack.quality;
  return instance;
}

/**
 * 把 v2 存档升级为 v3。
 *
 * @param oldData 数据库里读到的存档原文（version=2）
 * @param uidFactory 可注入的 uid 工厂；测试用它产出确定性 uid
 * @returns 新结构的存档；调用方负责把 saves.version 也写到 3
 */
export function migrate(
  oldData: SaveDataV2 & Partial<SaveDataV3>,
  uidFactory: () => string = newUid,
): SaveDataV3WithTimestamp {
  const rawInventory = Array.isArray(oldData.inventory) ? oldData.inventory : [];
  const inventory: CarriedItem[] = (rawInventory as Array<LegacyInventoryStack | StackItemInstance>).map(
    (stack) => toStackInstance(stack, uidFactory),
  );

  const abstractResources = { ...((oldData.abstract_resources ?? {}) as Record<string, unknown>) };

  // 历史装备掉落：v2 把它们塞在抽象资源里；v3 必须搬进背包（文档 §2.6 口径）。
  const pendingEquipment = abstractResources['combat_equipment_drops'];
  if (Array.isArray(pendingEquipment)) {
    for (const eq of pendingEquipment as Equipment[]) {
      const instance = toEquipmentInstance(eq, uidFactory());
      // 模板缺失 = 配置错误（模板被删/改名）。此处丢弃这一件而不是抛错：
      // 迁移发生在读路径上，任何一件坏数据都不该让整份存档无法读取；
      // 真正的内容一致性由启动期 registry.validate() 负责暴露。
      if (instance) inventory.push(instance);
    }
  }
  // 其余抽象资源（gold / res_* 等）原样保留，只移除已搬迁的键
  delete abstractResources['combat_equipment_drops'];

  return {
    ...oldData,
    inventory,
    abstract_resources: abstractResources,
    // 老档可能没有 storage / 容量字段；已有值则尊重（DLC 扩容后的存档不应被打回默认）
    storage: Array.isArray(oldData.storage) ? oldData.storage : [],
    inventory_capacity:
      typeof oldData.inventory_capacity === 'number'
        ? oldData.inventory_capacity
        : DEFAULT_INVENTORY_CAPACITY,
    storage_capacity:
      typeof oldData.storage_capacity === 'number'
        ? oldData.storage_capacity
        : DEFAULT_STORAGE_CAPACITY,
    migrated_at: Date.now(),
  };
}
