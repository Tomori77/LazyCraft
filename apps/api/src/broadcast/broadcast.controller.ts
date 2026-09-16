import { Body, Controller, Get, NotFoundException, Post, Query, UseGuards } from '@nestjs/common';
import { findLootTableByMonster } from '@lazycraft/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SaveService } from '../save/save.service.js';
import { BroadcastService } from './broadcast.service.js';
import { SimulateDropDto } from './dto/broadcast.dto.js';

/**
 * 全服广播 HTTP 接口（task-17）
 *
 * 为什么 GET 不要求登录？
 *   广播是全服公共事件流——玩家即便未登录也想看见"别人掉了什么好东西"，
 *   这是放置游戏的重要"社交证明"。读路径无副作用，公开最省事。
 *
 * 为什么 POST /simulate 要求登录？
 *   广播带 player_id，必须与一个真实角色绑定；且 simulate 是开发通路，
 *   不该被匿名访客刷满广播表。
 */
@Controller('api/broadcasts')
export class BroadcastController {
  constructor(
    private readonly broadcastService: BroadcastService,
    private readonly saveService: SaveService,
  ) {}

  /**
   * 列出最近广播；前端 10s 轮询调用。
   *
   * @param limit 取多少条；缺省/非法值回退 20，硬上限 50 由 service 兜底
   */
  @Get()
  list(@Query('limit') limit?: string) {
    const parsed = limit !== undefined ? Number.parseInt(limit, 10) : 0;
    return this.broadcastService.listRecent(Number.isFinite(parsed) ? parsed : 0);
  }

  /**
   * 开发期掉落模拟入口：roll LootResult，触发阈值则写库。
   *
   * 当前阶段没有战斗模块（task-18），这条路径是验证 task-17 的唯一通路。
   * 响应中 broadcast 为 null 表示本次掉落未达广播阈值——不是错误，前端按 200 正常处理。
   */
  @Post('simulate')
  @UseGuards(JwtAuthGuard)
  async simulate(@CurrentUser() user: { id: string }, @Body() dto: SimulateDropDto) {
    if (!findLootTableByMonster(dto.monsterId)) {
      throw new NotFoundException(`怪物不存在或没有掉落表: ${dto.monsterId}`);
    }
    // 广播需要 playerId，accountId → playerId 的定位走与 Action/Save 同款 ensurePlayer 约定
    const player = await this.saveService.ensurePlayer(user.id);
    const rng = dto.rngSequence?.length ? sequenceRng(dto.rngSequence) : Math.random;
    return this.broadcastService.simulateDrop(player.id, dto.monsterId, rng);
  }
}

/** 把一段 0~1 数列包成 (() => number)，耗尽后回落到 Math.random */
function sequenceRng(sequence: number[]): () => number {
  let cursor = 0;
  return () => (cursor < sequence.length ? sequence[cursor++] : Math.random());
}
