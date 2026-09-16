import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SaveModule } from '../save/save.module.js';
import { MarketController } from './market.controller.js';
import { MarketService } from './market.service.js';

/**
 * 市场模块（task-15）
 *
 * 必须 import AuthModule 和 SaveModule：
 *   - AuthModule 提供 Passport/JwtAuthGuard 的运行时注册；
 *   - SaveModule 提供 SaveService，市场服务直接借用其中的 prisma 句柄
 *     和角色定位逻辑，避免重复建立 PrismaClient 连接。
 *
 * 为什么市场不复用 SaveService.write：
 *   SaveService 的整份覆盖（CAS）模型无法表达"挂单 + 双方存档"三方原子性；
 *   市场操作必须是 Prisma.$transaction 里的行级锁。
 */
@Module({
  imports: [AuthModule, SaveModule],
  controllers: [MarketController],
  providers: [MarketService],
})
export class MarketModule {}
