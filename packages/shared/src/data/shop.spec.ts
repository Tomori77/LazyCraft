/**
 * 商店数据自洽性测试（task-24）
 *
 * 商店是"内容即数据"，但它引用的物品/模板是另一张表——配置错配（引用不存在的
 * item_id / template_id）只会在运行时静默失败（发货时找不到物品）。
 * 这里把"引用有效性"固化成单测，让配置错误在 CI 而不是生产暴露。
 */

import { describe, expect, it } from 'vitest';

import { SHOP_ENTRIES, findShopEntryById } from './shop.js';
import { ITEMS } from './resources.js';
import { EQUIPMENT_TEMPLATES } from '../loot/equipment-template.js';
import { ITEM_WOOD } from '../packs/core/index.js';
import type { Quality } from '../types.js';

const QUALITY_VALUES: readonly Quality[] = ['common', 'uncommon', 'rare', 'epic'];

/** 商店可买的物品全集：正式物品表 + CorePack 专有物品（与 Registry 口径一致） */
const KNOWN_ITEM_IDS = new Set<string>([...ITEMS.map((i) => i.id), ITEM_WOOD.id]);

describe('SHOP_ENTRIES 配置自洽', () => {
  it('至少覆盖：可买可卖堆叠物、只买不卖、装备模板、有限库存', () => {
    expect(SHOP_ENTRIES.length).toBeGreaterThanOrEqual(3);
    expect(SHOP_ENTRIES.some((e) => e.kind === 'item' && e.sell_price !== undefined)).toBe(true);
    expect(SHOP_ENTRIES.some((e) => e.sell_price === undefined)).toBe(true);
    expect(SHOP_ENTRIES.some((e) => e.kind === 'equipment')).toBe(true);
    expect(SHOP_ENTRIES.some((e) => e.stock >= 0)).toBe(true);
  });

  it('id 唯一', () => {
    const ids = SHOP_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('kind 决定引用字段：item 引用物品、equipment 引用模板', () => {
    for (const entry of SHOP_ENTRIES) {
      if (entry.kind === 'item') {
        expect(entry.item_id, `[${entry.id}] 缺 item_id`).toBeTruthy();
        expect(KNOWN_ITEM_IDS.has(entry.item_id!), `[${entry.id}] item_id 未注册`).toBe(true);
      } else {
        expect(entry.template_id, `[${entry.id}] 缺 template_id`).toBeTruthy();
        expect(
          EQUIPMENT_TEMPLATES[entry.template_id!],
          `[${entry.id}] template_id 未注册`,
        ).toBeDefined();
      }
    }
  });

  it('价格与库存数值合法', () => {
    for (const entry of SHOP_ENTRIES) {
      expect(Number.isInteger(entry.buy_price) && entry.buy_price >= 0, `[${entry.id}] buy_price`).toBe(
        true,
      );
      expect(entry.stock, `[${entry.id}] stock`).toBeGreaterThanOrEqual(-1);
      if (entry.sell_price !== undefined) {
        expect(
          Number.isInteger(entry.sell_price) && entry.sell_price >= 0,
          `[${entry.id}] sell_price`,
        ).toBe(true);
      }
      if (entry.required_level !== undefined) {
        expect(entry.required_level, `[${entry.id}] required_level`).toBeGreaterThanOrEqual(1);
      }
      if (entry.quality !== undefined) {
        expect(QUALITY_VALUES.includes(entry.quality), `[${entry.id}] quality`).toBe(true);
      }
    }
  });

  it('回收价不高于购买价（否则可无限刷金币）', () => {
    for (const entry of SHOP_ENTRIES) {
      if (entry.sell_price === undefined) continue;
      expect(entry.sell_price, `[${entry.id}] sell_price > buy_price`).toBeLessThanOrEqual(
        entry.buy_price,
      );
    }
  });
});

describe('findShopEntryById', () => {
  it('命中已配置条目', () => {
    expect(findShopEntryById(SHOP_ENTRIES[0].id)).toBe(SHOP_ENTRIES[0]);
  });

  it('未配置返回 undefined', () => {
    expect(findShopEntryById('not_a_real_entry')).toBeUndefined();
  });
});
