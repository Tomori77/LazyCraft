-- task-16：总等级排行榜物化视图
--
-- 为什么视图基于 saves.data(jsonb) 而不是独立的 player_skills 表？
--   任务描述里的 "FROM player_skills" 来自《框架设计》5.2 的概念模型，
--   但 task-03 落地时（schema.prisma"存档即文档"决策）技能经验只存在于
--   saves.data.skills jsonb 里，物理上没有 player_skills 表。
--   物化视图在这里充当"逻辑上的 player_skills 物化层"——
--   用 jsonb_each 把 jsonb 平展开再聚合，与任务给的 SQL 语义等价。
--
-- 为什么在 SQL 里内嵌"经验→等级"换算，而不是引用 shared 的 levelFromExp？
--   经验公式 exp(level) = level^3（task-07），反函数 level = floor(exp^(1/3))。
--   把它内联进视图 SQL 意味着公式变更时必须同步改这里；
--   换取的好处是物化视图自包含、可读，且刷新时不需要 JS 参与。
--   task-16 只承诺"总等级榜"，这个换算在可见的未来不会变复杂，可接受。
CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard_total_level AS
SELECT
  s.player_id,
  SUM(FLOOR(CBRT(GREATEST((skill_record.value ->> 'exp')::numeric, 0))))::int AS total_level
FROM saves s
CROSS JOIN LATERAL jsonb_each(s.data -> 'skills') AS skill_record(key, value)
WHERE jsonb_typeof(s.data -> 'skills') = 'object'
  AND jsonb_typeof(skill_record.value -> 'exp') = 'number'
GROUP BY s.player_id;

-- 为什么加唯一索引：将来玩家规模上来后可改 REFRESH MATERIALIZED VIEW CONCURRENTLY，
-- CONCURRENTLY 模式要求物化视图必须存在覆盖全部行的唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_total_level_player_id_key
ON leaderboard_total_level (player_id);

-- 给查询侧的 ORDER BY 兜底（榜单按 total_level DESC 扫时不必每次重排）
CREATE INDEX IF NOT EXISTS leaderboard_total_level_total_level_idx
ON leaderboard_total_level (total_level DESC);
