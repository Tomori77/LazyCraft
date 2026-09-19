// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { SHOP_ENTRY_COPPER_ORE, SHOP_ENTRY_SHORT_SWORD, SHOP_ENTRY_WOOD } from '@lazycraft/shared';
import { AppModule } from './../src/app.module.js';
import { CURRENT_SAVE_VERSION, type SaveDataV3 } from './../src/save/save-shape.js';
import { equipment, stack, v3Data } from './save-fixtures.js';

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

async function registerAndLogin() {
  const email = `shop-e2e-${randomUUID()}@example.com`;
  const password = 'test-password-8';
  await request(app.getHttpServer()).post('/api/auth/register').send({ email, password }).expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

async function ensureSave(token: string) {
  await request(app.getHttpServer()).get('/api/save').set('Authorization', `Bearer ${token}`).expect(200);
}

async function writeData(token: string, data: SaveDataV3) {
  await request(app.getHttpServer())
    .post('/api/save')
    .set('Authorization', `Bearer ${token}`)
    .send({ version: CURRENT_SAVE_VERSION, data })
    .expect(201);
}

async function readData(token: string): Promise<SaveDataV3> {
  const res = await request(app.getHttpServer())
    .get('/api/save')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.data as SaveDataV3;
}

const buy = (token: string, entry_id: string, quantity: number) =>
  request(app.getHttpServer())
    .post('/api/shop/buy')
    .set('Authorization', `Bearer ${token}`)
    .send({ entry_id, quantity });

const sell = (token: string, uid: string, quantity: number) =>
  request(app.getHttpServer())
    .post('/api/shop/sell')
    .set('Authorization', `Bearer ${token}`)
    .send({ uid, quantity });

describe('/api/shop (e2e)', () => {
  it('未带 token 访问全部 401', async () => {
    await request(app.getHttpServer()).get('/api/shop').expect(401);
    await request(app.getHttpServer()).post('/api/shop/buy').send({}).expect(401);
    await request(app.getHttpServer()).post('/api/shop/sell').send({}).expect(401);
  });

  it('GET /api/shop：返回条目带 affordable/unlocked（基于当前存档）', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await writeData(token, v3Data({ abstract_resources: { gold: 0 } }));

    const res = await request(app.getHttpServer())
      .get('/api/shop')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const list = res.body as Array<{ id: string; affordable: boolean; unlocked: boolean }>;
    expect(Array.isArray(list)).toBe(true);
    const wood = list.find((e) => e.id === SHOP_ENTRY_WOOD.id)!;
    // 0 金币买不起，但木头无等级门槛 → 已解锁
    expect(wood.affordable).toBe(false);
    expect(wood.unlocked).toBe(true);
    const sword = list.find((e) => e.id === SHOP_ENTRY_SHORT_SWORD.id)!;
    expect(sword.unlocked).toBe(false);
  });

  it('购买堆叠物：扣金币、发货入 inventory', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await writeData(token, v3Data({ abstract_resources: { gold: 100 } }));

    const res = await buy(token, SHOP_ENTRY_COPPER_ORE.id, 3).expect(201);
    const cost = SHOP_ENTRY_COPPER_ORE.buy_price * 3;
    expect(res.body).toMatchObject({ entry_id: SHOP_ENTRY_COPPER_ORE.id, quantity: 3, cost });

    const after = await readData(token);
    expect(after.abstract_resources.gold).toBe(100 - cost);
    const ore = after.inventory.find((i) => i.item_id === 'copper_ore');
    expect(ore).toMatchObject({ kind: 'stack', quantity: 3 });
  });

  it('购买装备模板 → inventory 出现合法 EquipmentInstance', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    // 短剑要求攻击 5 级，给足金币与经验（level 5 门槛 = 5^3）
    await writeData(
      token,
      v3Data({ abstract_resources: { gold: 1000 }, skills: { attack: { exp: 5 ** 3 } } }),
    );

    await buy(token, SHOP_ENTRY_SHORT_SWORD.id, 1).expect(201);

    const after = await readData(token);
    const gear = after.inventory.find((i) => i.kind === 'equipment');
    expect(gear).toBeTruthy();
    expect(gear).toMatchObject({
      template_id: 'short_sword',
      slot: 'main_hand',
      quality: 'common',
      required_level: 1,
    });
    expect(typeof gear!.uid).toBe('string');
    // 白板底材：不带随机词缀
    expect((gear as { prefix_affix: unknown }).prefix_affix).toBeNull();
    expect((gear as { final_stats: unknown }).final_stats).toEqual({ attack: 2, defense: 0, hp: 0 });
  });

  it('金币不足 → 403 且存档不变', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const base = v3Data({ abstract_resources: { gold: 1 } });
    await writeData(token, base);

    const res = await buy(token, SHOP_ENTRY_COPPER_ORE.id, 1).expect(403);
    expect(res.body.message).toContain('金币不足');
    expect(await readData(token)).toEqual(base);
  });

  it('等级不足 → 403 且存档不变', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    // 短剑要求 5 级攻击，这里给足金币但等级 1
    const base = v3Data({ abstract_resources: { gold: 10000 } });
    await writeData(token, base);

    const res = await buy(token, SHOP_ENTRY_SHORT_SWORD.id, 1).expect(403);
    expect(res.body.message).toContain('等级不足');
    expect(await readData(token)).toEqual(base);
  });

  it('购买时背包容量不足 → 403', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await writeData(
      token,
      v3Data({
        abstract_resources: { gold: 1000 },
        inventory: [stack('maple_log', 1)],
        inventory_capacity: 1,
      }),
    );

    const res = await buy(token, SHOP_ENTRY_COPPER_ORE.id, 1).expect(403);
    expect(res.body.message).toContain('容量不足');
  });

  it('有限库存：单次购买超过 stock → 403', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await writeData(token, v3Data({ abstract_resources: { gold: 10000 } }));

    const res = await buy(token, 'shop_iron_ore', 26).expect(403);
    expect(res.body.message).toContain('库存不足');
  });

  it('出售有 sell_price 的物品 → 金币增加、物品减少', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const ore = stack('copper_ore', 5);
    await writeData(token, v3Data({ inventory: [ore], abstract_resources: { gold: 0 } }));

    const res = await sell(token, ore.uid, 3).expect(201);
    const gained = SHOP_ENTRY_COPPER_ORE.sell_price! * 3;
    expect(res.body).toMatchObject({ uid: ore.uid, quantity: 3, gained });

    const after = await readData(token);
    expect(after.abstract_resources.gold).toBe(gained);
    expect(after.inventory.find((i) => i.uid === ore.uid)).toMatchObject({ quantity: 2 });
  });

  it('出售无 sell_price 的物品 → 403', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    // 铁矿石在商店可买但不可卖
    const ore = stack('iron_ore', 2);
    await writeData(token, v3Data({ inventory: [ore] }));

    const res = await sell(token, ore.uid, 1).expect(403);
    expect(res.body.message).toContain('不可出售');
  });

  it('出售装备实例：按 sell_price 回收、整件移除', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const gear = equipment({ template_id: 'short_sword', quality: 'common' });
    await writeData(token, v3Data({ inventory: [gear], abstract_resources: { gold: 0 } }));

    const res = await sell(token, gear.uid, 1).expect(201);
    expect(res.body.gained).toBe(SHOP_ENTRY_SHORT_SWORD.sell_price);

    const after = await readData(token);
    expect(after.inventory.some((i) => i.uid === gear.uid)).toBe(false);
    expect(after.abstract_resources.gold).toBe(SHOP_ENTRY_SHORT_SWORD.sell_price);
  });

  it('出售数量超过持有量 → 400；uid 不存在 → 404', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const ore = stack('copper_ore', 2);
    await writeData(token, v3Data({ inventory: [ore] }));

    await sell(token, ore.uid, 5).expect(400);
    await sell(token, randomUUID(), 1).expect(404);
  });

  it('DTO 校验：entry_id 缺失 / quantity 非正 → 400', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await request(app.getHttpServer())
      .post('/api/shop/buy')
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 1 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/shop/buy')
      .set('Authorization', `Bearer ${token}`)
      .send({ entry_id: SHOP_ENTRY_WOOD.id, quantity: 0 })
      .expect(400);
  });

  it('商店条目不存在 → 404', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await writeData(token, v3Data({ abstract_resources: { gold: 100 } }));
    await buy(token, 'not_a_real_entry', 1).expect(404);
  });
});
