// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
//
// 管理员账号的取得方式（可复现）：
//   1. 本文件在创建 TestModule 之前把唯一的邮箱写进 process.env.ADMIN_EMAILS；
//   2. AccountsService.create 在注册时调用 roleForEmail()（src/auth/admin-emails.ts），
//      命中白名单即把 role 落库为 'admin'；
//   3. 于是"注册该邮箱 → 登录 → 拿到的 token 就是 admin"。
//   ConfigModule.forRoot 默认不覆盖已存在的 process.env，故此处设置一定生效。
//   生产环境同理：把邮箱写进根目录 .env 的 ADMIN_EMAILS；已有账号提权走
//   UPDATE accounts SET role='admin' WHERE email='...'（不提供公开提权接口）。
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';

let app: INestApplication<App>;

const ADMIN_EMAIL = `admin-shop-e2e-admin-${randomUUID()}@example.com`;
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

async function registerAndLogin(email: string) {
  const password = 'test-password-8';
  await request(app.getHttpServer()).post('/api/auth/register').send({ email, password }).expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

// admin 邮箱只能注册一次（重复注册返回 409），因此复用首次登录的 token
let adminTokenPromise: Promise<string> | undefined;
const adminToken = () => (adminTokenPromise ??= registerAndLogin(ADMIN_EMAIL));
const playerToken = () => registerAndLogin(`admin-shop-e2e-player-${randomUUID()}@example.com`);

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('/api/admin/shop/entries (e2e)', () => {
  it('未登录访问全部 401', async () => {
    await request(app.getHttpServer()).get('/api/admin/shop/entries').expect(401);
    await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .send({ id: 'x', kind: 'item', item_id: 'wood', buy_price: 1 })
      .expect(401);
    await request(app.getHttpServer()).patch('/api/admin/shop/entries/x').send({ stock: 1 }).expect(401);
    await request(app.getHttpServer()).delete('/api/admin/shop/entries/x').expect(401);
  });

  it('普通账号（player）访问管理接口返回 403', async () => {
    const token = await playerToken();
    await request(app.getHttpServer()).get('/api/admin/shop/entries').set(authed(token)).expect(403);
    await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id: 'x', kind: 'item', item_id: 'wood', buy_price: 1 })
      .expect(403);
  });

  it('admin 列出全部条目（含未上架）', async () => {
    const token = await adminToken();
    const res = await request(app.getHttpServer())
      .get('/api/admin/shop/entries')
      .set(authed(token))
      .expect(200);
    const list = res.body as Array<{ id: string; listed: boolean; sort_order: number }>;
    expect(Array.isArray(list)).toBe(true);
    // seed 条目至少包含木头，且管理视图带 listed/sort_order
    const wood = list.find((e) => e.id === 'shop_wood')!;
    expect(wood).toBeTruthy();
    expect(typeof wood.listed).toBe('boolean');
    expect(typeof wood.sort_order).toBe('number');
  });

  it('admin 新增条目 → 返回更新后的条目', async () => {
    const token = await adminToken();
    const id = `admin-e2e-${randomUUID()}`;
    const res = await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id, kind: 'item', item_id: 'wood', buy_price: 7, sell_price: 2, stock: 5, sort_order: 123 })
      .expect(201);
    expect(res.body).toMatchObject({
      id,
      kind: 'item',
      item_id: 'wood',
      template_id: null,
      buy_price: 7,
      sell_price: 2,
      stock: 5,
      listed: true,
      sort_order: 123,
    });

    await request(app.getHttpServer()).delete(`/api/admin/shop/entries/${id}`).set(authed(token)).expect(200);
  });

  it('admin 新增装备条目（合法模板）成功', async () => {
    const token = await adminToken();
    const id = `admin-e2e-eq-${randomUUID()}`;
    const res = await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id, kind: 'equipment', template_id: 'short_sword', quality: 'common', buy_price: 60 })
      .expect(201);
    expect(res.body).toMatchObject({ kind: 'equipment', template_id: 'short_sword', item_id: null });
    await request(app.getHttpServer()).delete(`/api/admin/shop/entries/${id}`).set(authed(token)).expect(200);
  });

  it('新增无效引用被拒：未注册 item_id / template_id / 缺引用字段', async () => {
    const token = await adminToken();
    // 不存在的 item_id
    await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id: `bad-${randomUUID()}`, kind: 'item', item_id: 'no_such_item', buy_price: 1 })
      .expect(400);
    // 不存在的 template_id
    await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id: `bad-${randomUUID()}`, kind: 'equipment', template_id: 'no_such_template', buy_price: 1 })
      .expect(400);
    // kind=item 却没给 item_id
    await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id: `bad-${randomUUID()}`, kind: 'item', buy_price: 1 })
      .expect(400);
  });

  it('DTO 校验：kind 非法 / stock < -1 / buy_price 为负 → 400', async () => {
    const token = await adminToken();
    await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id: `bad-${randomUUID()}`, kind: 'spell', item_id: 'wood', buy_price: 1 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id: `bad-${randomUUID()}`, kind: 'item', item_id: 'wood', buy_price: 1, stock: -2 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id: `bad-${randomUUID()}`, kind: 'item', item_id: 'wood', buy_price: -1 })
      .expect(400);
  });

  it('admin 可改价 / 补库存 / 上下架 / 排序，且返回更新后条目', async () => {
    const token = await adminToken();
    const id = `admin-e2e-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id, kind: 'item', item_id: 'wood', buy_price: 5, stock: 0 })
      .expect(201);

    const patched = await request(app.getHttpServer())
      .patch(`/api/admin/shop/entries/${id}`)
      .set(authed(token))
      .send({ buy_price: 9, stock: 20, listed: false, sort_order: 77 })
      .expect(200);
    expect(patched.body).toMatchObject({ buy_price: 9, stock: 20, listed: false, sort_order: 77 });

    // 下架后不出现在 C 端商店
    const player = await playerToken();
    const shopRes = await request(app.getHttpServer()).get('/api/shop').set(authed(player)).expect(200);
    expect((shopRes.body as Array<{ id: string }>).some((e) => e.id === id)).toBe(false);

    await request(app.getHttpServer()).delete(`/api/admin/shop/entries/${id}`).set(authed(token)).expect(200);
  });

  it('admin 删除条目后 C 端不可见；删除不存在条目 → 404', async () => {
    const token = await adminToken();
    const id = `admin-e2e-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id, kind: 'item', item_id: 'wood', buy_price: 5 })
      .expect(201);

    const player = await playerToken();
    const before = await request(app.getHttpServer()).get('/api/shop').set(authed(player)).expect(200);
    expect((before.body as Array<{ id: string }>).some((e) => e.id === id)).toBe(true);

    await request(app.getHttpServer()).delete(`/api/admin/shop/entries/${id}`).set(authed(token)).expect(200);

    const after = await request(app.getHttpServer()).get('/api/shop').set(authed(player)).expect(200);
    expect((after.body as Array<{ id: string }>).some((e) => e.id === id)).toBe(false);

    await request(app.getHttpServer())
      .delete(`/api/admin/shop/entries/${randomUUID()}`)
      .set(authed(token))
      .expect(404);
  });

  it('admin 新增重复 id → 409', async () => {
    const token = await adminToken();
    const id = `admin-e2e-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id, kind: 'item', item_id: 'wood', buy_price: 5 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/admin/shop/entries')
      .set(authed(token))
      .send({ id, kind: 'item', item_id: 'wood', buy_price: 6 })
      .expect(409);
    await request(app.getHttpServer()).delete(`/api/admin/shop/entries/${id}`).set(authed(token)).expect(200);
  });

  it('PATCH 不存在条目 → 404', async () => {
    const token = await adminToken();
    await request(app.getHttpServer())
      .patch(`/api/admin/shop/entries/${randomUUID()}`)
      .set(authed(token))
      .send({ stock: 1 })
      .expect(404);
  });
});
