/**
 * 资源数据表（示例量）
 *
 * 为什么分成两类？
 *   《框架设计》4.3 铁律：抽象资源是账号绑定的"数值"，物品资源是占仓库格子、
 *   可挂市场的"实体"。两者不可直接折算——防止 1000 铜矿石一键变铁锭，
 *   跳过锻造环节，破坏技能存在感。
 *
 * 为什么只是 TS 常量？
 *   内容即数据：代码不识别具体业务，将来整张表迁 DB 时引擎零改动。
 */

import type { AbstractResource, Item } from '../types.js';

/* ------------------------------------------------------------------ */
/* 抽象资源（账号绑定，不占背包）                                          */
/* ------------------------------------------------------------------ */

/** 金币：与市场 GOLD_KEY='gold' 对齐登记，消灭"存档键名靠口头约定"的隐含契约 */
export const RES_GOLD: AbstractResource = {
  id: 'gold',
  name: '金币',
  tier: 1,
  icon: 'gold',
};

export const RES_WOOD: AbstractResource = {
  id: 'res_wood',
  name: '木材',
  tier: 1,
  icon: 'wood',
};

export const RES_STONE: AbstractResource = {
  id: 'res_stone',
  name: '石材',
  tier: 1,
  icon: 'stone',
};

export const RES_IRON_INGOT: AbstractResource = {
  id: 'res_iron_ingot',
  name: '铁锭',
  tier: 2,
  icon: 'iron_ingot',
};

export const ABSTRACT_RESOURCES: readonly AbstractResource[] = [
  RES_GOLD,
  RES_WOOD,
  RES_STONE,
  RES_IRON_INGOT,
];

/* ------------------------------------------------------------------ */
/* 物品资源（占仓库，可交易）                                              */
/* ------------------------------------------------------------------ */

export const ITEM_COPPER_ORE: Item = {
  id: 'copper_ore',
  name: '铜矿石',
  type: 'material',
  tier: 1,
  stack_max: 999,
  tradeable: true,
  quality: ['common'],
  source_skill: 'mining',
  use_tags: ['craft_material', 'sellable'],
  rarity: 'normal',
  broadcast_threshold: 'epic',
};

export const ITEM_IRON_ORE: Item = {
  id: 'iron_ore',
  name: '铁矿石',
  type: 'material',
  tier: 2,
  stack_max: 999,
  tradeable: true,
  quality: ['common'],
  source_skill: 'mining',
  use_tags: ['craft_material', 'sellable'],
  rarity: 'normal',
  broadcast_threshold: 'epic',
};

export const ITEM_MAPLE_LOG: Item = {
  id: 'maple_log',
  name: '枫树原木',
  type: 'material',
  tier: 1,
  stack_max: 999,
  tradeable: true,
  quality: ['common'],
  source_skill: 'woodcutting',
  use_tags: ['craft_material', 'fuel'],
  rarity: 'normal',
  broadcast_threshold: 'epic',
};

export const ITEM_RAW_STONE: Item = {
  id: 'raw_stone',
  name: '原石',
  type: 'material',
  tier: 1,
  stack_max: 999,
  tradeable: true,
  quality: ['common'],
  source_skill: 'mining',
  use_tags: ['craft_material', 'sellable'],
  rarity: 'normal',
  broadcast_threshold: 'epic',
};

/** 半成品：采集和成品之间的过渡，迫使玩家走制作链 */
export const ITEM_IRON_INGOT: Item = {
  id: 'iron_ingot_item',
  name: '铁锭',
  type: 'intermediate',
  tier: 2,
  stack_max: 999,
  tradeable: true,
  quality: ['common'],
  use_tags: ['craft_material'],
  rarity: 'normal',
  broadcast_threshold: 'epic',
};

export const ITEMS: readonly Item[] = [
  ITEM_COPPER_ORE,
  ITEM_IRON_ORE,
  ITEM_MAPLE_LOG,
  ITEM_RAW_STONE,
  ITEM_IRON_INGOT,
];
