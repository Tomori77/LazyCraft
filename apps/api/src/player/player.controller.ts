import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { PlayerService } from './player.service.js';

/**
 * 玩家信息接口（task-26）
 *
 * 需登录：返回的是当前账号的存档聚合（技能/背包/仓库/装备），
 * 游客模式没有存档语义，因此不开放匿名访问。
 */
@Controller('api/player')
@UseGuards(JwtAuthGuard)
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  @Get()
  getPlayer(@CurrentUser() user: { id: string }) {
    return this.playerService.getPlayer(user.id);
  }
}
