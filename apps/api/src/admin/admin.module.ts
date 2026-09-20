import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ContentModule } from '../content/content.module.js';
import { ContentPackStateModule } from '../content/content-pack-state.module.js';
import { AdminShopController } from './admin-shop.controller.js';
import { AdminShopService } from './admin-shop.service.js';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminPlayerController } from './admin-player.controller.js';
import { AdminPlayerService } from './admin-player.service.js';
import { AdminContentController } from './admin-content.controller.js';
import { AdminContentService } from './admin-content.service.js';

/**
 * 后台管理模块（task-24b / task-38 / task-41）
 *
 * import AuthModule：JwtAuthGuard / AdminGuard 依赖 PassportModule 的注册；
 * import PrismaModule：直接读写 shop_entries / admin_audit_logs 等表；
 * import ContentModule：条目引用校验必须对齐"引擎认识的内容"（Registry 快照）；
 * import ContentPackStateModule：task-41 的 pack 启停开关读写（显式声明比依赖全局可见性更易读）。
 *
 * 导出 AdminAuditService：task-39/40/41 的管理写操作统一复用它落审计，
 * 避免每个模块各写一份"失败不阻塞"的 try/catch。
 */
@Module({
  imports: [AuthModule, PrismaModule, ContentModule, ContentPackStateModule],
  controllers: [
    AdminShopController,
    AdminAuditController,
    AdminPlayerController,
    AdminContentController,
  ],
  providers: [AdminShopService, AdminAuditService, AdminPlayerService, AdminContentService],
  exports: [AdminAuditService],
})
export class AdminModule {}
