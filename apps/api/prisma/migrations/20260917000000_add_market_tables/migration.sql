-- task-15：玩家市场（market_listings + market_history）
--
-- 为什么挂单独立成关系表而不是塞进 saves.data(jsonb)：
--   - 买家需要跨玩家分页/筛选浏览挂单，jsonb 文档无法高效支撑；
--   - 购买操作要同时改挂单状态 + 买家背包 + 卖家金币，行级资源
--     才能与存档事务一起被 Postgres 串行化；
-- - 挂单行的 WHERE 条件（seller_id / expires_at）需要索引加速。
--
-- 为什么 history 用"日聚合"而不是逐笔成交：
--   市场 UI 只展示均价/成交量走势图，明细级流水属于审计领域，
--   聚合到日表即可满足可视化需求，行数从"每笔一行"降到"每天一行"。

CREATE TABLE IF NOT EXISTS market_listings (
  id          TEXT PRIMARY KEY,
  seller_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,
  quality     TEXT NOT NULL DEFAULT 'common',
  quantity    INT  NOT NULL CHECK (quantity > 0),
  price       INT  NOT NULL CHECK (price > 0),
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ(6) NOT NULL
);

-- 浏览市场按"物品+品质 → 最新"排序
CREATE INDEX IF NOT EXISTS market_listings_item_quality_created_idx
ON market_listings (item_id, quality, created_at DESC);

-- "我的挂单"面板按卖家聚合
CREATE INDEX IF NOT EXISTS market_listings_seller_created_idx
ON market_listings (seller_id, created_at DESC);

-- 价格历史（日聚合）：
-- 同 (item_id, quality, date) 合并一行
--
-- 为什么存 total_price 而不是 avg_price：
--   加权平均滚动更新（avg_price = (old_avg*old_v + new_p*new_q) / new_v）必须
--   对 avg 取整，多次合并会丢分；total_price/volume 保留全部信息，
--   读侧派生 avg_price = total_price / volume，数学上是整日的精确平均。
CREATE TABLE IF NOT EXISTS market_history (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL,
  quality     TEXT NOT NULL DEFAULT 'common',
  total_price INT  NOT NULL,
  volume      INT  NOT NULL,
  date        TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS market_history_item_quality_date_key
ON market_history (item_id, quality, date);

CREATE INDEX IF NOT EXISTS market_history_item_quality_date_idx
ON market_history (item_id, quality, date DESC);
