-- task-38：管理审计日志
--
-- 为什么要审计表？
--   管理后台允许改商店价目、发物品、启停内容；这些操作必须留下
--   "谁 / 何时 / 对谁 / 改了什么" 的历史凭证，否则出问题无法追责/回滚。
--
-- 为什么 admin_account_id 不建外键（对照其它表的 ON DELETE CASCADE）？
--   审计日志必须比它记录的对象活得更久：
--   - CASCADE：删管理员账号会连带抹掉他的全部操作痕迹；
--   - RESTRICT：反过来阻止删除账号，把历史留存问题变成运维障碍。
--   折中是只存 accountId 字符串、不建约束，账号删除后日志仍在
--   （明细快照已存在 detail 里，足以复盘）。
--
-- 为什么 detail 用 JSONB？
--   各管理动作的"改了什么"形状完全不同（改价 / 发放物品 / 启停 pack），
--   拆列会随管理面扩张不断加列；审计只被人工查读、不参与业务查询，
--   jsonb 正好承载异构明细。可过滤的维度（action/target）已单独成列。
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "admin_account_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- 审计页永远"最新在前"：倒序索引让分页扫描稳定走索引
CREATE INDEX IF NOT EXISTS "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at" DESC);
-- 按操作者查"某人做过什么"
CREATE INDEX IF NOT EXISTS "admin_audit_logs_admin_account_id_idx" ON "admin_audit_logs"("admin_account_id");
-- 按目标过滤（审计页筛选）
CREATE INDEX IF NOT EXISTS "admin_audit_logs_target_type_target_id_idx" ON "admin_audit_logs"("target_type", "target_id");
