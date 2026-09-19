// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { generateEquipment } from '@lazycraft/shared';
import { AppModule } from './../src/app.module.js';
import { createEmptySaveData, CURRENT_SAVE_VERSION } from './../src/save/save-shape.js';
import { migrate as migrate1to2 } from './../src/save/migrations/001-to-002.js';
import { migrate as migrate2to3 } from './../src/save/migrations/002-to-003.js';
import { stack, v3Data } from './save-fixtures.js';

// 与 auth.e2e-spec 同一风格：每个测试文件一个应用实例，共享数据库连接
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
  const email = `save-e2e-${randomUUID()}@example.com`;
  const password = 'test-password-8';
  await request(app.getHttpServer()).post('/api/auth/register').send({ email, password }).expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

describe('/api/save (e2e)', () => {
  it('未带 token 访问 /api/save 返回 401', async () => {
    await request(app.getHttpServer()).get('/api/save').expect(401);
    await request(app.getHttpServer()).post('/api/save').send({}).expect(401);
  });

  it('首次 GET：懒创建默认玩家与空存档，返回 v3 完整结构（含 storage/容量）', async () => {
    const token = await registerAndLogin();
    const res = await request(app.getHttpServer())
      .get('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.version).toBe(CURRENT_SAVE_VERSION);
    expect(res.body.data).toEqual(createEmptySaveData());
    expect(res.body.data.storage).toEqual([]);
    expect(res.body.data.inventory_capacity).toBe(100);
    expect(res.body.data.storage_capacity).toBe(500);
    expect(res.body.updatedAt).toBeTruthy();
  });

  it('POST 写入 v3 存档 → 再 GET 读回完全一致', async () => {
    const token = await registerAndLogin();

    // 先读一次拿到基线版本（懒创建已是 v3）
    const first = await request(app.getHttpServer())
      .get('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(first.body.version).toBe(CURRENT_SAVE_VERSION);

    const v3Data_ = v3Data({
      skills: { mining: { level: 10, exp: 1234 } },
      inventory: [stack('copper_ore', 99)],
      abstract_resources: { gold: 500 },
    });

    await request(app.getHttpServer())
      .post('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: CURRENT_SAVE_VERSION, data: v3Data_ })
      .expect(201);

    // 再读回来应与我们写入的内容完全一致——服务器权威，不做字段裁剪
    const reread = await request(app.getHttpServer())
      .get('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(reread.body.version).toBe(CURRENT_SAVE_VERSION);
    expect(reread.body.data).toEqual(v3Data_);
    expect(reread.body.data.inventory[0]).toMatchObject({ kind: 'stack', item_id: 'copper_ore', quantity: 99 });
  });

  it('版本号不匹配时 POST 返回 409（冲突以服务器为准，不做合并）', async () => {
    const token = await registerAndLogin();

    await request(app.getHttpServer())
      .post('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: CURRENT_SAVE_VERSION, data: createEmptySaveData() })
      .expect(201);

    // 用一个必然不匹配的 version 强制版本错位
    await request(app.getHttpServer())
      .post('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: 99, data: createEmptySaveData() })
      .expect(409);
  });

  it('模拟 v1→v2 迁移：第一段链路产物结构正确（历史用例保留）', () => {
    const legacyV1 = {
      skills: { woodcutting: { level: 5, exp: 250 } },
      inventory: [],
      equipment: {},
      abstract_resources: {},
      current_action: null,
      settings: { audio: { muted: true } },
    };
    const migrated = migrate1to2(legacyV1);
    expect(migrated.migrated_at).toBeGreaterThan(0);
    expect(migrated.skills).toEqual(legacyV1.skills);
    expect(migrated.settings).toEqual(legacyV1.settings);
    expect(migrated.current_combat).toBeNull();
  });

  it('模拟 v2→v3 迁移：v2 存档（含 combat_equipment_drops）升级不丢数据，再经 version=3 读写回', async () => {
    const token = await registerAndLogin();

    // 懒创建：把 DB 里的 save 行立成 v3，为后续版本校验铺路
    await request(app.getHttpServer())
      .get('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const gear = generateEquipment({
      template_id: 'short_sword',
      quality: 'rare',
      affix_pool_ids: [],
      rng: () => 0,
    })!;

    // 历史上的 v2 存档：堆叠物 + 抽象资源里的装备掉落
    const legacyV2 = {
      skills: { mining: { exp: 50 } },
      inventory: [
        { item_id: 'copper_ore', quantity: 6 },
        { item_id: 'iron_ore', quantity: 2, quality: 'rare' },
      ],
      equipment: {},
      abstract_resources: { gold: 77, res_wood: 4, combat_equipment_drops: [gear] },
      current_action: null,
      current_combat: null,
      settings: {},
    };

    const migrated = migrate2to3(legacyV2 as never, () => 'fixed-uid');

    // 不丢数据：两个堆叠 + 一件装备
    expect(migrated.inventory).toHaveLength(3);
    expect(migrated.inventory.filter((i) => i.kind === 'stack')).toHaveLength(2);
    const equipment = migrated.inventory.filter((i) => i.kind === 'equipment');
    expect(equipment).toHaveLength(1);
    expect(equipment[0]).toMatchObject({ template_id: 'short_sword', quality: 'rare', slot: 'main_hand' });
    // 抽象资源保留 gold/res_wood，装备暂存键消失
    expect(migrated.abstract_resources).toEqual({ gold: 77, res_wood: 4 });
    // storage/容量补默认
    expect(migrated.storage).toEqual([]);
    expect(migrated.inventory_capacity).toBe(100);
    expect(migrated.storage_capacity).toBe(500);

    // 把迁移产物按 version=3 写回，再读出应字节级一致——证明与服务端 v3 读写通路兼容
    await request(app.getHttpServer())
      .post('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: CURRENT_SAVE_VERSION, data: migrated })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.version).toBe(CURRENT_SAVE_VERSION);
    expect(res.body.data).toEqual(migrated);
  });

  it('不同账号的存档互相隔离', async () => {
    const tokenA = await registerAndLogin();
    const tokenB = await registerAndLogin();

    const dataA = v3Data({ abstract_resources: { gold: 1 } });
    const dataB = v3Data({ abstract_resources: { gold: 999 } });

    await request(app.getHttpServer())
      .post('/api/save')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ version: CURRENT_SAVE_VERSION, data: dataA })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/save')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ version: CURRENT_SAVE_VERSION, data: dataB })
      .expect(201);

    const readA = await request(app.getHttpServer())
      .get('/api/save')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const readB = await request(app.getHttpServer())
      .get('/api/save')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(readA.body.data.abstract_resources.gold).toBe(1);
    expect(readB.body.data.abstract_resources.gold).toBe(999);
  });
});
