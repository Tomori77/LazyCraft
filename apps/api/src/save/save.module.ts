import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SaveController } from './save.controller.js';
import { SaveService } from './save.service.js';

/**
 * 存档模块
 *
 * 显式 import PrismaModule 而不是依赖全局注册，是为了让 SaveModule 可以被其它测试模块独立加载。
 * 必须 import AuthModule：JwtAuthGuard 是 AuthGuard('jwt') 的别名，运行时需要 PassportModule
 * 提供的 AuthModuleOptions（在 AuthModule 内通过 PassportModule.register 注册并 re-export）。
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SaveController],
  providers: [SaveService],
  exports: [SaveService],
})
export class SaveModule {}
