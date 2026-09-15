import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SaveService } from '../save/save.service.js';
import { LeaderboardService } from './leaderboard.service.js';

/**
 * 排行榜 HTTP 接口
 *
 * 为什么要求登录才能看榜（而不是公开）？
 *   响应里带 me（当前玩家名次），必须知道"你是谁"才有意义；
 *   且放置游戏榜单是社区内部功能，没有对外公开的业务诉求。
 *
 * 为什么这里要调 SaveService.ensurePlayer？
 *   JWT 里的 sub 是 accountId，而榜上的 id 是 playerId；
 *   复用 ensurePlayer（懒创建默认角色）与 Action/Save 模块保持同一套
 *   "account → player" 定位约定，不散落第二份 findFirst+create。
 */
@Controller('api/leaderboard')
@UseGuards(JwtAuthGuard)
export class LeaderboardController {
  constructor(
    private readonly leaderboardService: LeaderboardService,
    private readonly saveService: SaveService,
  ) {}

  @Get('total-level')
  async getTotalLevel(
    @CurrentUser() user: { id: string },
    @Query('limit') limit?: string,
  ) {
    const player = await this.saveService.ensurePlayer(user.id);
    // 非法 limit（负数/非数字）一律回退 0 = 全量；不在入口做强校验，
    // 因为 limit 是调优参数不是业务约束，传错了给全量也不会出错
    const parsed = limit !== undefined ? Number.parseInt(limit, 10) : 0;
    return this.leaderboardService.getTotalLevel(
      Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
      player.id,
    );
  }
}
