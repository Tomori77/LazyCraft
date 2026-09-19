import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SaveModule } from '../save/save.module.js';
import { ContentModule } from '../content/content.module.js';
import { PlayerController } from './player.controller.js';
import { PlayerService } from './player.service.js';

/**
 * 玩家信息模块（task-26）
 *
 * import AuthModule（JwtAuthGuard 运行时需要 Passport）、SaveModule（权威读存档）
 * 与 ContentModule（技能/槽位清单以内容快照为准，保证与 /api/content 同源）。
 */
@Module({
  imports: [AuthModule, SaveModule, ContentModule],
  controllers: [PlayerController],
  providers: [PlayerService],
})
export class PlayerModule {}
