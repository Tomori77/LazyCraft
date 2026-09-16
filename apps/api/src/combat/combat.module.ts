import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SaveModule } from '../save/save.module.js';
import { BroadcastModule } from '../broadcast/broadcast.module.js';
import { CombatController } from './combat.controller.js';
import { CombatService } from './combat.service.js';

/**
 * 战斗模块（task-18）
 *
 * 必须 import SaveModule：start/stop/current 都读写存档，且复用
 * SaveService.ensurePlayer 定位 player 行做 CAS——与 ActionModule 同一份约定。
 * 必须 import AuthModule：JwtAuthGuard 运行时需要 PassportModule 提供的配置。
 * 必须 import BroadcastModule：史诗装备掉落要进全服广播流（task-17）。
 */
@Module({
  imports: [AuthModule, SaveModule, BroadcastModule],
  controllers: [CombatController],
  providers: [CombatService],
  exports: [CombatService],
})
export class CombatModule {}
