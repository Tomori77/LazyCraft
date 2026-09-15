/**
 * 掉落表（《框架设计》6.1 的 loot_tables 数据表）。
 *
 * 掉落表挂在怪物身上（Enemy.loot_table_id），描述"杀这只怪能掉什么"。
 *
 * 为什么 loot_tables 走 TS 常量而不是 DB？
 *   《框架设计》§4.2 内容即数据：掉落表是内容（DLC 要频繁新增），
 *   不是运行时状态；P0 骨架先让内容通路自洽，DB 镜像由后续迁移任务接管。
 *
 * 为什么 quality_weights 在表上而不是在词条上？
 *   装备类词条先抽品质、再按品质生成装备；材料/资源词条通常没有品质维度。
 *   品质权重天然属于"这只怪的整体稀有度倾向"，所以提到表级。
 *
 * 为什么每条词条带 rolls 而不是统一 1 次？
 *   鸡掉 1~2 根羽毛是玩法体验，写进词条比写死"每次掉落都抽一遍"更直观。
 */

import type { AffixPool } from './affix-pool.js';
import type { EquipmentTemplate } from './equipment-template.js';
import { generateEquipment, type Equipment } from './generate-equipment.js';
import { rollQuality, type QualityWeights } from './quality.js';

/* ------------------------------------------------------------------ */
/* 类型                                                                  */
/* ------------------------------------------------------------------ */

/** 掉落词条：一次 roll 可能命中的单个目标 */
export type LootDrop =
  | {
      /** 直接掉物品（材料/消耗品），不参与品质/词缀生成 */
      kind: 'item';
      /** 物品 id（关联 types.ts Item.id，注册表校验时按此查） */
      item_id: string;
      /** 相对权重 */
      weight: number;
      /** 命中后抽取的数量区间 [min, max] 闭区间 */
      min: number;
      max: number;
    }
  | {
      /** 掉装备：先抽品质、再按词缀池抽词缀 */
      kind: 'equipment';
      /** 装备模板 id（关联 EquipmentTemplate.id） */
      template_id: EquipmentTemplate['id'];
      /** 相对权重 */
      weight: number;
      /**
       * 词缀池 id 列表（按表内顺序尝试），引擎从中挑第一个可用的池抽词缀；
       * 池子本身是独立配置，掉落表只挂"用哪个池"。
       */
      affix_pool_ids: ReadonlyArray<AffixPool['id']>;
      /**
       * 掉装备时覆盖表级 quality_weights（比如"鸡稀有掉落"只允许掉蓝紫）。
       * 不传则用表级品质权重。
       */
      quality_weights?: QualityWeights;
    };

/** 掉落表 */
export interface LootTable {
  id: string;
  /**
   * 怪物 id：与 Enemy.id 对应。设计上是一张表绑一只怪，
   * 但允许 Enemy.loot_table_id 留空（P0 阶段的鸡就没填）——
   * 这里用字段标出归属，方便 DLC 作者一眼看出"这表是谁的"。
   */
  monster_id: string;
  /**
   * 表级品质权重：装备词条在没有自己覆盖时一律走这里。
   * 权重只是相对值，rollQuality 内部做归一化。
   */
  quality_weights: QualityWeights;
  /** 掉落词条列表（引擎一次 roll 只命中一条） */
  drops: ReadonlyArray<LootDrop>;
}

/* ------------------------------------------------------------------ */
/* 示例掉落表：鸡（呼应 packs/core 的 ENEMY_CHICKEN）                     */
/* ------------------------------------------------------------------ */

/**
 * 鸡的掉落表：杀一只鸡可掉"羽毛"或"破旧的皮甲"。
 *
 * 数值刻意保守——P0 的鸡是 1 级怪，只负责打通"怪物 → 掉落"通路，
 * 平衡性留到具体战斗 DLC 再调。
 */
export const LOOT_TABLE_CHICKEN: LootTable = {
  id: 'loot_chicken',
  monster_id: 'chicken',
  /* 白 70 / 蓝 20 / 紫 8 / 橙 2：新手村基调，让玩家先认识"颜色递进" */
  quality_weights: { common: 70, uncommon: 20, rare: 8, epic: 2 },
  drops: [
    {
      kind: 'item',
      item_id: 'feather',
      weight: 80,
      min: 1,
      max: 2,
    },
    {
      kind: 'equipment',
      template_id: 'worn_leather_armor',
      weight: 15,
      affix_pool_ids: ['starter'],
    },
    {
      kind: 'equipment',
      template_id: 'short_sword',
      weight: 5,
      affix_pool_ids: ['starter'],
      /* 短剑是鸡的"稀有掉落"——锁蓝起步，保证不会掉白色 */
      quality_weights: { uncommon: 20, rare: 8, epic: 2 },
    },
  ],
};

export const LOOT_TABLES: Readonly<Record<string, LootTable>> = Object.freeze({
  [LOOT_TABLE_CHICKEN.id]: LOOT_TABLE_CHICKEN,
});

/** 按怪物 id 查掉落表；找不到返回 undefined（引擎据此跳过掉落） */
export function findLootTableByMonster(monsterId: string): LootTable | undefined {
  return Object.values(LOOT_TABLES).find((t) => t.monster_id === monsterId);
}

/** 按表 id 查；找不到返回 undefined */
export function findLootTableById(id: string): LootTable | undefined {
  return LOOT_TABLES[id];
}

/* ------------------------------------------------------------------ */
/* 掉落结果类型（rollLoot 的返回形态）                                     */
/* ------------------------------------------------------------------ */

/** 一次掉落结果：可能是材料堆叠，也可能是一件已生成词缀的装备 */
export type LootResult =
  | {
      kind: 'item';
      item_id: string;
      quantity: number;
    }
  | {
      kind: 'equipment';
      /** 生成好的装备实例（见 generate-equipment.ts） */
      equipment: Equipment;
    };

/** rollLoot 入参：rng 由调用方传入，保证可测 / 可回放 */
export interface RollLootInput {
  table: LootTable;
  /** 0~1 均匀随机数 */
  rng: () => number;
}

/**
 * 主掉落入口：对一张表做一次完整掉落判定。
 *
 * 流程：
 *   1. 按 drops 权重选一条目标词条；
 *   2. 如果是 item，按 [min, max] 抽数量并返回；
 *   3. 如果是 equipment，先按（词条覆盖或表级）quality_weights 抽品质，
 *      再按词条挂的词缀池抽词缀，调用 generateEquipment 生成实例；
 *   4. 装备生成失败（比如品质低于模板最低允许）时本掉落视为"空掉"，
 *      返回 undefined —— 让上层按"没掉东西"处理而不是硬塞一件非法装备。
 *
 * 为什么装备失败要回退空掉而不是抛错？
 *   策划配错表（比如模板区间与词条品质权重冲突）属于"配置态"问题，
 *   玩家战斗时撞见只影响一次掉落，不应该毁掉整场战斗结算；记录日志兜底即可。
 *   真正的配置错误应该在启动时由 validate 阶段拦截（task-15 接管）。
 */
export function rollLoot(input: RollLootInput): LootResult | undefined {
  const { table, rng } = input;

  /* 1. 选词条 */
  const totalWeight = table.drops.reduce((sum, d) => sum + Math.max(0, d.weight), 0);
  if (totalWeight <= 0 || table.drops.length === 0) return undefined;
  let cursor = rng() * totalWeight;
  let chosen: LootDrop = table.drops[table.drops.length - 1];
  for (const d of table.drops) {
    cursor -= Math.max(0, d.weight);
    if (cursor < 0) {
      chosen = d;
      break;
    }
  }

  /* 2. 按词条类型分发 */
  if (chosen.kind === 'item') {
    const min = Math.max(1, chosen.min);
    const max = Math.max(min, chosen.max);
    const quantity = min + Math.floor(rng() * (max - min + 1));
    return { kind: 'item', item_id: chosen.item_id, quantity };
  }

  /* equipment：需要先生成品质，再生成装备 */
  const weights = chosen.quality_weights ?? table.quality_weights;
  const quality = rollQuality(weights, rng);
  const equipment = generateEquipment({
    template_id: chosen.template_id,
    quality,
    affix_pool_ids: chosen.affix_pool_ids,
    rng,
  });
  if (!equipment) return undefined;
  return { kind: 'equipment', equipment };
}
