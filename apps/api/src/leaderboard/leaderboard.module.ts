import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SaveModule } from '../save/save.module.js';
import { LeaderboardController } from './leaderboard.controller.js';
import { LeaderboardService } from './leaderboard.service.js';

/**
 * 排行榜模块（task-16）
 *
 * 必须 import SaveModule：controller 需要用 SaveService.ensurePlayer 把
 * accountId（JWT sub）转换成 playerId（榜上用的 id）。
 * 必须 import AuthModule：JwtAuthGuard 运行时需要 PassportModule 提供的
 * AuthModuleOptions（与 ActionModule 同款约束）。
 */
@Module({
  imports: [PrismaModule, AuthModule, SaveModule],
  controllers: [LeaderboardController],
  providers: [LeaderboardService],
})
export class LeaderboardModule {}
