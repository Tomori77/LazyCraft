import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { CurrentUser } from './auth/current-user.decorator.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // 无鉴权：compose healthcheck 是无凭据探测，且 main.ts 未设全局前缀，故路径就是 /health
  @Get('health')
  getHealth(): { status: string; uptime: number; version: string } {
    return this.appService.getHealth();
  }

  // 用于验证 AuthGuard 是否工作：无 token 应 401，有 token 返回当前登录账号信息
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@CurrentUser() user: { id: string; email: string }) {
    return user;
  }
}
