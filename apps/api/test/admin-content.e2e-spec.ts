// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库。
//
// 管理员账号取得方式同 admin-shop.e2e-spec.ts：把邮箱写进 ADMIN_EMAILS，
// 注册时 AccountsService 命中白名单即落库 role='admin'。
//
// 重要：本文件会写 content_pack_state 表。测试结束必须恢复 core 为启用，
// 否则同一测试库里其它挂 AppModule 的 e2e 会因为内容缺失而失败。
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';
import { PrismaClient } from './../src/lib/prisma-client/client.js';

let app: INestApplication<App>;
let prisma: PrismaClient;

const ADMIN_EMAIL = `admin-content-e2e-admin-${randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = `${process.env.ADMIN_EMAILS ?? ''},${ADMIN_EMAIL}`;

beforeAll(async () => {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.init();
  prisma = app.get(PrismaClient);
});

afterAll(async () => {
  // 兜底恢复：无论用例怎么失败，都别把 core 停用状态留在共享测试库里
  await prisma.contentPackState.upsert({
    where: { id: 'core' },
    create: { id: 'core', enabled: true },
    update: { enabled: true },
  });
  await app.close();
});

async function registerAndLogin(email: string) {
  const password = 'test-password-8';
  const username = `adminc_${randomUUID().slice(0, 8)}`;
  const registered = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ username, email, password })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return {
    token: res.body.accessToken as string,
    accountId: registered.body.account.id as string,
  };
}

let adminCredsPromise: Promise<{ token: string; accountId: string }> | undefined;
const adminCreds = () => (adminCredsPromise ??= registerAndLogin(ADMIN_EMAIL));
const playerToken = () =>
  registerAndLogin(`admin-content-e2e-player-${randomUUID()}@example.com`).then((c) => c.token);

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('/api/admin/content/packs (e2e)', () => {
  it('未登录访问 → 401', async () => {
    await request(app.getHttpServer()).get('/api/admin/content/packs').expect(401);
    await request(app.getHttpServer())
      .patch('/api/admin/content/packs/core')
      .send({ enabled: false })
      .expect(401);
  });

  it('普通账号（player）访问 → 403', async () => {
    const token = await playerToken();
    await request(app.getHttpServer())
      .get('/api/admin/content/packs')
      .set(authed(token))
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/admin/content/packs/core')
      .set(authed(token))
      .send({ enabled: false })
      .expect(403);
  });

  it('admin 列出全部已编译 pack + 启用状态 + 重启提示字段', async () => {
    const { token } = await adminCreds();
    const res = await request(app.getHttpServer())
      .get('/api/admin/content/packs')
      .set(authed(token))
      .expect(200);

    const list = res.body as Array<{
      id: string;
      name: string;
      version: string;
      enabled: boolean;
      active: boolean;
      restart_required: boolean;
    }>;
    expect(Array.isArray(list)).toBe(true);

    const core = list.find((pack) => pack.id === 'core')!;
    expect(core).toBeTruthy();
    expect(core.name).toBe('核心内容包');
    expect(core.version).toBe('0.1.0');
    expect(typeof core.enabled).toBe('boolean');
    expect(typeof core.active).toBe('boolean');
    expect(typeof core.restart_required).toBe('boolean');
  });

  it('PATCH 非法 pack id → 404', async () => {
    const { token } = await adminCreds();
    await request(app.getHttpServer())
      .patch(`/api/admin/content/packs/${randomUUID()}`)
      .set(authed(token))
      .send({ enabled: false })
      .expect(404);
  });

  it('DTO 校验：enabled 非布尔 → 400', async () => {
    const { token } = await adminCreds();
    await request(app.getHttpServer())
      .patch('/api/admin/content/packs/core')
      .set(authed(token))
      .send({ enabled: 'yes' })
      .expect(400);
  });

  it('admin 停用 core：落库、标记 restart_required（当前进程仍 active）', async () => {
    const { token } = await adminCreds();
    const res = await request(app.getHttpServer())
      .patch('/api/admin/content/packs/core')
      .set(authed(token))
      .send({ enabled: false })
      .expect(200);

    expect(res.body).toMatchObject({ id: 'core', enabled: false });
    // 未重启：当前进程快照里 core 仍注册着 → active=true 且需要重启
    expect(res.body.active).toBe(true);
    expect(res.body.restart_required).toBe(true);

    // 再次 GET：持久化状态已是 false
    const list = await request(app.getHttpServer())
      .get('/api/admin/content/packs')
      .set(authed(token))
      .expect(200);
    const core = (list.body as Array<{ id: string; enabled: boolean }>).find((p) => p.id === 'core')!;
    expect(core.enabled).toBe(false);

    // 恢复（后续用例 + 其它 e2e 依赖 core 启用）
    await request(app.getHttpServer())
      .patch('/api/admin/content/packs/core')
      .set(authed(token))
      .send({ enabled: true })
      .expect(200);
  });

  it('停用写操作进审计（action=content_pack.disable，target=core）', async () => {
    const { token, accountId } = await adminCreds();

    await request(app.getHttpServer())
      .patch('/api/admin/content/packs/core')
      .set(authed(token))
      .send({ enabled: false })
      .expect(200);

    const audit = await request(app.getHttpServer())
      .get('/api/admin/audit-logs')
      .query({ target_type: 'content_pack', target_id: 'core', limit: 100 })
      .set(authed(token))
      .expect(200);

    const record = (audit.body.items as Array<Record<string, unknown>>).find(
      (row) => row.action === 'content_pack.disable',
    );
    expect(record).toBeTruthy();
    expect(record).toMatchObject({
      admin_account_id: accountId,
      action: 'content_pack.disable',
      target_type: 'content_pack',
      target_id: 'core',
    });
    expect((record!.detail as { restart_required: boolean }).restart_required).toBe(true);

    // 恢复
    await request(app.getHttpServer())
      .patch('/api/admin/content/packs/core')
      .set(authed(token))
      .send({ enabled: true })
      .expect(200);
  });

  it('GET :id/impact 返回只读影响统计（不修改任何存档）', async () => {
    const { token } = await adminCreds();
    const res = await request(app.getHttpServer())
      .get('/api/admin/content/packs/core/impact')
      .set(authed(token))
      .expect(200);

    expect(typeof res.body.affected_saves).toBe('number');
    expect(Array.isArray(res.body.affected_actions)).toBe(true);
    expect(res.body.affected_actions).toContain('mine_tiny_vein');
    expect(Array.isArray(res.body.sampled_items)).toBe(true);
  });

  it('GET 非法 id 的 impact → 404', async () => {
    const { token } = await adminCreds();
    await request(app.getHttpServer())
      .get(`/api/admin/content/packs/${randomUUID()}/impact`)
      .set(authed(token))
      .expect(404);
  });
});
