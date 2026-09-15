import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SaveService } from './save.service.js';
import { WriteSaveDto } from './dto/save.dto.js';

/**
 * 存档 HTTP 接口
 *
 * 路由前缀直接挂 /api/save（而不是 /api/players/:id/save），
 * 因为当前业务约定"一个账号对应一份当前存档"——多存档槽位是后续扩展，
 * 提前把 URL 设计复杂化反而会让所有客户端永远多传一个用不到的参数。
 */
@Controller('api/save')
@UseGuards(JwtAuthGuard)
export class SaveController {
  constructor(private readonly saveService: SaveService) {}

  @Get()
  readSave(@CurrentUser() user: { id: string }) {
    return this.saveService.read(user.id);
  }

  @Post()
  writeSave(@CurrentUser() user: { id: string }, @Body() dto: WriteSaveDto) {
    return this.saveService.write(user.id, dto.version, dto.data);
  }
}
