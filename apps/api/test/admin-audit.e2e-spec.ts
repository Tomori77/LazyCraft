// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
//
// 管理员账号取得方式同 admin-shop.e2e-spec.ts：把邮箱写进 ADMIN_EMAILS，
// 注册时 AccountsService 命中白名单即落库 role='admin'。
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';

let app: INestApplication<App>;

const ADMIN_EMAIL = `admin-audit-e2e-admin-${randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = `${process.env.ADMIN_EMAILS ?? ''},${ADMIN_EMAIL}`;

beforeAll(async () => {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.init();
});

afterAll(async () => {
  await app.close();
});

/** 返回 token + account id（审计要按操作者账号 id 断言） */
async function registerAndLogin(email: string) {
  const password = 'test-password-8';
  const username = `adminaudit_${randomUUID().slice(0, 8)}`;
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

// admin 邮箱只能注册一次，后续用例复用同一份凭据
let adminCredsPromise: Promise<{ token: string; accountId: string }> | undefined;
const adminCreds = () => (adminCredsPromise ??= registerAndLogin(ADMIN_EMAIL));
const playerCreds = () =>
  registerAndLogin(`admin-audit-e2e-player-${randomUUID()}@example.com`);

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('/api/admin/audit-logs (e2e)', () => {
  it('未登录访问 → 401', async () => {
    await request(app.getHttpServer()).get('/api/admin/audit-logs').expect(401);
  });

  it('普通账号（player）访问 → 403', async () => {
    const { token } = await playerCreds();
    await request(app.getHttpServer()).get('/api/admin/audit-logs').set(authed(token)).expect(403);
  });

  it('admin 可读审计列表（分页形状）', async () => {
    const { token } = await adminCreds();
    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-logs')
      .set(authed(token))
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.page).toBe('number');
    expect(typeof res.body.limit).toBe('number');
  });

  it('管理写操作（PATCH 商店条目）产生一条审计记录', async () => {
    const { token, accountId } = await adminCreds();

    // 先建一条，再改价/补库存——被审计的是 PATCH
    const id = `audit-e2e-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id, kind: 'item', item_id: 'wood', buy_price: 5, stock: 1 })
      .expect(201);

    const before = await request(app.getHttpServer())
      .get('/api/admin/audit-logs')
      .query({ target_type: 'shop_entry', target_id: id })
      .set(authed(token))
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/admin/shop/entries/${id}`)
      .set(authed(token))
      .send({ buy_price: 9, stock: 20 })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/api/admin/audit-logs')
      .query({ target_type: 'shop_entry', target_id: id })
      .set(authed(token))
      .expect(200);

    // 恰好新增一条（POST + PATCH 各一条，此处只看增量）
    expect(after.body.total).toBe((before.body.total as number) + 1);

    const record = (after.body.items as Array<Record<string, unknown>>).find(
      (row) => row.action === 'shop_entry.update',
    );
    expect(record).toBeTruthy();
    expect(record).toMatchObject({
      admin_account_id: accountId,
      action: 'shop_entry.update',
      target_type: 'shop_entry',
      target_id: id,
    });
    // detail 记了改前/改后：before.buy_price=5，after.buy_price=9
    const detail = record!.detail as { before: { buy_price: number }; after: { buy_price: number } };
    expect(detail.before.buy_price).toBe(5);
    expect(detail.after.buy_price).toBe(9);

    await request(app.getHttpServer()).delete(`/api/admin/shop/entries/${id}`).set(authed(token)).expect(200);
  });

  it('审计查询按 target_type 过滤生效', async () => {
    const { token } = await adminCreds();
    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-logs')
      .query({ target_type: 'shop_entry', limit: 100 })
      .set(authed(token))
      .expect(200);

    const items = res.body.items as Array<{ target_type: string }>;
    expect(items.length).toBeGreaterThan(0);
    for (const row of items) expect(row.target_type).toBe('shop_entry');
  });
});

describe('/api/player role (e2e, task-38)', () => {
  it('admin 账号 → role=admin；普通账号 → role=player', async () => {
    const admin = await adminCreds();
    const adminRes = await request(app.getHttpServer())
      .get('/api/player')
      .set(authed(admin.token))
      .expect(200);
    expect(adminRes.body.role).toBe('admin');

    const player = await playerCreds();
    const playerRes = await request(app.getHttpServer())
      .get('/api/player')
      .set(authed(player.token))
      .expect(200);
    expect(playerRes.body.role).toBe('player');
  });
});
