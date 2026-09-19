// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
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
  const email = `inventory-e2e-${randomUUID()}@example.com`;
  const password = 'test-password-8';
  await request(app.getHttpServer()).post('/api/auth/register').send({ email, password }).expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

/** 懒创建存档（保证后续 POST 的版本校验有基线） */
async function ensureSave(token: string) {
  await request(app.getHttpServer()).get('/api/save').set('Authorization', `Bearer ${token}`).expect(200);
}

/** 直接覆写整份存档，用于给测试铺垫容器/槽位/技能状态 */
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

const post = (token: string, path: string, body: unknown) =>
  request(app.getHttpServer())
    .post(`/api/inventory/${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

describe('/api/inventory (e2e)', () => {
  it('未带 token 访问全部 401', async () => {
    await request(app.getHttpServer()).post('/api/inventory/move').send({}).expect(401);
    await request(app.getHttpServer()).post('/api/inventory/equip').send({}).expect(401);
    await request(app.getHttpServer()).post('/api/inventory/unequip').send({}).expect(401);
    await request(app.getHttpServer()).post('/api/inventory/discard').send({}).expect(401);
  });

  it('合法穿戴：inventory 移除、equipment 槽出现同一实例', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const sword = equipment({ slot: 'main_hand', required_level: 1 });
    await writeData(token, v3Data({ inventory: [sword, stack('copper_ore', 5)] }));

    const res = await post(token, 'equip', { uid: sword.uid, slot: 'main_hand' }).expect(201);
    expect(res.body.slot).toBe('main_hand');
    expect(res.body.equipped.uid).toBe(sword.uid);

    const after = await readData(token);
    expect(after.equipment.main_hand).toMatchObject({ uid: sword.uid, template_id: 'short_sword' });
    expect(after.inventory.some((i) => i.uid === sword.uid)).toBe(false);
    // 其它物品不受影响
    expect(after.inventory.find((i) => i.item_id === 'copper_ore')).toBeTruthy();
  });

  it('非法槽位（部位不符）→ 403 且存档不变', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const sword = equipment({ slot: 'main_hand' });
    const base = v3Data({ inventory: [sword] });
    await writeData(token, base);

    const res = await post(token, 'equip', { uid: sword.uid, slot: 'head' }).expect(403);
    expect(res.body.message).toBe('slot_mismatch');

    const after = await readData(token);
    expect(after).toEqual(base);
  });

  it('等级不足 → 403 且存档不变', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    // 15 级门槛，玩家 attack 无经验 = 1 级
    const sword = equipment({ slot: 'main_hand', required_level: 15 });
    const base = v3Data({ inventory: [sword] });
    await writeData(token, base);

    const res = await post(token, 'equip', { uid: sword.uid, slot: 'main_hand' }).expect(403);
    expect(res.body.message).toBe('level_too_low');

    const after = await readData(token);
    expect(after).toEqual(base);
  });

  it('攻击等级足够时可以穿戴 15 级门槛装备', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const sword = equipment({ slot: 'main_hand', required_level: 15 });
    await writeData(
      token,
      v3Data({ inventory: [sword], skills: { attack: { exp: 15 ** 3 } } }),
    );

    await post(token, 'equip', { uid: sword.uid, slot: 'main_hand' }).expect(201);
    const after = await readData(token);
    expect(after.equipment.main_hand?.uid).toBe(sword.uid);
  });

  it('穿戴时原槽已占用 → 被替换装备退回 inventory', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const oldSword = equipment({ slot: 'main_hand' });
    const newSword = equipment({ slot: 'main_hand' });
    await writeData(
      token,
      v3Data({ inventory: [newSword], equipment: { main_hand: oldSword } }),
    );

    const res = await post(token, 'equip', { uid: newSword.uid, slot: 'main_hand' }).expect(201);
    expect(res.body.displaced).toMatchObject({ uid: oldSword.uid });

    const after = await readData(token);
    expect(after.equipment.main_hand?.uid).toBe(newSword.uid);
    expect(after.inventory.some((i) => i.uid === oldSword.uid)).toBe(true);
    expect(after.inventory.some((i) => i.uid === newSword.uid)).toBe(false);
  });

  it('unequip：装备回到 inventory；背包满则拒绝', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const sword = equipment({ slot: 'main_hand' });
    await writeData(token, v3Data({ equipment: { main_hand: sword } }));

    await post(token, 'unequip', { slot: 'main_hand' }).expect(201);
    let after = await readData(token);
    expect(after.equipment.main_hand).toBeNull();
    expect(after.inventory.some((i) => i.uid === sword.uid)).toBe(true);

    // 背包满（容量=1 且已有 1 格）时再卸下应被拒绝
    const sword2 = equipment({ slot: 'main_hand' });
    await writeData(
      token,
      v3Data({
        equipment: { main_hand: sword2 },
        inventory: [stack('copper_ore', 5)],
        inventory_capacity: 1,
      }),
    );
    const res = await post(token, 'unequip', { slot: 'main_hand' }).expect(403);
    expect(res.body.message).toContain('容量不足');
    after = await readData(token);
    expect(after.equipment.main_hand?.uid).toBe(sword2.uid);
  });

  it('空槽卸下 → 404', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await post(token, 'unequip', { slot: 'head' }).expect(404);
  });

  it('move：inventory↔storage 双向移动；装备实例也可跨容器移动', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const ore = stack('copper_ore', 5);
    const sword = equipment({ slot: 'main_hand' });
    await writeData(token, v3Data({ inventory: [ore, sword] }));

    // inventory → storage
    await post(token, 'move', { uid: ore.uid, from: 'inventory', to: 'storage' }).expect(201);
    let after = await readData(token);
    expect(after.storage.some((i) => i.uid === ore.uid)).toBe(true);
    expect(after.inventory.some((i) => i.uid === ore.uid)).toBe(false);

    // 装备从 inventory → storage
    await post(token, 'move', { uid: sword.uid, from: 'inventory', to: 'storage' }).expect(201);
    after = await readData(token);
    expect(after.storage.some((i) => i.uid === sword.uid)).toBe(true);

    // storage → inventory
    await post(token, 'move', { uid: sword.uid, from: 'storage', to: 'inventory' }).expect(201);
    after = await readData(token);
    expect(after.inventory.some((i) => i.uid === sword.uid)).toBe(true);
    expect(after.storage.some((i) => i.uid === sword.uid)).toBe(false);
  });

  it('move：堆叠物并入目标容器已有同 (item_id, quality) 叠，不新增格', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const a = stack('copper_ore', 3);
    const b = stack('copper_ore', 4);
    await writeData(token, v3Data({ inventory: [a], storage: [b] }));

    await post(token, 'move', { uid: a.uid, from: 'inventory', to: 'storage' }).expect(201);
    const after = await readData(token);
    expect(after.inventory).toHaveLength(0);
    expect(after.storage).toHaveLength(1);
    expect(after.storage[0]).toMatchObject({ item_id: 'copper_ore', quantity: 7 });
  });

  it('move：目标容器满 → 403', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const a = stack('copper_ore', 3);
    const b = stack('wood', 1);
    await writeData(
      token,
      v3Data({ inventory: [a], storage: [b], storage_capacity: 1 }),
    );

    const res = await post(token, 'move', { uid: a.uid, from: 'inventory', to: 'storage' }).expect(403);
    expect(res.body.message).toContain('容量不足');
  });

  it('discard：堆叠按数量扣减、装备整件删除', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const ore = stack('copper_ore', 5);
    const sword = equipment({ slot: 'main_hand' });
    await writeData(token, v3Data({ inventory: [ore, sword] }));

    await post(token, 'discard', { uid: ore.uid, quantity: 2 }).expect(201);
    let after = await readData(token);
    expect(after.inventory.find((i) => i.uid === ore.uid)).toMatchObject({ quantity: 3 });

    await post(token, 'discard', { uid: ore.uid }).expect(201);
    after = await readData(token);
    expect(after.inventory.some((i) => i.uid === ore.uid)).toBe(false);

    await post(token, 'discard', { uid: sword.uid }).expect(201);
    after = await readData(token);
    expect(after.inventory.some((i) => i.uid === sword.uid)).toBe(false);
  });

  it('discard：数量超过持有量 → 400', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const ore = stack('copper_ore', 2);
    await writeData(token, v3Data({ inventory: [ore] }));
    await post(token, 'discard', { uid: ore.uid, quantity: 5 }).expect(400);
  });

  it('uid 不存在 → 404（equip / move / discard 一致）', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await writeData(token, v3Data({ inventory: [stack('copper_ore', 1)] }));

    await post(token, 'equip', { uid: randomUUID(), slot: 'main_hand' }).expect(404);
    await post(token, 'move', { uid: randomUUID(), from: 'inventory', to: 'storage' }).expect(404);
    await post(token, 'discard', { uid: randomUUID() }).expect(404);
  });

  it('DTO 校验：非法 slot / from / to 一律 400', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const ore = stack('copper_ore', 1);
    await writeData(token, v3Data({ inventory: [ore] }));

    await post(token, 'equip', { uid: ore.uid, slot: 'nope' }).expect(400);
    await post(token, 'move', { uid: ore.uid, from: 'bag', to: 'storage' }).expect(400);
    await post(token, 'move', { uid: ore.uid, from: 'inventory', to: 'bag' }).expect(400);
  });
});
