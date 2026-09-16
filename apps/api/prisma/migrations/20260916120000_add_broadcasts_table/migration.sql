-- task-17：全服广播表
--
-- 为什么独立一张表而不是塞进 saves.data(jsonb)？
--   广播是"全服公共事件流"，需要跨玩家的行级读（最近 N 条）；
--   塞进单个玩家的 jsonb 就没法被其它玩家看到，也失去了"按时间倒序
--   取最新"这种天然属于事件流的访问形态。
--
-- 为什么把 type / item_id / quality 拆成列而不是统一塞 payload jsonb？
--   前端轮播要按 quality 渲染颜色、按 item_id 找显示名；拆列后
--   "只看 epic 及以上"之类的过滤不必打开 jsonb，也让 type 列成为
--   将来扩展（赛季结算/世界 boss 等）的唯一扩展点。
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- 前端轮询总是按 created_at DESC 取最近 N 条，按时间建索引让列表扫描走索引
CREATE INDEX "broadcasts_created_at_idx" ON "broadcasts"("created_at" DESC);
-- 未来支持"我的高光时刻"（个人广播历史），按 playerId 索引
CREATE INDEX "broadcasts_player_id_idx" ON "broadcasts"("player_id");

-- 角色删除时联动清理其广播；与 saves.player_id 的 ON DELETE CASCADE 策略一致
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_player_id_fkey"
    FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
