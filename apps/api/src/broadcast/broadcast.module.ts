import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SaveModule } from '../save/save.module.js';
import { BroadcastController } from './broadcast.controller.js';
import { BroadcastService } from './broadcast.service.js';

/**
 * 全服广播模块（task-17）
 *
 * 为什么 import SaveModule？
 *   /simulate 通路需要把 JWT 的 accountId 转换成 playerId（Broadcast.playerId 指向 players 表），
 *   复用 SaveService.ensurePlayer 与 Action/Leaderboard 模块保持同一定位约定。
 * 为什么 import AuthModule？
 *   @UseGuards(JwtAuthGuard) 运行时需要 PassportModule 的 AuthModuleOptions，
 *   与 Action/Quest 模块同一约束（AuthModule 内 register 并 re-export）。
 */
@Module({
  imports: [PrismaModule, AuthModule, SaveModule],
  controllers: [BroadcastController],
  providers: [BroadcastService],
  exports: [BroadcastService],
})
export class BroadcastModule {}
