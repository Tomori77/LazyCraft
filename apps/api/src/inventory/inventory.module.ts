import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SaveModule } from '../save/save.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

/**
 * 容器模块（task-24）
 *
 * import AuthModule（JwtAuthGuard 依赖 PassportModule）与 SaveModule
 * （借用其中的 prisma 句柄走事务行锁，与 market 模块同构）。
 */
@Module({
  imports: [AuthModule, SaveModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
