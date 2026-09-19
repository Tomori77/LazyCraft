-- task-24b：账号角色 + 商店条目入库（库存全服共享 + 后台管理 API）
--
-- 为什么账号角色放在 accounts 而不是 players？
--   权限属于"登录主体"而不是"游戏角色"；一个账号即便有多个存档槽位，
--   管理员身份也应该跟着账号走，否则多角色会让权限判定出现歧义。
--
-- 为什么商店条目要从 shared 常量迁进 DB？
--   需求要求"库存全服共享且买入真实扣减、并发安全"——这要求条目成为
--   能被 Postgres 行锁串行化的事务资源；TS 常量无法参与事务。
--   seed 直接写在 migration 里（而非独立脚本）：迁移与表结构出自同一次
--   变更、天然原子，任何人 `migrate deploy` 后都必然得到与 schema 一致的
--   初始价目表；独立 seed 脚本则存在"忘了跑"导致空商店的部署缝隙。
--   （用 ON CONFLICT DO NOTHING 保证对已有数据的环境幂等。）

-- 账号角色：默认 'player'；管理员通过 ADMIN_EMAILS 白名单在注册时授予，
-- 或在已有账号上直接 UPDATE accounts SET role='admin' WHERE email='...'。
ALTER TABLE "accounts" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'player';

CREATE TABLE IF NOT EXISTS "shop_entries" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "item_id" TEXT,
    "template_id" TEXT,
    "quality" TEXT,
    "buy_price" INTEGER NOT NULL,
    "sell_price" INTEGER,
    "required_level" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT -1,
    "listed" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shop_entries_pkey" PRIMARY KEY ("id"),
    -- -1 是"无限库存"的哨兵值；负数只允许 -1，杜绝 stock=-2 之类的无意义状态
    CONSTRAINT "shop_entries_stock_check" CHECK ("stock" >= -1),
    CONSTRAINT "shop_entries_buy_price_check" CHECK ("buy_price" >= 0),
    CONSTRAINT "shop_entries_sell_price_check" CHECK ("sell_price" IS NULL OR "sell_price" >= 0)
);

-- 商店列表只查 listed=true 并按 sort_order 升序，复合索引覆盖过滤 + 排序
CREATE INDEX IF NOT EXISTS "shop_entries_listed_sort_order_idx"
ON "shop_entries" ("listed", "sort_order");

-- 初始 seed：与 packages/shared/src/data/shop.ts 的 5 条 SHOP_ENTRIES 完全一致。
-- 用 ON CONFLICT DO NOTHING：若运维已手工调价/补货，重复执行不会覆盖线上数据。
INSERT INTO "shop_entries"
  ("id", "kind", "item_id", "template_id", "quality", "buy_price", "sell_price", "required_level", "stock", "listed", "sort_order", "updated_at")
VALUES
  ('shop_wood',          'item',      'wood',              NULL,                 NULL,     4,   1,    NULL, -1, true, 10, CURRENT_TIMESTAMP),
  ('shop_copper_ore',    'item',      'copper_ore',        NULL,                 NULL,     10,  3,    NULL, -1, true, 20, CURRENT_TIMESTAMP),
  ('shop_iron_ore',      'item',      'iron_ore',          NULL,                 NULL,     30,  NULL, NULL, 25, true, 30, CURRENT_TIMESTAMP),
  ('shop_short_sword',   'equipment', NULL,                'short_sword',        'common', 100, 35,   5,    -1, true, 40, CURRENT_TIMESTAMP),
  ('shop_leather_armor', 'equipment', NULL,                'worn_leather_armor', 'common', 80,  25,   NULL, -1, true, 50, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
