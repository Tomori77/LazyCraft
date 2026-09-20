import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AdminShopService } from './admin-shop.service.js';
// 普通 import：class-validator 需要设计类型元数据，见 inventory.controller.ts 的说明
import { CreateShopEntryDto, UpdateShopEntryDto } from './dto/admin-shop.dto.js';

/**
 * 商店管理 HTTP 接口（task-24b）
 *
 * 鉴权双 Guard：JwtAuthGuard 先鉴定身份（无 token → 401），
 * AdminGuard 再判角色（非 admin → 403）。顺序不能反，否则 user 未填充时一律 403，
 * 会把"未登录"误报成"无权限"。
 *
 * task-38 起所有写操作把操作者 id 透传给 service 写审计：
 * id 取自 request.user（JWT 校验结果），绝不由客户端参数指定。
 */
@Controller('api/admin/shop/entries')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminShopController {
  constructor(private readonly adminShopService: AdminShopService) {}

  @Get()
  list() {
    return this.adminShopService.list();
  }

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateShopEntryDto) {
    return this.adminShopService.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateShopEntryDto,
  ) {
    return this.adminShopService.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.adminShopService.remove(user.id, id);
  }
}
