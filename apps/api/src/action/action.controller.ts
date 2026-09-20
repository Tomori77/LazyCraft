import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ActionService } from './action.service.js';
import { EnqueueActionDto, StartActionDto, UpdateQueueItemDto } from './dto/action.dto.js';

/**
 * 活动（挂机动作）HTTP 接口
 *
 * 为什么所有接口都要求登录？
 *   服务器权威铁律：时间、结算、存档全在服务端。游客模式下没有存档，
 *   start/stop 无从谈起——不登录的玩家本就不在这套系统里玩。
 */
@Controller('api/action')
@UseGuards(JwtAuthGuard)
export class ActionController {
  constructor(private readonly actionService: ActionService) {}

  @Post('start')
  start(@CurrentUser() user: { id: string }, @Body() dto: StartActionDto) {
    return this.actionService.start(user.id, dto.skillId, dto.actionId);
  }

  @Post('stop')
  stop(@CurrentUser() user: { id: string }) {
    return this.actionService.stop(user.id);
  }

  /**
   * 结清截至现在的所有到期整圈并保持动作继续（逐圈产出）。
   * 与 stop 分离：stop 是"玩家主动结束"，settle-due 是"服务器例行收圈"。
   */
  @Post('settle-due')
  settleDue(@CurrentUser() user: { id: string }) {
    return this.actionService.settleDue(user.id);
  }

  @Get('current')
  current(@CurrentUser() user: { id: string }) {
    return this.actionService.current(user.id);
  }

  /* ---------------------------------------------------------------- */
  /* 动作队列（task-36）                                              */
  /* ---------------------------------------------------------------- */

  /** 查询队列 + 槽位信息（10 槽 / 3 可用） */
  @Get('queue')
  getQueue(@CurrentUser() user: { id: string }) {
    return this.actionService.getQueue(user.id);
  }

  /** 入队：技能 → 对应工作 + 工作次数（按圈数） */
  @Post('queue')
  enqueue(@CurrentUser() user: { id: string }, @Body() dto: EnqueueActionDto) {
    return this.actionService.enqueue(user.id, dto.skillId, dto.actionId, dto.count);
  }

  /** 改某行：改次数 / 换工作 */
  @Patch('queue/:index')
  updateQueueItem(
    @CurrentUser() user: { id: string },
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: UpdateQueueItemDto,
  ) {
    return this.actionService.updateQueueItem(user.id, index, dto);
  }

  /** 移除某行；若移除的是正在跑的队首则同时切换到下一项 */
  @Delete('queue/:index')
  removeQueueItem(
    @CurrentUser() user: { id: string },
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.actionService.removeQueueItem(user.id, index);
  }

  /** 清空队列（并停止正在跑的队首） */
  @Delete('queue')
  clearQueue(@CurrentUser() user: { id: string }) {
    return this.actionService.clearQueue(user.id);
  }
}
