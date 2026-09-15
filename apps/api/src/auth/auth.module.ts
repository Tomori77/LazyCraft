import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccountsService } from './accounts.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PrismaModule } from '../prisma/prisma.module.js';

// 该模块把 Passport/Guard/JwtStrategy 捆绑导出，让上层模块可以直接用 JwtAuthGuard
@Module({
  imports: [
    // 读取根目录 .env，让 JWT_SECRET / AUTH_DB_URL 等环境变量进入 process.env
    ConfigModule.forRoot({ envFilePath: '../../.env', isGlobal: true }),
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'lazycraft-dev-secret',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AccountsService, JwtStrategy, JwtAuthGuard],
  exports: [JwtAuthGuard, PassportModule],
})
export class AuthModule {}