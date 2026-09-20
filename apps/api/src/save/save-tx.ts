import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../lib/prisma-client/client.js';

/**
 * 事务内的存档定位 / 行锁辅助。
 *
 * 为什么抽出来而不是让每个模块各写一份？
 *   inventory 与 shop 都要"事务 + 行锁 + 基于最新 data 整体覆写"，
 *   这套并发模型与 market 完全同构；把它收敛到一处，三个模块就不会
 *   各自漂移出不同的锁顺序或错误码。市场模块保持不变，不在此列。
 *
 * 为什么写路径的锁改成"一条 UPDATE ... RETURNING"？
 *   原本每个写操作是"查 player + 查 save + update 加锁"3 条串行查询；
 *   远程 PG 单次往返约 80ms，写延迟的大头就在这里。改成一条
 *   `UPDATE saves SET version = version WHERE player_id = (...) RETURNING *`
 *   后：定位、取行锁、读回最新 data 一次完成（实测 3 条 ≈400ms → 1 条 ≈230ms）。
 *   条件不变（仍按 accountId 定位唯一存档），整份覆写的并发语义不变。
 *   锁行为已实测：A 持有行锁期间 B 的同一 UPDATE 被阻塞到 A 提交。
 */

/** 行锁返回的存档行；data 为 JSONB，已由 pg 解析为对象 */
export interface LockedSaveRow {
  id: string;
  player_id: string;
  version: number;
  data: unknown;
  updated_at: Date;
}

/**
 * 取当前账号存档的行锁并读回最新内容（一条语句）。
 *
 * 为什么用一个不改变内容的 UPDATE（SET version = version）取锁？
 *   Prisma 7 的 `select ... for update` 需走 raw SQL；UPDATE 自身同样加行锁，
 *   且能把"定位 + 锁定 + 读回"合并进一条语句，省掉两次串行往返。
 * 为什么用子查询而不是先查 player？
 *   写路径只需要"账号 → 该账号最早的角色 → 其存档"这一条链路；
 *   子查询让数据库在一条语句内完成定位，无需应用侧先拿 player.id。
 *   没有角色时子查询为空 → UPDATE 0 行，抛出与原 mustGetPlayer 一致的 403 语义。
 */
export async function lockSaveForAccount(
  tx: Prisma.TransactionClient,
  accountId: string,
): Promise<LockedSaveRow> {
  const rows = await tx.$queryRaw<LockedSaveRow[]>`
    UPDATE saves SET version = version
    WHERE player_id = (
      SELECT id FROM players WHERE account_id = ${accountId} ORDER BY created_at ASC LIMIT 1
    )
    RETURNING id, player_id, version, data, updated_at`;

  const row = rows[0];
  if (!row) {
    // 区分"没有角色"与"有角色但没有存档"：两者对调用方的修复动作不同
    const player = await tx.player.findFirst({ where: { accountId }, select: { id: true } });
    if (!player) throw new ForbiddenException('角色不存在，请先访问 /api/save 初始化存档');
    throw new NotFoundException('存档不存在，请先访问 /api/save 初始化');
  }
  return row;
}

// 注：原 mustGetPlayer / mustLockSave 两个分步辅助已由 lockSaveForAccount 取代
// （inventory / shop 均已迁移）；market.service 保留自己同构的私有实现，不在此列。
