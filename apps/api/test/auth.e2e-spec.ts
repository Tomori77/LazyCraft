// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';

// 每个测试文件一个应用实例即可，数据库连接在 module 内部共享
let app: INestApplication<App>;

beforeAll(async () => {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('/api/auth (e2e)', () => {
  const email = `auth-e2e-${randomUUID()}@example.com`;
  const password = 'test-password-8';
  let accessToken: string;

  it('注册成功返回账号且无密码哈希', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password })
      .expect(201);

    expect(res.body).toMatchObject({
      account: {
        id: expect.any(String),
        email,
      },
    });
    // 密码哈希绝不能出现在响应里
    expect(res.body.account).not.toHaveProperty('passwordHash');
  });

  it('重复注册同邮箱返回 409', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send({ email, password }).expect(409);
  });

  it('登录成功返回 JWT token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);

    expect(res.body.accessToken).toBeTruthy();
    expect(typeof res.body.accessToken).toBe('string');
    accessToken = res.body.accessToken;
  });

  it('未带 token 访问受保护接口返回 401', async () => {
    await request(app.getHttpServer()).get('/profile').expect(401);
  });

  it('带 JWT 访问受保护接口返回账号信息', async () => {
    const res = await request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toMatchObject({ email });
    expect(res.body).toHaveProperty('id');
  });
});