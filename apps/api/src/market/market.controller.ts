import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { Quality } from '@lazycraft/shared';
import { MarketService } from './market.service.js';
import { ListItemDto } from './dto/market.dto.js';

/**
 * 市场 HTTP 接口（task-15）
 *
 * 为什么所有接口都要求登录：
 *   挂单/购买都会修改玩家的存档与金币，游客模式没有存档语义；
 *   "浏览"也强制登录——把"看市场"做成匿名能力会让爬虫零成本抓全服挂单，
 *   且未来要做"我的关注列表"等个性化扩展时必然要求登录，先统一收口。
 */
@Controller('api/market')
@UseGuards(JwtAuthGuard)
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  /** 挂单：卖家把背包物品挂到市场 */
  @Post('list')
  list(@CurrentUser() user: { id: string }, @Body() dto: ListItemDto) {
    return this.marketService.list(
      user.id,
      dto.itemId,
      (dto.quality ?? 'common') as Quality,
      dto.quantity,
      dto.price,
    );
  }

  /** 撤单：卖家收回挂单（不退手续费） */
  @Post('cancel/:id')
  cancel(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.marketService.cancel(user.id, id);
  }

  /** 购买：买家付总价，卖家得 95%（5% 税系统回收） */
  @Post('buy/:id')
  buy(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.marketService.buy(user.id, id);
  }

  /** 我的挂单：只列自己挂的（含过期未撤） */
  @Get('my-listings')
  myListings(@CurrentUser() user: { id: string }) {
    return this.marketService.myListings(user.id);
  }

  /**
   * 浏览全服挂单：分页 + 按物品/品质筛选；默认过滤掉已过期的
   *
   * query 参数是字符串，用 ParseIntPipe 转 int；默认值在 pipe 里给而不是在 service 里给，
   * 让"分页语义"集中在 controller 一处。
   */
  @Get('listings')
  listings(
    @Query('itemId') itemId?: string,
    @Query('quality') quality?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.marketService.browse(itemId, quality, page, limit);
  }

  /** 价格历史：某物品（可选品质）按天的均值/量 */
  @Get('history/:itemId')
  history(
    @Param('itemId') itemId: string,
    @Query('quality') quality?: string,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit?: number,
  ) {
    return this.marketService.history(itemId, quality, limit);
  }
}
