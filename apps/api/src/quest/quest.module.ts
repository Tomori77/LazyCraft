import { Module, OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SaveModule } from '../save/save.module.js';
import { ActionModule } from '../action/action.module.js';
import { ActionService } from '../action/action.service.js';
import { QuestController } from './quest.controller.js';
import { QuestService } from './quest.service.js';

/**
 * 任务模块（task-13）
 *
 * 依赖与 ActionModule 同构：必须 import AuthModule（JwtAuthGuard 需要
 * PassportModule 注册）与 SaveModule（任务进度存存档 data.quests）。
 *
 * import ActionModule 即可（无需 forwardRef）：
 *   依赖方向是 Quest → Action（QuestService 需要 ActionService 来订阅
 *   结算事件），Action 侧对 Quest 完全无感知——不构成循环。
 */
@Module({
  imports: [AuthModule, SaveModule, ActionModule],
  controllers: [QuestController],
  providers: [QuestService],
  exports: [QuestService],
})
export class QuestModule implements OnModuleInit {
  constructor(
    private readonly actionService: ActionService,
    private readonly questService: QuestService,
  ) {}

  /** 模块初始化时把任务进度累计逻辑挂到动作结算上 */
  onModuleInit() {
    this.actionService.registerSettlementListener((accountId, gained) =>
      this.questService.recordGainedFromSettlement(accountId, gained),
    );
  }
}
