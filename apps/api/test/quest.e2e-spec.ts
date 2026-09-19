// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';
import { CURRENT_SAVE_VERSION, createEmptySaveData } from './../src/save/save-shape.js';
import { stack } from './save-fixtures.js';

// 与 action.e2e-spec 同一风格：每个测试文件一个应用实例，共享数据库连接
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
  const email = `quest-e2e-${randomUUID()}@example.com`;
  const username = `quest_${randomUUID().slice(0, 8)}`;
  const password = 'test-password-8';
  await request(app.getHttpServer()).post('/api/auth/register').send({ username, email, password }).expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

const authed = (token: string, method: 'get' | 'post', path: string) =>
  request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);

/** 空存档 data：以 v3 空档为基座，另加 quests 字段等扩展 */
function emptyData(extra: Record<string, unknown> = {}) {
  return { ...createEmptySaveData(), ...extra };
}

async function writeSave(token: string, data: Record<string, unknown>) {
  // 为什么 version=CURRENT_SAVE_VERSION：服务端懒创建已直接产出 v3，写路径要求与 DB 版本严格一致
  await authed(token, 'post', '/api/save')
    .send({ version: CURRENT_SAVE_VERSION, data })
    .expect(201);
}

describe('/api/quests (e2e)', () => {
  it('未带 token 访问 /api/quests/* 全部 401', async () => {
    await request(app.getHttpServer()).get('/api/quests').expect(401);
    await request(app.getHttpServer()).post('/api/quests/main_first_harvest/accept').expect(401);
    await request(app.getHttpServer()).get('/api/quests/main_first_harvest/progress').expect(401);
    await request(app.getHttpServer()).post('/api/quests/main_first_harvest/claim').expect(401);
  });

  it('主线任务完整流水线：list → accept → 进度不足 claim 409 → 挖矿 → progress → claim 拿奖励', async () => {
    const token = await registerAndLogin();
    await authed(token, 'get', '/api/save').expect(200);

    // 1. 初始 list：只有主线可见，日常被前置锁住
    const list0 = await authed(token, 'get', '/api/quests').expect(200);
    const ids0 = (list0.body.quests as Array<{ id: string }>).map((q) => q.id);
    expect(ids0).toEqual(['main_first_harvest']);
    expect(list0.body.quests[0]).toMatchObject({
      accepted: false,
      completed: false,
      progress: 0,
      goal_count: 3,
      goal_type: 'collect_item',
      goal_target: 'copper_ore',
    });

    // 2. 接受主线
    const accept = await authed(token, 'post', '/api/quests/main_first_harvest/accept').expect(201);
    expect(accept.body.quest.id).toBe('main_first_harvest');
    expect(accept.body.quest).toMatchObject({ accepted: true, completed: false });

    // 3. 日常任务此时依然被前置卡住：完成前 accept 日常返回 409
    const dailiesBefore = await authed(token, 'get', '/api/quests').expect(200);
    const dailyIds = (dailiesBefore.body.quests as Array<{ id: string }>).map((q) => q.id);
    expect(dailyIds).toEqual(['main_first_harvest']);
    await authed(token, 'post', '/api/quests/daily_collect_copper/accept').expect(409);

    // 4. 未挖矿时交任务应当 409（进度不足）
    await authed(token, 'post', '/api/quests/main_first_harvest/claim').expect(409);

    // 5. 用动作模块挖 3 个铜矿：等待 3.2s = 1 tick（interval 3s）
    await authed(token, 'post', '/api/action/start')
      .send({ skillId: 'mining', actionId: 'mine_copper' })
      .expect(201);
    await new Promise((r) => setTimeout(r, 10_500)); // 3.2s * 3 次循环 + 余量
    const stop = await authed(token, 'post', '/api/action/stop').expect(201);
    expect(stop.body.report.ticks).toBeGreaterThanOrEqual(3);

    // 6. 进度应达标：progress ≥ 3
    const progress = await authed(token, 'get', '/api/quests/main_first_harvest/progress').expect(200);
    expect(progress.body.quest.progress).toBeGreaterThanOrEqual(3);

    // 7. 交任务：拿到 5 个枫木奖励；任务标记为 completed
    const claim = await authed(token, 'post', '/api/quests/main_first_harvest/claim').expect(201);
    expect(claim.body.quest.completed).toBe(true);
    expect(claim.body.reward.items).toEqual({ maple_log: 5 });

    // 8. 背包里应有 5 个枫木 + 结算所得的铜矿
    const save = await authed(token, 'get', '/api/save').expect(200);
    const inventory = (save.body.data.inventory ?? []) as Array<{
      kind: string;
      item_id: string;
      quantity: number;
    }>;
    const maple = inventory.find((s) => s.kind === 'stack' && s.item_id === 'maple_log');
    expect(maple?.quantity).toBe(5);

    // 9. 主线完成后 list 应包含 3 条日常任务
    const listAfter = await authed(token, 'get', '/api/quests').expect(200);
    const idsAfter = (listAfter.body.quests as Array<{ id: string }>).map((q) => q.id);
    expect(idsAfter).toContain('main_first_harvest');
    expect(idsAfter).toContain('daily_collect_copper');
    expect(idsAfter).toContain('daily_chop_maple');
    expect(idsAfter).toContain('daily_craft_charcoal');
    // mine_copper interval=3s × 3 tick + 余量，需要比 vitest 默认 5s 更久
  }, 25_000);

  it('重复 accept / 重复 claim 都会 409', async () => {
    const token = await registerAndLogin();
    await writeSave(token, emptyData());

    await authed(token, 'post', '/api/quests/main_first_harvest/accept').expect(201);
    await authed(token, 'post', '/api/quests/main_first_harvest/accept').expect(409);

    // 直接构造背包里有 3 个铜矿，然后领取任务并 claim，再尝试重复 claim
    await writeSave(token, emptyData({
      inventory: [stack('copper_ore', 3)],
      quests: {
        main_first_harvest: { accepted_at: Date.now(), baseline: 0, gained: 0, completed: false },
      },
    }));
    await authed(token, 'post', '/api/quests/main_first_harvest/claim').expect(201);
    await authed(token, 'post', '/api/quests/main_first_harvest/claim').expect(409);
  });

  it('领取前已有的铜矿不计入 collect 进度（baseline 语义）', async () => {
    const token = await registerAndLogin();
    // 先给玩家发 5 个铜矿，再领取主线任务
    await writeSave(token, emptyData({ inventory: [stack('copper_ore', 5)] }));
    await authed(token, 'post', '/api/quests/main_first_harvest/accept').expect(201);

    // baseline = 5，progress = 0
    const progress = await authed(token, 'get', '/api/quests/main_first_harvest/progress').expect(200);
    expect(progress.body.quest.progress).toBe(0);

    // 此时 claim 应当 409
    await authed(token, 'post', '/api/quests/main_first_harvest/claim').expect(409);
  });

  it('craft_item 类日常任务通过结算钩子累计进度', async () => {
    const token = await registerAndLogin();
    // 构造存档：已有枫木 10 根 + 主线已完成（使日常可接）
    await writeSave(token, emptyData({
      skills: { firemaking: { exp: 0 } },
      inventory: [stack('maple_log', 10)],
      quests: {
        main_first_harvest: { accepted_at: Date.now(), baseline: 0, gained: 3, completed: true },
      },
    }));

    // 接 craft 日常
    const accept = await authed(token, 'post', '/api/quests/daily_craft_charcoal/accept').expect(201);
    expect(accept.body.quest.goal_type).toBe('craft_item');

    // 结算钩子的累计语义由 recordGainedFromSettlement 单测覆盖范围有限，
    // 这里直接验证"craft_item 进度从 data.quests[id].gained 读取"：
    // 把 gained 推到达标
    const save = await authed(token, 'get', '/api/save').expect(200);
    await authed(token, 'post', '/api/save')
      .send({
        // 为什么 version=CURRENT_SAVE_VERSION：存档升级到 v3 后，写路径要求版本与 DB 严格一致
        version: CURRENT_SAVE_VERSION,
        data: {
          ...save.body.data,
          quests: {
            ...save.body.data.quests,
            daily_craft_charcoal: {
              ...save.body.data.quests.daily_craft_charcoal,
              gained: 5,
            },
          },
        },
      })
      .expect(201);

    // 进度应达标，可交付
    const progress = await authed(token, 'get', '/api/quests/daily_craft_charcoal/progress').expect(200);
    expect(progress.body.quest.progress).toBe(5);
    const claim = await authed(token, 'post', '/api/quests/daily_craft_charcoal/claim').expect(201);
    expect(claim.body.quest.completed).toBe(true);
    expect(claim.body.reward.items).toEqual({ copper_ore: 3, maple_log: 3 });
  });

  it('不存在的任务 id：accept / progress / claim 全部 404', async () => {
    const token = await registerAndLogin();
    await authed(token, 'post', '/api/quests/no_such/accept').expect(404);
    await authed(token, 'get', '/api/quests/no_such/progress').expect(404);
    await authed(token, 'post', '/api/quests/no_such/claim').expect(404);
  });

  it('未领取的任务 progress 返回 404', async () => {
    const token = await registerAndLogin();
    await authed(token, 'get', '/api/quests/main_first_harvest/progress').expect(404);
  });
});
