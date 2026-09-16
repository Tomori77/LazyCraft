#!/usr/bin/env bash
# ========================================
# LazyCraft 数据库每日备份脚本（1Panel 环境）
# ========================================
# 策略：
#   - 直接对现有 1Panel PostgreSQL 容器执行 pg_dump，数据不落第二份实时库
#   - 备份文件写入宿主机固定目录，gzip 压缩，保留最近 7 天
#   - 由宿主机 crontab 调用，示例：
#       0 3 * * * /opt/LazyCraft/scripts/backup.sh >> /var/log/lazycraft-backup.log 2>&1

set -euo pipefail

# ---- 可调参数（宿主机环境变量优先） ----
PG_CONTAINER="${PG_CONTAINER:-1Panel-postgresql-Vwx8}"
BACKUP_DIR="${BACKUP_DIR:-/opt/lazycraft-backups}"
PG_USER="${PG_USER:-LazyCraft}"
POSTGRES_DB="${POSTGRES_DB:-LazyCraft}"   # pg_dump 单库备份，保留最近 7 天足够恢复
RETENTION_DAYS="${RETENTION_DAYS:-7}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/${POSTGRES_DB}-${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -Iseconds)] backup start -> ${BACKUP_FILE}"

# 在容器内管道压缩：避免宿主机与容器 PostgreSQL 客户端版本不匹配
if ! docker exec "${PG_CONTAINER}" sh -c \
    "pg_dump -U '${PG_USER}' -d '${POSTGRES_DB}' | gzip" > "${BACKUP_FILE}"; then
    echo "[$(date -Iseconds)] backup FAILED" >&2
    rm -f "${BACKUP_FILE}"
    exit 1
fi

# 完整性校验：gzip 损坏时立刻报错，而不是恢复时才发现
if ! gzip -t "${BACKUP_FILE}"; then
    echo "[$(date -Iseconds)] backup integrity check FAILED: ${BACKUP_FILE}" >&2
    rm -f "${BACKUP_FILE}"
    exit 1
fi

echo "[$(date -Iseconds)] backup ok, size=$(du -h "${BACKUP_FILE}" | cut -f1)"

# 清理过期备份：只保留最近 RETENTION_DAYS 天
find "${BACKUP_DIR}" -name "*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "[$(date -Iseconds)] cleanup done (keep last ${RETENTION_DAYS} days)"
