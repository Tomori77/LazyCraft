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

  // 用于验证 AuthGuard 是否工作：无 token 应 401，有 token 返回当前登录账号信息
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@CurrentUser() user: { id: string; email: string }) {
    return user;
  }
}
