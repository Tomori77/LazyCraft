import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CombatService } from './combat.service.js';
import type { StartCombatDto } from './dto/combat.dto.js';

/**
 * 战斗 HTTP 接口
 *
 * 为什么所有接口都要求登录？
 *   服务器权威铁律：时间、结算、存档全在服务端。游客模式下没有存档，
 *   start/stop 无从谈起——与 ActionController 保持同一原则。
 */
@Controller('api/combat')
@UseGuards(JwtAuthGuard)
export class CombatController {
  constructor(private readonly combatService: CombatService) {}

  @Post('start')
  start(@CurrentUser() user: { id: string }, @Body() dto: StartCombatDto) {
    return this.combatService.start(user.id, dto.enemyId);
  }

  @Post('stop')
  stop(@CurrentUser() user: { id: string }) {
    return this.combatService.stop(user.id);
  }

  @Get('current')
  current(@CurrentUser() user: { id: string }) {
    return this.combatService.current(user.id);
  }
}
