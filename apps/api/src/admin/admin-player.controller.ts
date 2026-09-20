import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AdminPlayerService } from './admin-player.service.js';
// 普通 import：class-validator 需要设计类型元数据，见 inventory.controller.ts 的说明
import {
  GrantItemsDto,
  GrantResourcesDto,
  ResetStateDto,
  UpdateBanDto,
  UpdateRoleDto,
} from './dto/admin-player.dto.js';

/**
 * 玩家管理 HTTP 接口（task-40）。
 *
 * 鉴权双 Guard：JwtAuthGuard 先鉴定身份（无 token → 401），AdminGuard 再判角色（非 admin → 403）。
 * 所有写操作把操作者 id 从 request.user 透传给 service 落审计，**绝不由客户端参数指定**。
 *
 * 路由刻意用**动词式子资源**（/role、/ban、/grant-items…）而不是通用 PATCH /players/:id：
 * 修改玩家数据必须走专用发放接口（服务器校验 + 审计），
 * 若暴露"通用改存档"入口，就等于把裸改 JSONB 的能力开给了后台。
 */
@Controller('api/admin/players')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminPlayerController {
  constructor(private readonly adminPlayerService: AdminPlayerService) {}

  @Get()
  list(
    @Query('query') query?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // query 全是字符串：在这里转数并交给 service 夹取范围，service 只认已归一化入参
    return this.adminPlayerService.list({
      query: query || undefined,
      page: parseIntOrUndefined(page),
      limit: parseIntOrUndefined(limit),
    });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.adminPlayerService.detail(id);
  }

  @Patch(':id/role')
  updateRole(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.adminPlayerService.updateRole(user.id, id, dto.role);
  }

  @Patch(':id/ban')
  updateBan(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateBanDto,
  ) {
    return this.adminPlayerService.updateBan(user.id, id, dto.banned);
  }

  @Post(':id/grant-items')
  grantItems(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: GrantItemsDto,
  ) {
    return this.adminPlayerService.grantItems(user.id, id, dto);
  }

  @Post(':id/grant-resources')
  grantResources(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: GrantResourcesDto,
  ) {
    return this.adminPlayerService.grantResources(user.id, id, dto);
  }

  @Post(':id/reset-state')
  resetState(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: ResetStateDto,
  ) {
    return this.adminPlayerService.resetState(user.id, id, dto);
  }
}

/** query 参数转整数：非数字/空串按"未传"处理，让 service 用默认值 */
function parseIntOrUndefined(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
