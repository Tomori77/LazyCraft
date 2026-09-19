import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../lib/prisma-client/client.js';

/**
 * 事务内的存档定位 / 行锁辅助。
 *
 * 为什么抽出来而不是让每个模块各写一份？
 *   inventory 与 shop 都要"事务 + 行锁 + 基于最新 data 整体覆写"，
 *   这套并发模型与 market 完全同构；把它收敛到一处，三个模块就不会
 *   各自漂移出不同的锁顺序或错误码。市场模块保持不变，不在此列。
 *
 * 为什么用 update 而不是 SELECT ... FOR UPDATE？
 *   Prisma 7 的 select for update 仍要走 raw SQL；把 data 写成它自己的值
 *   同样能拿到行锁，且类型稳定（与 market.service.ts 的做法一致）。
 */

/** 拿当前账号对应的 player；没有角色 = 没有存档语义，直接 403 而非懒创建 */
export async function mustGetPlayer(tx: Prisma.TransactionClient, accountId: string) {
  const player = await tx.player.findFirst({
    where: { accountId },
    orderBy: { createdAt: 'asc' },
  });
  if (!player) {
    throw new ForbiddenException('角色不存在，请先访问 /api/save 初始化存档');
  }
  return player;
}

/** 锁定并返回一份存档行；存档缺失转 404，让调用方先去 /api/save 初始化 */
export async function mustLockSave(tx: Prisma.TransactionClient, playerId: string) {
  const save = await tx.save.findUnique({ where: { playerId } });
  if (!save) throw new NotFoundException('存档不存在，请先访问 /api/save 初始化');
  return tx.save.update({ where: { id: save.id }, data: { version: save.version } });
}
