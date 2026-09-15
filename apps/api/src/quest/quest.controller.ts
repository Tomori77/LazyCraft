import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { QuestService } from './quest.service.js';

/**
 * 任务 HTTP 接口
 *
 * 为什么复数 /api/quests 而不是 /api/task？
 *   领域命名"任务"在中文语境既可指 quest 也可指 task，REST 侧统一用
 *   "quests" 与模块名 QuestModule 对齐；避免与代码内部 TaskDef 类型
 *   以及后续可能的"待办（todo）"概念混淆。
 *
 * 为什么所有接口都要求登录：
 *   与 ActionController 同一铁律——任务进度存在存档里，游客没有存档。
 */
@Controller('api/quests')
@UseGuards(JwtAuthGuard)
export class QuestController {
  constructor(private readonly questService: QuestService) {}

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.questService.list(user.id);
  }

  @Post(':id/accept')
  accept(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.questService.accept(user.id, id);
  }

  @Get(':id/progress')
  progress(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.questService.progress(user.id, id);
  }

  @Post(':id/claim')
  claim(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.questService.claim(user.id, id);
  }
}
