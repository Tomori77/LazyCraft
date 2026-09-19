import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ContentModule } from '../content/content.module.js';
import { AdminShopController } from './admin-shop.controller.js';
import { AdminShopService } from './admin-shop.service.js';

/**
 * 后台管理模块（task-24b）
 *
 * import AuthModule：JwtAuthGuard / AdminGuard 依赖 PassportModule 的注册；
 * import PrismaModule：直接读写 shop_entries 表；
 * import ContentModule：条目引用校验必须对齐"引擎认识的内容"（Registry 快照）。
 */
@Module({
  imports: [AuthModule, PrismaModule, ContentModule],
  controllers: [AdminShopController],
  providers: [AdminShopService],
})
export class AdminModule {}
