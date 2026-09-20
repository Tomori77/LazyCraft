import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ContentModule } from '../content/content.module.js';
import { AdminShopController } from './admin-shop.controller.js';
import { AdminShopService } from './admin-shop.service.js';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminAuditService } from './admin-audit.service.js';

/**
 * 后台管理模块（task-24b / task-38）
 *
 * import AuthModule：JwtAuthGuard / AdminGuard 依赖 PassportModule 的注册；
 * import PrismaModule：直接读写 shop_entries / admin_audit_logs 表；
 * import ContentModule：条目引用校验必须对齐"引擎认识的内容"（Registry 快照）。
 *
 * 导出 AdminAuditService：task-39/40/41 的管理写操作统一复用它落审计，
 * 避免每个模块各写一份"失败不阻塞"的 try/catch。
 */
@Module({
  imports: [AuthModule, PrismaModule, ContentModule],
  controllers: [AdminShopController, AdminAuditController],
  providers: [AdminShopService, AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminModule {}
