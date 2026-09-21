import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    })
      // 本单测只验证 getHello()，鉴权链由 e2e 覆盖；隔离 Guard 以免依赖 AuthModuleOptions
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('应返回服务运行状态', () => {
      expect(appController.getHello()).toContain('运行中');
    });
  });

  // 探活路由不得挂 Guard：compose healthcheck 无凭据，若需鉴权会恒失败
  describe('health', () => {
    it('应返回 ok 与运行信息', () => {
      const health = appController.getHealth();
      expect(health.status).toBe('ok');
      expect(typeof health.uptime).toBe('number');
      expect(typeof health.version).toBe('string');
    });
  });
});
