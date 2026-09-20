import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AdminContentService } from './admin-content.service.js';
// 普通 import：class-validator 需要设计类型元数据，见 inventory.controller.ts 的说明
import { UpdatePackStateDto } from './dto/admin-content.dto.js';

/**
 * 内容包（DLC）管理 HTTP 接口（task-41）。
 *
 * 鉴权双 Guard：JwtAuthGuard 先鉴定身份（无 token → 401），
 * AdminGuard 再判角色（非 admin → 403）。
 *
 * 语义约束：本接口只翻转"启用开关"，**不做热重载**——改动写库后
 * 必须重启 API 才生效；响应里的 `restart_required` 字段把这个事实明确告诉前端。
 * 写操作把操作者 id 从 request.user 透传给 service 落审计，绝不由客户端参数指定。
 */
@Controller('api/admin/content/packs')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminContentController {
  constructor(private readonly adminContentService: AdminContentService) {}

  /** 列出全部已编译 pack + 启用状态 + 重启提示 */
  @Get()
  list() {
    return this.adminContentService.list();
  }

  /** 停用影响面（只读）：供前端在确认停用前提示"会影响多少份存档" */
  @Get(':id/impact')
  impact(@Param('id') id: string) {
    return this.adminContentService.impact(id);
  }

  /** 启用 / 停用：落库 + 审计；响应标注"重启后生效" */
  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdatePackStateDto,
  ) {
    return this.adminContentService.setEnabled(user.id, id, dto.enabled);
  }
}
