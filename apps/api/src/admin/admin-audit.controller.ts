import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { AdminAuditService } from './admin-audit.service.js';

/**
 * 审计日志查询接口（task-38）——管理后台「审计」页签的数据源。
 *
 * 只读：审计本身不可被管理接口改写/删除（那是历史凭证，不是业务数据）。
 * 鉴权：与商店管理同一双 Guard（未登录 401 / 非 admin 403）。
 */
@Controller('api/admin/audit-logs')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminAuditController {
  constructor(private readonly adminAuditService: AdminAuditService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('target_type') targetType?: string,
    @Query('target_id') targetId?: string,
    @Query('action') action?: string,
  ) {
    // query 全是字符串：在这里转成数字并夹取合法范围，service 只认已归一化的入参
    const parsedPage = Number.parseInt(page ?? '', 10);
    const parsedLimit = Number.parseInt(limit ?? '', 10);
    return this.adminAuditService.list({
      page: Number.isFinite(parsedPage) ? parsedPage : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      targetType: targetType || undefined,
      targetId: targetId || undefined,
      action: action || undefined,
    });
  }
}
