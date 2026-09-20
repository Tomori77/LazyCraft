-- task-41：内容包（DLC）启用状态
--
-- 为什么单开一张表而不是复用配置表 / 单行 JSON？
--   1. 语义清晰：一行 = 一个被显式改过状态的 pack，可对 id 建主键防重复；
--   2. 可审计：每次启停都有明确 target（content_pack:<id>），与 admin_audit_logs 对齐；
--   3. 与内容解耦：pack 本体是编译进产物的代码，本表只存"开关"。
--
-- 为什么 enabled 默认 true？
--   首次部署 / 新编译进来的 pack / 从未被管理员改过的 pack，表里都没有记录；
--   读路径统一按"无记录 = 启用"处理（见 ContentPackStateService），
--   因此默认值只影响"万一有人手动插行但漏填"的情况，方向是安全的。
CREATE TABLE IF NOT EXISTS "content_pack_state" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_pack_state_pkey" PRIMARY KEY ("id")
);
