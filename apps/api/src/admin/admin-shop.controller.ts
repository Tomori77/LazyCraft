import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { AdminShopService } from './admin-shop.service.js';
// 普通 import：class-validator 需要设计类型元数据，见 inventory.controller.ts 的说明
import { CreateShopEntryDto, UpdateShopEntryDto } from './dto/admin-shop.dto.js';

/**
 * 商店管理 HTTP 接口（task-24b）
 *
 * 鉴权双 Guard：JwtAuthGuard 先鉴定身份（无 token → 401），
 * AdminGuard 再判角色（非 admin → 403）。顺序不能反，否则 user 未填充时一律 403，
 * 会把"未登录"误报成"无权限"。
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
  create(@Body() dto: CreateShopEntryDto) {
    return this.adminShopService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateShopEntryDto) {
    return this.adminShopService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.adminShopService.remove(id);
  }
}
