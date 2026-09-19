import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ActionService } from './action.service.js';
import { StartActionDto } from './dto/action.dto.js';

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

  @Get('current')
  current(@CurrentUser() user: { id: string }) {
    return this.actionService.current(user.id);
  }
}
