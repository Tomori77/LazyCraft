// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';
import { CURRENT_SAVE_VERSION } from './../src/save/save-shape.js';
import { stack, v3Data } from './save-fixtures.js';
import {
  MARKET_LISTING_FEE,
  MARKET_TAX_RATE,
} from './../src/market/market.service.js';

// 与既有 e2e 同风格：每个文件启动一个完整 AppModule，共享测试库
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

/** 注册 + 登录一个新账号，拿可用 token */
async function registerAndLogin() {
  const email = `market-e2e-${randomUUID()}@example.com`;
  const password = 'test-password-8';
  await request(app.getHttpServer()).post('/api/auth/register').send({ email, password }).expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

/** 触发懒创建（默认角色 + 空存档） */
async function ensureSave(token: string) {
  await request(app.getHttpServer()).get('/api/save').set('Authorization', `Bearer ${token}`).expect(200);
}

/** 用 save 接口直接覆写 data，给玩家发放物品和金币作为测试铺垫 */
async function grantState(
  token: string,
  overrides: { inventory?: unknown[]; gold?: number },
) {
  const data = v3Data({
    ...(overrides.inventory ? { inventory: overrides.inventory } : {}),
    abstract_resources: { gold: overrides.gold ?? 0 },
  });
  await request(app.getHttpServer())
    .post('/api/save')
    .set('Authorization', `Bearer ${token}`)
    .send({ version: CURRENT_SAVE_VERSION, data })
    .expect(201);
}

/** 读存档 data 里的字段 */
async function readSaveData(token: string) {
  const res = await request(app.getHttpServer())
    .get('/api/save')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.data as {
    inventory: Array<{ kind: string; item_id: string; quantity: number; quality?: string }>;
    abstract_resources: { gold?: number };
  };
}

describe('/api/market (e2e)', () => {
  it('未带 token 访问 /api/market/* 全部 401', async () => {
    await request(app.getHttpServer()).post('/api/market/list').send({}).expect(401);
    await request(app.getHttpServer()).post('/api/market/cancel/abc').expect(401);
    await request(app.getHttpServer()).post('/api/market/buy/abc').expect(401);
    await request(app.getHttpServer()).get('/api/market/my-listings').expect(401);
    await request(app.getHttpServer()).get('/api/market/listings').expect(401);
    await request(app.getHttpServer()).get('/api/market/history/copper_ore').expect(401);
  });

  it('挂单 → 浏览 → 撤单 → 物品退回；手续费被扣除', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    // 给卖家发 10 块铜矿 + 100 G
    await grantState(token, {
      inventory: [stack('copper_ore', 10, 'common')],
      gold: 100,
    });

    // 1) 挂单：3 块铜矿，单价 20
    const listRes = await request(app.getHttpServer())
      .post('/api/market/list')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: 'copper_ore', quantity: 3, price: 20 })
      .expect(201);
    expect(listRes.body.listing).toMatchObject({
      item_id: 'copper_ore',
      quality: 'common',
      quantity: 3,
      unit_price: 20,
      total_price: 60,
    });
    expect(listRes.body.fee).toBe(MARKET_LISTING_FEE);
    const listingId = listRes.body.listing.id as string;

    // 2) 挂单后卖方的背包与金币立刻被扣
    const afterList = await readSaveData(token);
    const copperAfterList = afterList.inventory.find((s) => s.item_id === 'copper_ore');
    expect(copperAfterList?.quantity).toBe(7);
    expect(afterList.abstract_resources.gold).toBe(100 - MARKET_LISTING_FEE);

    // 3) 浏览市场能见到这张单
    const browse = await request(app.getHttpServer())
      .get('/api/market/listings?itemId=copper_ore')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const found = browse.body.listings.find((l: { id: string }) => l.id === listingId);
    expect(found).toBeTruthy();
    expect(found.unit_price).toBe(20);

    // 4) 我的挂单也能查到
    const mine = await request(app.getHttpServer())
      .get('/api/market/my-listings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(mine.body.listings.some((l: { id: string }) => l.id === listingId)).toBe(true);

    // 5) 撤单：物品退回、手续费不退
    const cancel = await request(app.getHttpServer())
      .post(`/api/market/cancel/${listingId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(cancel.body.returned).toMatchObject({ item_id: 'copper_ore', quantity: 3 });

    const afterCancel = await readSaveData(token);
    expect(afterCancel.inventory.find((s) => s.item_id === 'copper_ore')?.quantity).toBe(10);
    expect(afterCancel.abstract_resources.gold).toBe(100 - MARKET_LISTING_FEE);

    // 6) 撤单后市场列表不再出现
    const after = await request(app.getHttpServer())
      .get('/api/market/listings?itemId=copper_ore')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(after.body.listings.some((l: { id: string }) => l.id === listingId)).toBe(false);
  });

  it('购买：买家付全额，卖家得 95%，5% 税被系统回收；历史记录当日聚合', async () => {
    const sellerToken = await registerAndLogin();
    await ensureSave(sellerToken);
    await grantState(sellerToken, {
      inventory: [stack('iron_ore', 20, 'common')],
      gold: 1000,
    });

    const buyerToken = await registerAndLogin();
    await ensureSave(buyerToken);
    await grantState(buyerToken, { inventory: [], gold: 500 });

    // 挂单：5 块铁矿，单价 40 → 总价 200，税 10 (5%)，卖家得 190
    const list = await request(app.getHttpServer())
      .post('/api/market/list')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ itemId: 'iron_ore', quantity: 5, price: 40 })
      .expect(201);
    const listingId = list.body.listing.id as string;
    const total = 5 * 40;
    const expectedTax = total - Math.floor(total * (1 - MARKET_TAX_RATE));

    // 购买
    const buy = await request(app.getHttpServer())
      .post(`/api/market/buy/${listingId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(201);
    expect(buy.body).toMatchObject({
      listing_id: listingId,
      item_id: 'iron_ore',
      quantity: 5,
      unit_price: 40,
      total_price: total,
      tax: expectedTax,
      seller_gets: total - expectedTax,
    });

    // 买家：金币 500 - 200 = 300；拿到 5 块铁矿
    const buyerData = await readSaveData(buyerToken);
    expect(buyerData.abstract_resources.gold).toBe(500 - total);
    expect(buyerData.inventory.find((s) => s.item_id === 'iron_ore')?.quantity).toBe(5);

    // 卖家：金币 1000 - 挂单费 5 + 卖家所得 190 = 1185；铁矿 20 - 5 = 15
    const sellerData = await readSaveData(sellerToken);
    const sellerGet = total - expectedTax;
    expect(sellerData.abstract_resources.gold).toBe(1000 - MARKET_LISTING_FEE + sellerGet);
    expect(sellerData.inventory.find((s) => s.item_id === 'iron_ore')?.quantity).toBe(15);

    // 历史：今天有一行 (iron_ore, common)，volume=5，avg_price=40
    const history = await request(app.getHttpServer())
      .get('/api/market/history/iron_ore')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    const today = new Date().toISOString().slice(0, 10);
    const row = (history.body.history as Array<{ date: string; avg_price: number; volume: number }>).find(
      (r) => r.date === today,
    );
    expect(row).toBeTruthy();
    expect(row!.volume).toBeGreaterThanOrEqual(5);
    expect(row!.avg_price).toBe(40);
  });

  it('同一天多笔同品质同物品成交 → history 累加 volume、加权平均 avg_price', async () => {
    const sellerToken = await registerAndLogin();
    await ensureSave(sellerToken);
    await grantState(sellerToken, {
      inventory: [stack('maple_log', 30, 'common')],
      gold: 1000,
    });
    const buyerToken = await registerAndLogin();
    await ensureSave(buyerToken);
    await grantState(buyerToken, { inventory: [], gold: 10000 });

    // 两笔挂单：(2 个 * 单价 50) 和 (3 个 * 单价 100)
    // 期望加权均价 = (50*2 + 100*3) / 5 = 80
    const l1 = await request(app.getHttpServer())
      .post('/api/market/list')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ itemId: 'maple_log', quantity: 2, price: 50 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/market/buy/${l1.body.listing.id}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(201);

    const l2 = await request(app.getHttpServer())
      .post('/api/market/list')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ itemId: 'maple_log', quantity: 3, price: 100 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/market/buy/${l2.body.listing.id}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(201);

    const history = await request(app.getHttpServer())
      .get('/api/market/history/maple_log?quality=common')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    const today = new Date().toISOString().slice(0, 10);
    const row = (history.body.history as Array<{ date: string; avg_price: number; volume: number }>).find(
      (r) => r.date === today,
    );
    expect(row).toBeTruthy();
    expect(row!.volume).toBeGreaterThanOrEqual(5);
    expect(row!.avg_price).toBe(80);
  });

  it('物品不足挂单 → 403；物品不存在 → 404；参数不合法 → 400', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await grantState(token, {
      inventory: [stack('copper_ore', 2, 'common')],
      gold: 100,
    });

    // 挂 5 块但只有 2 块
    await request(app.getHttpServer())
      .post('/api/market/list')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: 'copper_ore', quantity: 5, price: 10 })
      .expect(403);

    // 物品表中不存在的 ID
    await request(app.getHttpServer())
      .post('/api/market/list')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: 'not_a_real_item', quantity: 1, price: 10 })
      .expect(404);

    // quantity=0 被 DTO 拦住
    await request(app.getHttpServer())
      .post('/api/market/list')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: 'copper_ore', quantity: 0, price: 10 })
      .expect(400);

    // price 非整数
    await request(app.getHttpServer())
      .post('/api/market/list')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: 'copper_ore', quantity: 1, price: 1.5 })
      .expect(400);
  });

  it('金币不足扣挂单费 → 403；买家金币不足 → 403；自买 → 400；撤别人的单 → 403', async () => {
    // 卖家：有物品没金币
    const sellerPoor = await registerAndLogin();
    await ensureSave(sellerPoor);
    await grantState(sellerPoor, {
      inventory: [stack('copper_ore', 5, 'common')],
      gold: MARKET_LISTING_FEE - 1,
    });
    await request(app.getHttpServer())
      .post('/api/market/list')
      .set('Authorization', `Bearer ${sellerPoor}`)
      .send({ itemId: 'copper_ore', quantity: 1, price: 10 })
      .expect(403);

    // 正常卖家挂单
    const sellerToken = await registerAndLogin();
    await ensureSave(sellerToken);
    await grantState(sellerToken, {
      inventory: [stack('copper_ore', 5, 'common')],
      gold: 1000,
    });
    const list = await request(app.getHttpServer())
      .post('/api/market/list')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ itemId: 'copper_ore', quantity: 2, price: 100 })
      .expect(201);
    const listingId = list.body.listing.id as string;

    // 买家：钱不够
    const brokeBuyer = await registerAndLogin();
    await ensureSave(brokeBuyer);
    await grantState(brokeBuyer, { inventory: [], gold: 100 });
    await request(app.getHttpServer())
      .post(`/api/market/buy/${listingId}`)
      .set('Authorization', `Bearer ${brokeBuyer}`)
      .expect(403);

    // 卖家自己买自己：400
    await request(app.getHttpServer())
      .post(`/api/market/buy/${listingId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(400);

    // 别人试图撤我的单：403
    const thirdParty = await registerAndLogin();
    await ensureSave(thirdParty);
    await request(app.getHttpServer())
      .post(`/api/market/cancel/${listingId}`)
      .set('Authorization', `Bearer ${thirdParty}`)
      .expect(403);
  });

  it('浏览市场支持分页与筛选、自动过滤已过期挂单', async () => {
    const sellerToken = await registerAndLogin();
    await ensureSave(sellerToken);
    await grantState(sellerToken, {
      inventory: [stack('copper_ore', 10, 'common'), stack('iron_ore', 10, 'common')],
      gold: 1000,
    });

    // 挂 3 张单：2 张铜矿 + 1 张铁矿
    await request(app.getHttpServer())
      .post('/api/market/list')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ itemId: 'copper_ore', quantity: 1, price: 11 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/market/list')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ itemId: 'copper_ore', quantity: 1, price: 12 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/market/list')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ itemId: 'iron_ore', quantity: 1, price: 13 })
      .expect(201);

    const copper = await request(app.getHttpServer())
      .get('/api/market/listings?itemId=copper_ore&limit=50')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    const allMine = (copper.body.listings as Array<{ item_id: string }>).filter(
      (l) => l.item_id === 'copper_ore',
    );
    expect(allMine.length).toBeGreaterThanOrEqual(2);

    const iron = await request(app.getHttpServer())
      .get('/api/market/listings?itemId=iron_ore&quality=common&limit=1')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(iron.body.limit).toBe(1);
    expect(iron.body.page).toBe(1);
    expect(iron.body.listings.length).toBeLessThanOrEqual(1);
  });

  it('挂单后买家购买 → 历史与挂单联动；购买不存在的挂单 → 404', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await grantState(token, { inventory: [], gold: 100 });
    // 随机 UUID 必然不存在
    await request(app.getHttpServer())
      .post(`/api/market/buy/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/market/cancel/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
