import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SaveModule } from '../save/save.module.js';
import { ContentModule } from '../content/content.module.js';
import { ActionController } from './action.controller.js';
import { ActionService } from './action.service.js';

/**
 * 活动模块（task-08）
 *
 * 必须 import SaveModule：start/stop/current 都读存档；条件更新用 relation
 * 过滤按 accountId 直接定位存档（save.updateMany where player.accountId），
 * "默认角色"的定位逻辑收敛在 SaveModule，不散落到多处。
 * 必须 import AuthModule：JwtAuthGuard 是 AuthGuard('jwt') 的别名，
 * 运行时需要 PassportModule 提供的 AuthModuleOptions。
 */
@Module({
  imports: [AuthModule, SaveModule, ContentModule],
  controllers: [ActionController],
  providers: [ActionService],
  exports: [ActionService],
})
export class ActionModule {}
