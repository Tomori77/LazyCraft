// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';
import { CURRENT_SAVE_VERSION } from './../src/save/save-shape.js';
import { stack, v3Data } from './save-fixtures.js';
import { ACTION_BURN_CHARCOAL, ACTION_MINE_IRON, exp } from '@lazycraft/shared';

// 与 save.e2e-spec 同一风格：每个测试文件一个应用实例，共享数据库连接
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
  const email = `action-e2e-${randomUUID()}@example.com`;
  const password = 'test-password-8';
  await request(app.getHttpServer()).post('/api/auth/register').send({ email, password }).expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

/** 首次访问存档，触发懒创建（默认角色 + 空存档） */
async function ensureSave(token: string) {
  await request(app.getHttpServer()).get('/api/save').set('Authorization', `Bearer ${token}`).expect(200);
}

/** 用 save 接口直接覆写 data（存档已升级到 v3：写入时携带 storage/容量） */
async function writeSave(token: string, data: Record<string, unknown>) {
  await request(app.getHttpServer())
    .post('/api/save')
    .set('Authorization', `Bearer ${token}`)
    // 为什么 version=CURRENT_SAVE_VERSION：服务端懒创建已是 v3，写路径要求客户端版本与 DB 版本严格一致
    .send({ version: CURRENT_SAVE_VERSION, data })
    .expect(201);
}

describe('/api/action (e2e)', () => {
  it('未带 token 访问 /api/action/* 全部 401', async () => {
    await request(app.getHttpServer()).post('/api/action/start').send({}).expect(401);
    await request(app.getHttpServer()).post('/api/action/stop').expect(401);
    await request(app.getHttpServer()).get('/api/action/current').expect(401);
  });

  it('开始 → 查询当前 → 重复开始 409 → 停止 → 再开始别的：走通主验收路径', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    // 1. 空闲时查询：current_action 为 null
    const idleRes = await request(app.getHttpServer())
      .get('/api/action/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(idleRes.body.current_action).toBeNull();

    // 2. 开始采铜矿（等级 1 即可，无消耗）
    const startRes = await request(app.getHttpServer())
      .post('/api/action/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'mining', actionId: 'mine_copper' })
      .expect(201);
    expect(startRes.body.current_action).toMatchObject({
      skill_id: 'mining',
      action_id: 'mine_copper',
    });
    expect(typeof startRes.body.current_action.started_at).toBe('number');
    expect(startRes.body.next_tick_at).toBeGreaterThan(startRes.body.current_action.started_at);

    // 3. 查询当前：能拿到 started_at 和 next_tick_at，且封顶在 24h 内
    const currentRes = await request(app.getHttpServer())
      .get('/api/action/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(currentRes.body.current_action.action_id).toBe('mine_copper');
    expect(currentRes.body.interval_ms).toBe(3000);
    expect(currentRes.body.next_tick_at).toBe(
      currentRes.body.current_action.started_at + currentRes.body.interval_ms,
    );

    // 4. 重复开始（即使是另一个动作）必须 409：同一时间只能有一个主动活动
    await request(app.getHttpServer())
      .post('/api/action/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'woodcutting', actionId: 'chop_maple' })
      .expect(409);

    // 5. 停止：返回结算报告；elapsed 很短但允许 0 tick
    const stopRes = await request(app.getHttpServer())
      .post('/api/action/stop')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(stopRes.body.current_action).toBeNull();
    expect(stopRes.body.report).toMatchObject({ ticks: expect.any(Number) });

    // 6. 停止后再次查询：回到空闲
    const afterRes = await request(app.getHttpServer())
      .get('/api/action/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(afterRes.body.current_action).toBeNull();

    // 7. 再开始别的动作，验证"停止后允许重新开始"
    await request(app.getHttpServer())
      .post('/api/action/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'woodcutting', actionId: 'chop_maple' })
      .expect(201);
  });

  it('等级不足时开始活动返回 403', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    // 新账号没有任何技能经验 → mining 等级按 1 级处理；mine_iron 需要 15 级
    const res = await request(app.getHttpServer())
      .post('/api/action/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'mining', actionId: ACTION_MINE_IRON.id })
      .expect(403);
    expect(res.body.message).toContain('等级不足');
  });

  it('材料不足时开始活动返回 403', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    // burn_charcoal 需要 1 个 maple_log；新存档背包为空
    const res = await request(app.getHttpServer())
      .post('/api/action/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'firemaking', actionId: ACTION_BURN_CHARCOAL.id })
      .expect(403);
    expect(res.body.message).toContain('材料不足');
  });

  it('材料足够 + 等级达标时可以开始，停止后材料按 tick 结算扣掉', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    // 直接构造存档：给玩家 1 级烧火经验（1 级）+ 5 个枫木
    // 用 v3Data 保证 current_combat/storage/容量等 v3 字段齐全——write 走整包覆盖（非合并）
    await writeSave(token, v3Data({
      skills: { firemaking: { exp: exp(1) } },
      inventory: [stack('maple_log', 5)],
    }));

    // 开始烧木炭
    await request(app.getHttpServer())
      .post('/api/action/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'firemaking', actionId: ACTION_BURN_CHARCOAL.id })
      .expect(201);

    // 等 2.2s：interval=2000ms，应当恰好完成 1 tick
    await new Promise((resolve) => setTimeout(resolve, 2200));

    const stopRes = await request(app.getHttpServer())
      .post('/api/action/stop')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(stopRes.body.report.ticks).toBe(1);
    expect(stopRes.body.report.consumed).toEqual([{ item_id: 'maple_log', amount: 1 }]);

    // 背包从 5 变成 4，且复用原堆叠 uid（kind/uid 保留）
    const saveRes = await request(app.getHttpServer())
      .get('/api/save')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(saveRes.body.data.inventory).toHaveLength(1);
    expect(saveRes.body.data.inventory[0]).toMatchObject({
      kind: 'stack',
      item_id: 'maple_log',
      quantity: 4,
    });
    // 烧火经验被累积（burn_charcoal.exp = 5）
    expect(saveRes.body.data.skills.firemaking.exp).toBe(exp(1) + 5);
  });

  it('没活动时调用 stop 返回 409', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    const res = await request(app.getHttpServer())
      .post('/api/action/stop')
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(res.body.message).toContain('没有进行中的活动');
  });

  it('skillId 与 action.skill_id 不匹配时返回 403；动作不存在返回 404', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    // mine_copper 属于 mining，故意说它是 woodcutting → 403
    await request(app.getHttpServer())
      .post('/api/action/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'woodcutting', actionId: 'mine_copper' })
      .expect(403);

    // 不存在的 actionId → 404
    await request(app.getHttpServer())
      .post('/api/action/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'mining', actionId: 'nonexistent_action' })
      .expect(404);
  });
});
