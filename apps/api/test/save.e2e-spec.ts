// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';
import { createEmptySaveData } from './../src/save/save-shape.js';
import { migrate as migrate1to2 } from './../src/save/migrations/001-to-002.js';

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

  it('首次 GET：懒创建默认玩家与空存档，返回 v2 完整结构（含 current_combat）', async () => {
    const token = await registerAndLogin();
    const res = await request(app.getHttpServer())
      .get('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // 存档版本号已升级至 v2（新增 current_combat 字段），懒创建直接产出 v2 形态
    expect(res.body.version).toBe(2);
    expect(res.body.data).toEqual(createEmptySaveData());
    expect(res.body.updatedAt).toBeTruthy();
  });

  it('POST 写入 v2 存档 → 再 GET 读回完全一致', async () => {
    const token = await registerAndLogin();

    // 先读一次拿到基线版本（懒创建已是 v2）
    const first = await request(app.getHttpServer())
      .get('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(first.body.version).toBe(2);

    // 用客户端视角构造一份 v2 完整结构——必须带 current_combat 才是合法的 v2 data
    const v2Data = {
      ...createEmptySaveData(),
      skills: { mining: { level: 10, exp: 1234 } },
      inventory: [{ id: 'copper_ore', qty: 99 }],
      abstract_resources: { gold: 500 },
    };

    await request(app.getHttpServer())
      .post('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: 2, data: v2Data })
      .expect(201);

    // 再读回来应与我们写入的内容完全一致——服务器权威，不做字段裁剪
    const reread = await request(app.getHttpServer())
      .get('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(reread.body.version).toBe(2);
    expect(reread.body.data).toEqual(v2Data);
  });

  it('版本号不匹配时 POST 返回 409（冲突以服务器为准，不做合并）', async () => {
    const token = await registerAndLogin();

    // 先用当前版本（v2）成功写一次
    await request(app.getHttpServer())
      .post('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: 2, data: createEmptySaveData() })
      .expect(201);

    // 再用过时版本号（仍然是 v2，但这里通过第二次写入把 DB 里的 updatedAt 推进了，
    // 模拟另一个客户端并发写入）——为了强制版本错位，直接用一个必然不匹配的 version=99
    await request(app.getHttpServer())
      .post('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: 99, data: createEmptySaveData() })
      .expect(409);
  });

  it('模拟 v1→v2 迁移：直接用迁移函数把 v1 升到 v2，再通过 version=2 读写回', async () => {
    const token = await registerAndLogin();

    // 1) 懒创建（这一步把 DB 里的 save 行立成 v2），为后续版本校验铺路
    await request(app.getHttpServer())
      .get('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // 2) 在测试侧构造一份"历史上的 v1 存档"，调用迁移函数验证其产物结构：
    //    - 保留所有原字段
    //    - 补 current_combat: null
    //    - 附 migrated_at 审计时间戳
    //    为什么绕开 prisma 直接调函数：当前 DB 里没有任何途径还能塞入 version=1 的行
    //    （read/write 都会先把版本对齐到 CURRENT_SAVE_VERSION），迁移函数本身的
    //    单测已在 apps/api/src/save/migrations 侧覆盖；这里验证的是"迁移产物 + 服务端
    //    读写通路"能无缝衔接。
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

    // 3) 把迁移产物按版本=2 写回（等价于"老客户端升级到新版本后首次提交"），
    //    再读出应该字节级一致——这证明 migrated 结构与 v2 服务端读写完全兼容。
    await request(app.getHttpServer())
      .post('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .send({ version: 2, data: migrated })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.version).toBe(2);
    expect(res.body.data).toEqual(migrated);
  });

  it('不同账号的存档互相隔离', async () => {
    const tokenA = await registerAndLogin();
    const tokenB = await registerAndLogin();

    const dataA = { ...createEmptySaveData(), abstract_resources: { gold: 1 } };
    const dataB = { ...createEmptySaveData(), abstract_resources: { gold: 999 } };

    await request(app.getHttpServer())
      .post('/api/save')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ version: 2, data: dataA })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/save')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ version: 2, data: dataB })
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
