// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';
import { CURRENT_SAVE_VERSION, type SaveDataV3 } from './../src/save/save-shape.js';
import { equipment, v3Data } from './save-fixtures.js';

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
  const email = `combat-e2e-${randomUUID()}@example.com`;
  const password = 'test-password-8';
  await request(app.getHttpServer()).post('/api/auth/register').send({ email, password }).expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

async function writeData(token: string, data: SaveDataV3) {
  await request(app.getHttpServer())
    .post('/api/save')
    .set('Authorization', `Bearer ${token}`)
    .send({ version: CURRENT_SAVE_VERSION, data })
    .expect(201);
}

/**
 * 造一场"已经在打"的战斗并取实时战报。
 *
 * 为什么要把 started_at 回溯到过去？
 *   start 用的永远是服务器当前时间，若真走 start→current，两次请求间隔只有毫秒，
 *   推演还没产生任何出手，拿不到能体现属性差异的日志。直接写一份 started_at
 *   在 60 秒前的 current_combat，current 就会一次性推演出完整对砍结果。
 */
async function reportFor(token: string, data: SaveDataV3) {
  await writeData(token, data);
  const res = await request(app.getHttpServer())
    .get('/api/combat/current')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.report as {
    end: { kind: string };
    player_hp: number;
    enemy_hp: number;
    log: Array<{ actor: 'player' | 'enemy'; damage: number }>;
  };
}

/** 与敌配置 chicken（5 HP / 1 攻）对齐的战斗中存档；now 相对量足够跑完整场 */
function fighting(overrides: Partial<SaveDataV3> = {}): SaveDataV3 {
  return v3Data({
    current_combat: { enemy_id: 'chicken', started_at: Date.now() - 60_000 },
    ...overrides,
  });
}

describe('/api/combat (e2e)', () => {
  it('未带 token 访问 current/start/stop 均 401', async () => {
    await request(app.getHttpServer()).get('/api/combat/current').expect(401);
    await request(app.getHttpServer()).post('/api/combat/start').send({ enemyId: 'chicken' }).expect(401);
    await request(app.getHttpServer()).post('/api/combat/stop').send({}).expect(401);
  });

  it('穿戴装备后玩家攻击与生命提高：伤害更高、生存更久', async () => {
    const token = await registerAndLogin();

    // 基线：空装备。1 级玩家攻 1，鸡 5 HP，需 5 刀；期间挨 4 口剩 10 HP
    const baseline = await reportFor(token, fighting());
    expect(baseline.end.kind).toBe('victory');
    expect(baseline.log[0].damage).toBe(1);
    expect(baseline.player_hp).toBe(10);

    // 穿戴 +5 攻 / +10 HP 的武器：一刀 6 伤直接秒鸡，玩家满血 24 不掉一滴
    const armed = await reportFor(
      token,
      fighting({
        equipment: {
          main_hand: equipment({ final_stats: { attack: 5, defense: 0, hp: 10 } }),
        },
      }),
    );
    expect(armed.end.kind).toBe('victory');
    expect(armed.log[0].damage).toBe(6);
    expect(armed.player_hp).toBeGreaterThan(baseline.player_hp);
    expect(armed.player_hp).toBe(24);
  });

  it('防御加成让玩家受到的伤害降低', async () => {
    const token = await registerAndLogin();

    // 给一件只加防御的胸甲：鸡 1 攻被 1 防完全抵消，玩家全程不掉血
    const armored = await reportFor(
      token,
      fighting({
        equipment: {
          chest: equipment({ slot: 'chest', final_stats: { attack: 0, defense: 1, hp: 0 } }),
        },
      }),
    );
    const enemyHit = armored.log.find((e) => e.actor === 'enemy');
    expect(enemyHit?.damage).toBe(0);
    expect(armored.player_hp).toBe(14);
  });

  it('equipment 缺失 / 空槽 / null 时与旧版一致：无任何加成', async () => {
    const token = await registerAndLogin();

    const baseline = await reportFor(token, fighting());
    const nullSlots = await reportFor(
      token,
      fighting({ equipment: { main_hand: null, head: null, chest: null } }),
    );
    // 显式删掉 equipment 字段，验证 v1 老档的缺失形态
    const missing = fighting();
    delete (missing as Partial<SaveDataV3>).equipment;
    const missingReport = await reportFor(token, missing);

    expect(nullSlots.log[0].damage).toBe(baseline.log[0].damage);
    expect(nullSlots.player_hp).toBe(baseline.player_hp);
    expect(missingReport.log[0].damage).toBe(baseline.log[0].damage);
    expect(missingReport.player_hp).toBe(baseline.player_hp);
  });

  it('脏装备数据（非对象 / 缺 final_stats）被忽略且不崩', async () => {
    const token = await registerAndLogin();

    const dirty = fighting({
      // 模拟 JSONB 被手改成各种垃圾形状
      equipment: {
        main_hand: 'garbage',
        head: 123,
        chest: { kind: 'equipment', uid: 'no-stats' },
        legs: { final_stats: null },
      } as unknown as SaveDataV3['equipment'],
    });
    const report = await reportFor(token, dirty);

    // 一件有效装备都没有 → 与空装备基线相同
    expect(report.end.kind).toBe('victory');
    expect(report.log[0].damage).toBe(1);
    expect(report.player_hp).toBe(10);
  });
});
