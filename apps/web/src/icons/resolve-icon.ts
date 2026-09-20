import type { SkillAction } from '@lazycraft/shared';

/**
 * 内容 id → 手绘图标名的解析。
 *
 * 为什么需要别名表而不是直接 `item.<id>` / `resource.<icon>`？
 *   图标目录按"概念"命名（`item.ore` / `item.log`），而内容数据用业务 id
 *   （`copper_ore` / `raw_stone`）与短键（资源 `icon: 'wood'`）；
 *   两者不是同名派生关系。别名表是展示层映射，不改内容数据；
 *   未收录的 id 回退 `item.<id>`，缺图时由 Icon 组件退回首字母，不产生断图。
 */
const ITEM_ALIAS: Readonly<Record<string, string>> = {
  ore: 'item.ore',
  copper_ore: 'item.ore',
  iron_ore: 'item.ore',
  tiny_copper_vein: 'item.ore',
  log: 'item.log',
  wood: 'item.log',
  maple_log: 'item.log',
  stone: 'item.stone',
  raw_stone: 'item.stone',
  ingot: 'item.ingot',
  iron_ingot: 'item.ingot',
  iron_ingot_item: 'item.ingot',
  charcoal: 'item.charcoal',
  feather: 'item.feather',
  plank: 'item.plank',
  coin: 'item.coin',
  gold: 'item.coin',
  gem: 'item.gem',
};

/** 装备模板 → 槽位图标（装备实例也带 slot，此表用于只有 template_id 的商店条目） */
const TEMPLATE_ALIAS: Readonly<Record<string, string>> = {
  short_sword: 'slot.main_hand',
  worn_leather_armor: 'slot.chest',
};

/**
 * 槽位 id → 图标名。目录里头部/颈部叫 helmet / necklace，
 * 与槽位 id head / neck 不同名，需显式映射；其余同名的按 `slot.<id>` 派生。
 */
const SLOT_ALIAS: Readonly<Record<string, string>> = {
  head: 'slot.helmet',
  neck: 'slot.necklace',
};

export function skillIconName(skillId: string): string {
  return `skill.${skillId}`;
}

export function slotIconName(slotId: string): string {
  return SLOT_ALIAS[slotId] ?? `slot.${slotId}`;
}

export function itemIconName(itemId: string): string {
  return ITEM_ALIAS[itemId] ?? `item.${itemId}`;
}

export function resourceIconName(icon: string | undefined, id: string): string {
  return ITEM_ALIAS[icon ?? ''] ?? `item.${icon ?? id}`;
}

export function templateIconName(templateId: string): string {
  return TEMPLATE_ALIAS[templateId] ?? `item.${templateId}`;
}

/** 工作卡片图标：优先首个产出物，其次首个消耗物，最后回退所属技能 */
export function actionIconName(action: SkillAction): string {
  const output = Object.keys(action.output_items)[0];
  if (output) return itemIconName(output);
  const input = Object.keys(action.input_items)[0];
  if (input) return itemIconName(input);
  return skillIconName(action.skill_id);
}
