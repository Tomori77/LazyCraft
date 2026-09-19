import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ShopService } from './shop.service.js';
// 普通 import：class-validator 需要设计类型元数据，见 inventory.controller.ts 的说明
import { BuyDto, SellDto } from './dto/shop.dto.js';

/**
 * 商店 HTTP 接口（task-24）
 *
 * 全部需登录：列表要按当前存档算"买得起/已解锁"，买卖要写存档与金币；
 * 与玩家市场（/api/market）是两套系统，互不影响。
 */
@Controller('api/shop')
@UseGuards(JwtAuthGuard)
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.shopService.list(user.id);
  }

  @Post('buy')
  buy(@CurrentUser() user: { id: string }, @Body() dto: BuyDto) {
    return this.shopService.buy(user.id, dto.entry_id, dto.quantity);
  }

  @Post('sell')
  sell(@CurrentUser() user: { id: string }, @Body() dto: SellDto) {
    return this.shopService.sell(user.id, dto.uid, dto.quantity);
  }
}
