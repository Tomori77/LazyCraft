import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppConfigModule } from './../src/config/config.module.js';

// 只挂载 AppConfigModule 而非整个 AppModule：本测试只验收契约，且避免被其它并行 WIP 模块（SaveModule）的依赖问题传染
describe('ConfigController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppConfigModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/api/config (GET) 返回默认语言', async () => {
    const res = await request(app.getHttpServer()).get('/api/config').expect(200);
    expect(res.body).toEqual({ defaultLanguage: 'zh-CN' });
  });

  afterEach(async () => {
    await app.close();
  });
});
