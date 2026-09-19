/**
 * 商店数据表（内容即数据）
 *
 * 商店是"系统 NPC 出货 / 回收"的固定价目表，与玩家市场（/api/market）完全区分：
 * 前者价格由策划写死、可无限或有限供货；后者是玩家间挂单撮合。
 *
 * 运行时机说明（task-24b 起）：
 *   商店条目已全部入库（`shop_entries` 表），库存为全服共享、买入真实扣减；
 *   本文件的 `SHOP_ENTRIES` **仅作为初始 seed 来源**保留，运行时不再被读写，
 *   权威数据在 DB。`ShopEntry` 类型继续作为 seed 与接口共用的"条目形状"。
 *   迁移文件 20260918000000_add_role_and_shop_entries 内的 INSERT 与此处逐字段一致。
 *
 * 为什么商店不纳入 Registry（不扩 ContentKind）？
 *   ContentKind 服务的是"引擎结算时必须认识"的实体（物品/技能/动作/槽位）；
 *   ShopEntry 只是交易配置，引擎不消费它。为一个纯配置再扩一个内容类别，
 *   会让 registry.validate() 的职责边界变模糊。这里直接从常量表读即可，
 *   数据形状与将来是否迁 DB / 接 DLC 无关。
 *
 * 铁律：商店只做"金币 ↔ 物品"的兑换，抽象资源与物品资源不得互相折算。
 */

import type { Quality } from '../types.js';

/** 单条商店条目：一条 = 一种可买/可卖的货物 */
export interface ShopEntry {
  id: string;
  /** 卖什么：物品或装备模板 */
  kind: 'item' | 'equipment';
  /** kind='item' 时必填：关联 Item.id */
  item_id?: string;
  /** kind='equipment' 时必填：关联 EquipmentTemplate.id */
  template_id?: string;
  /** kind='equipment' 时的出货品质；缺省 common */
  quality?: Quality;
  /** 购买单价（金币） */
  buy_price: number;
  /** 出售回收单价；不填 = 不可出售 */
  sell_price?: number;
  /** 解锁所需玩家等级（可选）。口径与装备门槛一致：攻击技能等级 */
  required_level?: number;
  /** 库存 -1 = 无限；正数为当前剩余（P0 不持久化，仅作静态展示上限） */
  stock: number;
}

/* ------------------------------------------------------------------ */
/* 示例条目（覆盖：可买可卖堆叠物 / 只买不卖 / 装备模板 / 有限库存 / 等级门槛） */
/* ------------------------------------------------------------------ */

/** 木头：可买可卖的基础材料，让玩家能把采集余量换金币 */
export const SHOP_ENTRY_WOOD: ShopEntry = {
  id: 'shop_wood',
  kind: 'item',
  item_id: 'wood',
  buy_price: 4,
  sell_price: 1,
  stock: -1,
};

/** 铜矿石：采矿基础产出，回收价略高以鼓励出货 */
export const SHOP_ENTRY_COPPER_ORE: ShopEntry = {
  id: 'shop_copper_ore',
  kind: 'item',
  item_id: 'copper_ore',
  buy_price: 10,
  sell_price: 3,
  stock: -1,
};

/** 铁矿石：只买不卖（无 sell_price）且库存有限，演示"回收站不收"与缺货 */
export const SHOP_ENTRY_IRON_ORE: ShopEntry = {
  id: 'shop_iron_ore',
  kind: 'item',
  item_id: 'iron_ore',
  buy_price: 30,
  stock: 25,
};

/** 短剑：基础武器，出货无词缀，需 5 级攻击才能购买 */
export const SHOP_ENTRY_SHORT_SWORD: ShopEntry = {
  id: 'shop_short_sword',
  kind: 'equipment',
  template_id: 'short_sword',
  quality: 'common',
  buy_price: 100,
  sell_price: 35,
  required_level: 5,
  stock: -1,
};

/** 破旧的皮甲：基础防具，可买可卖 */
export const SHOP_ENTRY_LEATHER_ARMOR: ShopEntry = {
  id: 'shop_leather_armor',
  kind: 'equipment',
  template_id: 'worn_leather_armor',
  quality: 'common',
  buy_price: 80,
  sell_price: 25,
  stock: -1,
};

export const SHOP_ENTRIES: readonly ShopEntry[] = [
  SHOP_ENTRY_WOOD,
  SHOP_ENTRY_COPPER_ORE,
  SHOP_ENTRY_IRON_ORE,
  SHOP_ENTRY_SHORT_SWORD,
  SHOP_ENTRY_LEATHER_ARMOR,
];

/** 按 id 查条目；找不到返回 undefined（调用方转 404） */
export function findShopEntryById(id: string): ShopEntry | undefined {
  return SHOP_ENTRIES.find((entry) => entry.id === id);
}
