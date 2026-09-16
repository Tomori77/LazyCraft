// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';

// 与 quest/save e2e 同一风格：每个测试文件一个应用实例，共享数据库连接
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

/** 便捷：注册 + 登录一个新账号，直接拿到可用 token */
async function registerAndLogin() {
  const email = `broadcast-e2e-${randomUUID()}@example.com`;
  const password = 'test-password-8';
  await request(app.getHttpServer()).post('/api/auth/register').send({ email, password }).expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

/**
 * 稳定触发"装备词条 + epic 品质"的确定性 rng 序列：
 *   rng0=0.99：选词条 cursor = 0.99 × 100 = 99 → 命中 short_sword（weight 5, 区间 [95,100)）
 *   rng1=0.99：quality cursor = 0.99 × 30 = 29.7 → 命中 epic（区间 [28,30)）
 *   rng2/3=0.5：prefix/suffix 词缀任意命中
 */
const EPIC_EQUIP_RNG_SEQUENCE = [0.99, 0.99, 0.5, 0.5];

/** 用注入的 rng 序列调一次 simulate，断言触发了 epic 广播并返回 */
async function simulateOnceDeterministic(token: string) {
  const res = await request(app.getHttpServer())
    .post('/api/broadcasts/simulate')
    .set('Authorization', `Bearer ${token}`)
    .send({ monsterId: 'chicken', rngSequence: EPIC_EQUIP_RNG_SEQUENCE })
    .expect(201);
  expect(res.body.broadcast).toBeTruthy();
  return res.body.broadcast as {
    id: string;
    type: string;
    playerId: string;
    itemId: string;
    quality: string;
    createdAt: string;
  };
}

describe('/api/broadcasts (e2e)', () => {
  it('GET /api/broadcasts 不需要登录即可读取', async () => {
    const res = await request(app.getHttpServer()).get('/api/broadcasts').expect(200);
    expect(Array.isArray(res.body.broadcasts)).toBe(true);
  });

  it('POST /api/broadcasts/simulate 必须带 JWT', async () => {
    await request(app.getHttpServer())
      .post('/api/broadcasts/simulate')
      .send({ monsterId: 'chicken' })
      .expect(401);
  });

  it('simulate 参数校验：monsterId 缺失/为空 → 400', async () => {
    const token = await registerAndLogin();
    await request(app.getHttpServer())
      .post('/api/broadcasts/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/broadcasts/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ monsterId: '' })
      .expect(400);
  });

  it('simulate 不存在的怪物 → 404', async () => {
    const token = await registerAndLogin();
    await request(app.getHttpServer())
      .post('/api/broadcasts/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ monsterId: 'no_such_monster' })
      .expect(404);
  });

  it('稀有掉落（epic）触发后，GET /api/broadcasts 包含该记录', async () => {
    const token = await registerAndLogin();

    // 注入确定性 rng 稳定走"装备词条 + epic 品质"
    const broadcast = await simulateOnceDeterministic(token);
    expect(broadcast.type).toBe('loot_drop');
    expect(broadcast.quality).toBe('epic');
    expect(broadcast.itemId).toBe('short_sword');
    expect(typeof broadcast.playerId).toBe('string');
    expect(typeof broadcast.createdAt).toBe('string');

    // 公开列表里能看到刚写入的这条
    const list = await request(app.getHttpServer()).get('/api/broadcasts').expect(200);
    const found = (list.body.broadcasts as Array<{ id: string }>).find((b) => b.id === broadcast.id);
    expect(found).toBeTruthy();
    expect(found).toMatchObject({
      type: 'loot_drop',
      itemId: 'short_sword',
      quality: 'epic',
      playerId: broadcast.playerId,
    });
  });

  it('GET /api/broadcasts?limit=N 支持截断；按 created_at 倒序', async () => {
    const token = await registerAndLogin();
    // 造两条广播，后写入的应排前面
    const first = await simulateOnceDeterministic(token);
    // 等待至少 1ms 保证 createdAt 可区分
    await new Promise((r) => setTimeout(r, 5));
    const second = await simulateOnceDeterministic(token);

    const res = await request(app.getHttpServer())
      .get('/api/broadcasts?limit=10')
      .expect(200);
    expect(res.body.broadcasts.length).toBeGreaterThanOrEqual(2);

    const ids = (res.body.broadcasts as Array<{ id: string }>).map((b) => b.id);
    const idxFirst = ids.indexOf(first.id);
    const idxSecond = ids.indexOf(second.id);
    expect(idxFirst).toBeGreaterThanOrEqual(0);
    expect(idxSecond).toBeGreaterThanOrEqual(0);
    // 后写入的应排在更前（desc）
    expect(idxSecond).toBeLessThan(idxFirst);
  });

  it('GET /api/broadcasts?limit=非数字 不报错，回退默认值', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/broadcasts?limit=abc')
      .expect(200);
    expect(Array.isArray(res.body.broadcasts)).toBe(true);
  });

  it('命中非稀有掉落（羽毛=材料词条恒 common）时不生成广播', async () => {
    const token = await registerAndLogin();
    // rng0=0.1：选词条 cursor = 0.1 × 100 = 10 → 命中 feather（weight 80）
    // rng1 数量抽取
    const res = await request(app.getHttpServer())
      .post('/api/broadcasts/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ monsterId: 'chicken', rngSequence: [0.1, 0.5] })
      .expect(201);
    expect(res.body.broadcast).toBeNull();
    expect(res.body.loot).toMatchObject({ kind: 'item', item_id: 'feather' });
  });

  it('命中装备但品质未达 epic 时不生成广播', async () => {
    const token = await registerAndLogin();
    // rng0=0.99：命中 short_sword；rng1=0.1：quality cursor = 0.1 × 30 = 3 → uncommon [0,20)
    const res = await request(app.getHttpServer())
      .post('/api/broadcasts/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ monsterId: 'chicken', rngSequence: [0.99, 0.1, 0.5, 0.5] })
      .expect(201);
    expect(res.body.broadcast).toBeNull();
    expect(res.body.loot?.kind).toBe('equipment');
    expect(res.body.loot?.equipment?.quality).toBe('uncommon');
  });
});
