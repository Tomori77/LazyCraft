#!/bin/sh
# 容器启动入口：先执行数据库迁移，成功后才启动应用。
# 为什么抽成脚本而不是写在 compose command 里：
#   三个编排文件共用同一镜像，逻辑放进镜像可避免三处重复且互相漂移。
set -e

# MIGRATE_DATABASE_URL 与 DATABASE_URL 刻意解耦：迁移目标必须是业务库，
# 绝不允许回退到开发期临时用的 lazycraft_auth，因此这里只认它。
if [ -z "$MIGRATE_DATABASE_URL" ]; then
  echo "[entrypoint] 错误：未设置 MIGRATE_DATABASE_URL，拒绝启动。" >&2
  echo "[entrypoint] 该变量必须指向业务库连接串；本脚本不会回退到 DATABASE_URL。" >&2
  exit 1
fi

echo "[entrypoint] 开始执行数据库迁移（prisma migrate deploy）..."
# prisma.config.ts 读取的是 DATABASE_URL，这里用 MIGRATE_DATABASE_URL 临时覆盖，
# 覆盖只作用于这次迁移进程；应用启动仍使用原来的 DATABASE_URL。
if ! DATABASE_URL="$MIGRATE_DATABASE_URL" prisma migrate deploy; then
  echo "[entrypoint] 错误：数据库迁移失败，拒绝启动应用（不静默启动）。" >&2
  exit 1
fi

echo "[entrypoint] 数据库迁移完成，启动应用。"
exec "$@"
