import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { InventoryService } from './inventory.service.js';
// 必须是普通 import：`import type` 会被编译期抹掉，class-validator 拿不到
// 设计类型元数据，ValidationPipe 会把请求体属性当成"未知字段"全部拒绝
import {
  DiscardItemDto,
  EquipItemDto,
  MoveItemDto,
  UnequipItemDto,
} from './dto/inventory.dto.js';

/**
 * 容器操作 HTTP 接口（task-24）
 *
 * 全部需登录、全部写存档：这些操作改变玩家持有物，游客模式没有存档语义。
 */
@Controller('api/inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('move')
  move(@CurrentUser() user: { id: string }, @Body() dto: MoveItemDto) {
    return this.inventoryService.move(user.id, dto.uid, dto.from, dto.to);
  }

  @Post('equip')
  equip(@CurrentUser() user: { id: string }, @Body() dto: EquipItemDto) {
    return this.inventoryService.equip(user.id, dto.uid, dto.slot);
  }

  @Post('unequip')
  unequip(@CurrentUser() user: { id: string }, @Body() dto: UnequipItemDto) {
    return this.inventoryService.unequip(user.id, dto.slot);
  }

  @Post('discard')
  discard(@CurrentUser() user: { id: string }, @Body() dto: DiscardItemDto) {
    return this.inventoryService.discard(user.id, dto.uid, dto.quantity);
  }
}
