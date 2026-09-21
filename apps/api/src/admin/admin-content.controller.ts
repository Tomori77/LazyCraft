import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AdminContentService } from './admin-content.service.js';
// 普通 import：class-validator 需要设计类型元数据，见 inventory.controller.ts 的说明
import { UpdatePackStateDto } from './dto/admin-content.dto.js';

/**
 * 内容包（DLC）管理 HTTP 接口（task-41 / task-42）。
 *
 * 鉴权双 Guard：JwtAuthGuard 先鉴定身份（无 token → 401），
 * AdminGuard 再判角色（非 admin → 403）。
 *
 * 语义：PATCH 只翻转"落盘开关"，不自动换内存快照；`POST reload` 才按最新开关
 * 重建快照并中断引用已停用内容的动作（响应里的 `restart_required` 表示"待应用重载"）。
 * 写操作把操作者 id 从 request.user 透传给 service 落审计，绝不由客户端参数指定。
 */
@Controller('api/admin/content/packs')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminContentController {
  constructor(private readonly adminContentService: AdminContentService) {}

  /** 列出全部已编译 pack + 启用状态 + 待应用重载提示 */
  @Get()
  list() {
    return this.adminContentService.list();
  }

  /** 停用影响面（只读）：供前端在确认停用前提示"会影响多少份存档" */
  @Get(':id/impact')
  impact(@Param('id') id: string) {
    return this.adminContentService.impact(id);
  }

  /** 启用 / 停用：落库 + 审计；响应里的 restart_required 表示"待点应用重载" */
  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdatePackStateDto,
  ) {
    return this.adminContentService.setEnabled(user.id, id, dto.enabled);
  }
}

/**
 * 内容重载接口（task-42）。
 *
 * 为什么单独一个 Controller 而不是挂在 packs 下？
 *   重载作用于**整个内容集合**（一次重载全部 pack 的启停结果），不是某个 pack 的子资源；
 *   路由 `POST /api/admin/content/reload` 表达的是"对 /api/admin/content 这个资源做动作"，
 *   语义比 `/packs/reload` 更准确，且不会与 `PATCH /packs/:id` 的路径参数产生歧义。
 */
@Controller('api/admin/content')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminContentReloadController {
  constructor(private readonly adminContentService: AdminContentService) {}

  /** 按最新落盘启用集合重建内存快照 + 中断引用已停用内容的动作 + 落审计 */
  @Post('reload')
  reload(@CurrentUser() user: { id: string }) {
    return this.adminContentService.reload(user.id);
  }
}
