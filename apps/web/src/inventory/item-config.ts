import { ITEMS, ABSTRACT_RESOURCES } from '@lazycraft/shared';
import type { Item, AbstractResource } from '@lazycraft/shared';

/**
 * 物品配置查找（本地查表，不走 API）
 *
 * 为什么不查后端？
 *   物品配置（名称/图标/堆叠上限）在 packages/shared 的 resources.ts 里，
 *   是编译期就确定的静态数据。每次渲染网格都从后端拉一遍太浪费，
 *   直接 import 静态表，配合 Map 缓存查询结果。
 */

/* 物品 id → Item 配置 */
const ITEM_MAP = new Map<string, Item>(ITEMS.map((i) => [i.id, i]));

/* 抽象资源 id → AbstractResource 配置 */
const ABSTRACT_MAP = new Map<string, AbstractResource>(
  ABSTRACT_RESOURCES.map((r) => [r.id, r]),
);

export function getItemConfig(itemId: string): Item | undefined {
  return ITEM_MAP.get(itemId);
}

export function getAbstractResourceConfig(resourceId: string): AbstractResource | undefined {
  return ABSTRACT_MAP.get(resourceId);
}

/** 背包面板顶部分类标签的取值范围 */
export type ItemCategory = 'all' | 'material' | 'consumable' | 'equipment';

/** 判断物品是否属于某个分类标签 */
export function itemMatchesCategory(item: Item, category: ItemCategory): boolean {
  if (category === 'all') return true;
  return item.type === category;
}
