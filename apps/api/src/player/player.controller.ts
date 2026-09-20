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
  getPlayer(@CurrentUser() user: { id: string; role: string }) {
    // role 直接取自 JwtStrategy.validate() 的结果（每请求按 5s TTL 回库核验），
    // 前端据此决定是否显示管理后台入口；只暴露自身角色，不泄露他人。
    return this.playerService.getPlayer(user.id, user.role);
  }
}
