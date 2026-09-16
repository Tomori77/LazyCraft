/**
 * 食物配置表：可回血的消耗品。
 *
 * 为什么是独立配置而不是给 Item 加 heal 字段？
 *   types.ts 的 Item 是注册表契约，改动会牵连所有 DLC 包与 validate 逻辑；
 *   食物只有战斗中一个消费方，把"吃多少"收在战斗模块旁边，
 *   后续烹饪 DLC 只需要往这张表里加条目，不碰存量类型。
 */

/** 食物配置：item_id 对应背包里的消耗品，heal 为每次食用恢复的生命值 */
export interface FoodDef {
  /** 物品 id（关联 types.ts Item.id） */
  item_id: string;
  /** 单次食用恢复的生命值 */
  heal: number;
}

/**
 * 烤鱼（熟食）：P0 唯一的食物。
 * 恢复量刻意给 5——小鸡单次伤害上限是 1，一口顶 5 次挨打，
 * 让"带食物出门"在新手村就有明确体感。
 */
export const FOOD_GRILLED_FISH: FoodDef = {
  item_id: 'grilled_fish',
  heal: 5,
};

/** 全部食物表：key 即 item_id，战斗中按 inventory 顺序查找 */
export const FOODS: Readonly<Record<string, FoodDef>> = Object.freeze({
  [FOOD_GRILLED_FISH.item_id]: FOOD_GRILLED_FISH,
});

/** 按物品 id 查食物配置；不是食物返回 undefined */
export function findFoodById(itemId: string): FoodDef | undefined {
  return FOODS[itemId];
}
