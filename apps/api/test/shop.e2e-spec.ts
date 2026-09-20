// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
//
// 商店口径（task-24b）：条目已入库 `shop_entries`，库存全服共享、买入真实扣减。
// 因此本文件对"有限库存"的用例不再依赖某个 seed 条目的剩余值（远程库会被多轮测试消耗），
// 而是先用 ADMIN_EMAILS 白名单造一个 admin 账号，临时新增一个已知库存的条目，
// 用例结束后删除——让库存断言完全自洽、可重复。
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import {
  SHOP_ENTRY_COPPER_ORE,
  SHOP_ENTRY_IRON_ORE,
  SHOP_ENTRY_SHORT_SWORD,
  SHOP_ENTRY_WOOD,
} from '@lazycraft/shared';
import { AppModule } from './../src/app.module.js';
import { CURRENT_SAVE_VERSION, type SaveDataV3 } from './../src/save/save-shape.js';
import { equipment, stack, v3Data } from './save-fixtures.js';

let app: INestApplication<App>;

// admin 白名单：AccountsService 在注册时读取，命中即 role='admin'（见 src/auth/admin-emails.ts）
const ADMIN_EMAIL = `shop-e2e-admin-${randomUUID()}@example.com`;
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

async function register(email: string) {
  const password = 'test-password-8';
  const username = `shop_${randomUUID().slice(0, 8)}`;
  await request(app.getHttpServer()).post('/api/auth/register').send({ username, email, password }).expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

async function registerAndLogin() {
  return register(`shop-e2e-${randomUUID()}@example.com`);
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

// task-33：出售按 entry_id（固定回收清单）而非背包 uid
const sell = (token: string, entry_id: string, quantity: number) =>
  request(app.getHttpServer())
    .post('/api/shop/sell')
    .set('Authorization', `Bearer ${token}`)
    .send({ entry_id, quantity });

interface ShopPayload {
  entries: Array<{ id: string; affordable: boolean; unlocked: boolean; stock: number }>;
  recyclables: RecyclableEntry[];
}

interface RecyclableEntry {
  entry_id: string;
  kind: 'item' | 'equipment';
  item_id?: string;
  template_id?: string;
  quality?: string;
  sell_price: number;
  held: number;
}

const getShop = (token: string) =>
  request(app.getHttpServer()).get('/api/shop').set('Authorization', `Bearer ${token}`);

// admin 邮箱只能注册一次（重复注册 409），复用首次登录的 token
let adminTokenPromise: Promise<string> | undefined;
const adminToken = () => (adminTokenPromise ??= register(ADMIN_EMAIL));

/** 造一个临时有限库存条目（管理员权限），返回其 id */
async function createTempEntry(token: string, stock: number): Promise<string> {
  const id = `shop-e2e-tmp-${randomUUID()}`;
  await request(app.getHttpServer())
    .post('/api/admin/shop/entries')
    .set('Authorization', `Bearer ${token}`)
    .send({ id, kind: 'item', item_id: SHOP_ENTRY_COPPER_ORE.item_id, buy_price: 10, stock, sort_order: 9999 })
    .expect(201);
  return id;
}

async function deleteEntry(token: string, id: string) {
  await request(app.getHttpServer())
    .delete(`/api/admin/shop/entries/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
}

describe('/api/shop (e2e)', () => {
  it('未带 token 访问全部 401', async () => {
    await request(app.getHttpServer()).get('/api/shop').expect(401);
    await request(app.getHttpServer()).get('/api/shop/recyclables').expect(401);
    await request(app.getHttpServer()).post('/api/shop/buy').send({}).expect(401);
    await request(app.getHttpServer()).post('/api/shop/sell').send({}).expect(401);
  });

  it('GET /api/shop：分区返回 entries + recyclables（task-33 契约）', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await writeData(token, v3Data({ abstract_resources: { gold: 0 } }));

    const res = await getShop(token).expect(200);
    const body = res.body as ShopPayload;
    expect(Array.isArray(body.entries)).toBe(true);
    expect(Array.isArray(body.recyclables)).toBe(true);

    const wood = body.entries.find((e) => e.id === SHOP_ENTRY_WOOD.id)!;
    // 0 金币买不起，但木头无等级门槛 → 已解锁
    expect(wood.affordable).toBe(false);
    expect(wood.unlocked).toBe(true);
    const sword = body.entries.find((e) => e.id === SHOP_ENTRY_SHORT_SWORD.id)!;
    expect(sword.unlocked).toBe(false);

    // 回收清单只含 sell_price != null 的条目，且带 held（当前持有量）
    expect(body.recyclables.some((e) => e.entry_id === SHOP_ENTRY_WOOD.id)).toBe(true);
    expect(body.recyclables.some((e) => e.item_id === 'iron_ore')).toBe(false);
    const woodRec = body.recyclables.find((e) => e.entry_id === SHOP_ENTRY_WOOD.id)!;
    expect(woodRec.sell_price).toBe(SHOP_ENTRY_WOOD.sell_price);
    expect(woodRec.held).toBe(0);
  });

  it('GET /api/shop/recyclables：与分区清单一致，held 反映背包', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await writeData(token, v3Data({ inventory: [stack('copper_ore', 4)] }));

    const res = await request(app.getHttpServer())
      .get('/api/shop/recyclables')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const list = res.body as RecyclableEntry[];
    expect(Array.isArray(list)).toBe(true);
    const ore = list.find((e) => e.entry_id === SHOP_ENTRY_COPPER_ORE.id)!;
    expect(ore).toMatchObject({ sell_price: SHOP_ENTRY_COPPER_ORE.sell_price, held: 4 });
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

  it('无限库存（stock=-1）：买入后库存不减', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await writeData(token, v3Data({ abstract_resources: { gold: 1000 } }));

    await buy(token, SHOP_ENTRY_WOOD.id, 2).expect(201);

    const res = await getShop(token).expect(200);
    const wood = (res.body as ShopPayload).entries.find((e) => e.id === SHOP_ENTRY_WOOD.id)!;
    expect(wood.stock).toBe(-1);
  });

  it('有限库存：买入真实扣减，另一账号可见剩余减少', async () => {
    const admin = await adminToken();
    const entryId = await createTempEntry(admin, 3);
    try {
      const buyerA = await registerAndLogin();
      const buyerB = await registerAndLogin();
      await ensureSave(buyerA);
      await ensureSave(buyerB);
      await writeData(buyerA, v3Data({ abstract_resources: { gold: 1000 } }));

      const before = await getShop(buyerB).expect(200);
      expect((before.body as ShopPayload).entries.find((e) => e.id === entryId)!.stock).toBe(3);

      await buy(buyerA, entryId, 2).expect(201);

      const after = await getShop(buyerB).expect(200);
      // 全服共享：另一个账号（未购买）也看到剩余下降
      expect((after.body as ShopPayload).entries.find((e) => e.id === entryId)!.stock).toBe(1);
    } finally {
      await deleteEntry(admin, entryId);
    }
  });

  it('库存不足 → 403（有限库存耗尽）', async () => {
    const admin = await adminToken();
    const entryId = await createTempEntry(admin, 1);
    try {
      const buyerA = await registerAndLogin();
      await ensureSave(buyerA);
      await writeData(buyerA, v3Data({ abstract_resources: { gold: 1000 } }));
      await buy(buyerA, entryId, 1).expect(201);

      const buyerB = await registerAndLogin();
      await ensureSave(buyerB);
      await writeData(buyerB, v3Data({ abstract_resources: { gold: 1000 } }));

      const res = await buy(buyerB, entryId, 1).expect(403);
      expect(res.body.message).toContain('库存不足');
    } finally {
      await deleteEntry(admin, entryId);
    }
  });

  it('并发抢最后 1 件：仅一个成功', async () => {
    const admin = await adminToken();
    const entryId = await createTempEntry(admin, 1);
    try {
      const buyerA = await registerAndLogin();
      const buyerB = await registerAndLogin();
      await ensureSave(buyerA);
      await ensureSave(buyerB);
      await writeData(buyerA, v3Data({ abstract_resources: { gold: 1000 } }));
      await writeData(buyerB, v3Data({ abstract_resources: { gold: 1000 } }));

      const [a, b] = await Promise.all([buy(buyerA, entryId, 1), buy(buyerB, entryId, 1)]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 403]);
    } finally {
      await deleteEntry(admin, entryId);
    }
  });

  it('出售有 sell_price 的物品 → 金币增加、物品减少（按 entry_id）', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const ore = stack('copper_ore', 5);
    await writeData(token, v3Data({ inventory: [ore], abstract_resources: { gold: 0 } }));

    const res = await sell(token, SHOP_ENTRY_COPPER_ORE.id, 3).expect(201);
    const gained = SHOP_ENTRY_COPPER_ORE.sell_price! * 3;
    expect(res.body).toMatchObject({ entry_id: SHOP_ENTRY_COPPER_ORE.id, quantity: 3, gained });
    expect(res.body.uid).toBeUndefined();

    const after = await readData(token);
    expect(after.abstract_resources.gold).toBe(gained);
    expect(after.inventory.find((i) => i.item_id === 'copper_ore')).toMatchObject({ quantity: 2 });
  });

  it('出售会跨同品质堆叠聚合扣减（不依赖单格 uid）', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await writeData(
      token,
      v3Data({ inventory: [stack('copper_ore', 2), stack('copper_ore', 3)], abstract_resources: { gold: 0 } }),
    );

    await sell(token, SHOP_ENTRY_COPPER_ORE.id, 4).expect(201);

    const after = await readData(token);
    expect(after.abstract_resources.gold).toBe(SHOP_ENTRY_COPPER_ORE.sell_price! * 4);
    const total = after.inventory
      .filter((i) => i.item_id === 'copper_ore')
      .reduce((sum, i) => sum + (i.kind === 'stack' ? i.quantity : 0), 0);
    expect(total).toBe(1);
  });

  it('出售不可回收条目（无 sell_price）→ 403', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    // 铁矿石在商店可买但不可回收；即便背包持有也不该能卖
    await writeData(token, v3Data({ inventory: [stack('iron_ore', 2)] }));

    const res = await sell(token, SHOP_ENTRY_IRON_ORE.id, 1).expect(403);
    expect(res.body.message).toContain('不可回收');
  });

  it('出售未持有物品 → 404；数量不足 → 400', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await writeData(token, v3Data({ inventory: [stack('copper_ore', 2)] }));

    // 未持有（背包没有 wood）
    await sell(token, SHOP_ENTRY_WOOD.id, 1).expect(404);
    // 持有 2 但要卖 5
    const res = await sell(token, SHOP_ENTRY_COPPER_ORE.id, 5).expect(400);
    expect(res.body.message).toContain('超过持有量');
  });

  it('出售不存在的条目 → 404', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await sell(token, randomUUID(), 1).expect(404);
  });

  it('出售装备实例：按 sell_price 回收、整件移除', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const gear = equipment({ template_id: 'short_sword', quality: 'common' });
    await writeData(token, v3Data({ inventory: [gear], abstract_resources: { gold: 0 } }));

    const res = await sell(token, SHOP_ENTRY_SHORT_SWORD.id, 1).expect(201);
    expect(res.body.gained).toBe(SHOP_ENTRY_SHORT_SWORD.sell_price);

    const after = await readData(token);
    expect(after.inventory.some((i) => i.uid === gear.uid)).toBe(false);
    expect(after.abstract_resources.gold).toBe(SHOP_ENTRY_SHORT_SWORD.sell_price);
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
