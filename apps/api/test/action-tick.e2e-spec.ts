// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';
import { CURRENT_SAVE_VERSION } from './../src/save/save-shape.js';
import { stack, v3Data } from './save-fixtures.js';
import { ACTION_BURN_CHARCOAL, exp } from '@lazycraft/shared';

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
  const email = `tick-e2e-${randomUUID()}@example.com`;
  const username = `tick_${randomUUID().slice(0, 8)}`;
  const password = 'test-password-8';
  await request(app.getHttpServer()).post('/api/auth/register').send({ username, email, password }).expect(201);
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.accessToken as string;
}

async function ensureSave(token: string) {
  await request(app.getHttpServer()).get('/api/save').set('Authorization', `Bearer ${token}`).expect(200);
}

async function writeSave(token: string, data: Record<string, unknown>) {
  await request(app.getHttpServer())
    .post('/api/save')
    .set('Authorization', `Bearer ${token}`)
    .send({ version: CURRENT_SAVE_VERSION, data })
    .expect(201);
}

function settleDue(token: string) {
  return request(app.getHttpServer())
    .post('/api/action/settle-due')
    .set('Authorization', `Bearer ${token}`);
}

function getSave(token: string) {
  return request(app.getHttpServer()).get('/api/save').set('Authorization', `Bearer ${token}`).expect(200);
}

describe('/api/action/settle-due (e2e)', () => {
  it('未带 token 访问 settle-due 返回 401', async () => {
    await request(app.getHttpServer()).post('/api/action/settle-due').expect(401);
  });

  it('current() 的 next_tick_at 随 now 推进（等一个 interval 后变大）', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    // mine_copper interval=3000ms
    await request(app.getHttpServer())
      .post('/api/action/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'mining', actionId: 'mine_copper' })
      .expect(201);

    const first = await request(app.getHttpServer())
      .get('/api/action/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const firstNext = first.body.next_tick_at as number;

    // 等过一圈：next_tick_at 必须推进到下一个整圈边界
    await new Promise((resolve) => setTimeout(resolve, 3200));

    const second = await request(app.getHttpServer())
      .get('/api/action/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const secondNext = second.body.next_tick_at as number;

    expect(secondNext).toBeGreaterThan(firstNext);
    // 推进量必须是 interval 的整数倍（远程 DB 往返可能跨过多个圈，
    // 断言"整圈对齐"而非"恰好一圈"，避免把网络抖动误判成逻辑错误）
    expect((secondNext - firstNext) % (second.body.interval_ms as number)).toBe(0);
  });

  it('settle-due 结清到期圈：产物/经验正确，started_at 前进，动作继续', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    const interval = 3000;
    // started_at 落在"已过 3 圈多一点"的位置：调用时至少 3 圈到期
    const startedAt = Date.now() - (3 * interval + interval / 2);
    await writeSave(token, v3Data({
      current_action: { skill_id: 'mining', action_id: 'mine_copper', started_at: startedAt },
    }));

    const res = await settleDue(token).expect(201);
    const ticks = res.body.report.ticks as number;
    // 远程 DB 往返可能让实际到期圈数略多于 3；断言"至少 3 且整批结清"
    expect(ticks).toBeGreaterThanOrEqual(3);
    expect(res.body.report.gained).toEqual([{ item_id: 'copper_ore', amount: ticks }]);
    expect(res.body.report.exp_gained).toEqual({ mining: ticks * 10 });
    expect(res.body.report.consumed).toEqual([]);

    // 动作继续：id / skill 不变，started_at 恰好推进 ticks × interval
    expect(res.body.current_action).toMatchObject({
      skill_id: 'mining',
      action_id: 'mine_copper',
      started_at: startedAt + ticks * interval,
    });
    // next_tick_at 为新边界（便于前端一次拿到、省一次往返）
    expect(res.body.next_tick_at).toBe(startedAt + ticks * interval + interval);
    expect(res.body.interval_ms).toBe(interval);

    // 落库校验：背包有 ticks 个铜矿，采矿经验 ticks×10
    const save = await getSave(token);
    expect(save.body.data.current_action.started_at).toBe(startedAt + ticks * interval);
    expect(save.body.data.inventory).toHaveLength(1);
    expect(save.body.data.inventory[0]).toMatchObject({ kind: 'stack', item_id: 'copper_ore', quantity: ticks });
    expect(save.body.data.skills.mining.exp).toBe(ticks * 10);

    // 幂等：紧接着再调一次，已无到期圈 → 空报告且 started_at 不变
    const again = await settleDue(token).expect(201);
    expect(again.body.report.ticks).toBe(0);
    expect(again.body.report.gained).toEqual([]);
    expect(again.body.current_action.started_at).toBe(startedAt + ticks * interval);
  });

  it('settle-due 在 ticks=0 时返回空报告且不改存档', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    const startedAt = Date.now();
    await writeSave(token, v3Data({
      current_action: { skill_id: 'mining', action_id: 'mine_copper', started_at: startedAt },
    }));

    const res = await settleDue(token).expect(201);
    expect(res.body.report.ticks).toBe(0);
    expect(res.body.report.gained).toEqual([]);
    expect(res.body.report.stop_reason).toBe('no_ticks');
    expect(res.body.current_action.started_at).toBe(startedAt);

    const save = await getSave(token);
    expect(save.body.data.current_action.started_at).toBe(startedAt);
    expect(save.body.data.inventory).toEqual([]);
  });

  it('无进行中活动时 settle-due 返回空报告且不报错', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    const res = await settleDue(token).expect(201);
    expect(res.body.report.ticks).toBe(0);
    expect(res.body.report.gained).toEqual([]);
    expect(res.body.current_action).toBeNull();
  });

  it('材料耗尽 → 动作结束且 stop_reason=input_exhausted', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    const interval = 2000; // burn_charcoal
    // 已过 5 圈，但只给 2 个枫木：引擎算完 2 圈后材料耗尽
    const startedAt = Date.now() - 5 * interval;
    await writeSave(token, v3Data({
      skills: { firemaking: { exp: exp(1) } },
      inventory: [stack('maple_log', 2)],
      current_action: { skill_id: 'firemaking', action_id: ACTION_BURN_CHARCOAL.id, started_at: startedAt },
    }));

    const res = await settleDue(token).expect(201);
    expect(res.body.report.ticks).toBe(2);
    expect(res.body.report.consumed).toEqual([{ item_id: 'maple_log', amount: 2 }]);
    expect(res.body.report.stop_reason).toBe('input_exhausted');
    // 动作结束
    expect(res.body.current_action).toBeNull();
    expect(res.body.next_tick_at).toBeNull();

    const save = await getSave(token);
    expect(save.body.data.current_action).toBeNull();
    expect(save.body.data.inventory).toEqual([]); // 2 个材料已全部消耗
  });

  it('背包满 → 动作结束且 stop_reason=inventory_full', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    const interval = 3000; // mine_copper
    const startedAt = Date.now() - 5 * interval;
    // 容量 2：铜矿已 998（第 1 圈补满到 999），第 2 圈需要新格但已无空位
    await writeSave(token, v3Data({
      inventory_capacity: 2,
      inventory: [stack('copper_ore', 998), stack('stone', 5)],
      current_action: { skill_id: 'mining', action_id: 'mine_copper', started_at: startedAt },
    }));

    const res = await settleDue(token).expect(201);
    expect(res.body.report.stop_reason).toBe('inventory_full');
    expect(res.body.report.ticks).toBe(1);
    expect(res.body.report.gained).toEqual([{ item_id: 'copper_ore', amount: 1 }]);
    expect(res.body.current_action).toBeNull();

    const save = await getSave(token);
    expect(save.body.data.current_action).toBeNull();
    expect(save.body.data.inventory).toHaveLength(2);
    expect(save.body.data.inventory[0]).toMatchObject({ item_id: 'copper_ore', quantity: 999 });
  });

  it('并发幂等：同一批圈只被结算一次（一个成功发放，另一个 ticks=0 或 409）', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    const interval = 3000;
    const startedAt = Date.now() - 4 * interval;
    await writeSave(token, v3Data({
      current_action: { skill_id: 'mining', action_id: 'mine_copper', started_at: startedAt },
    }));

    // 两个标签页同时到达圈末：CAS 保证同一批圈只发放一次。
    // 落败方有两种合法收敛：读到旧状态 → CAS 失败 409；
    // 或读到时已推进 → ticks=0 的空报告。关键是"总发放量"恰为一批。
    const [a, b] = await Promise.all([settleDue(token), settleDue(token)]);
    const ok = [a, b].filter((r) => r.status === 201);
    for (const r of [a, b]) {
      if (r.status !== 201) expect(r.status).toBe(409);
    }
    // 至多一次真正发放；另一请求要么 409，要么读到已推进状态返回 ticks=0
    const paid = ok.filter((r) => (r.body.report.ticks as number) > 0);
    expect(paid).toHaveLength(1);
    const paidTicks = paid[0].body.report.ticks as number;
    expect(paidTicks).toBeGreaterThanOrEqual(4);
    const ticksSum = ok.reduce((sum, r) => sum + (r.body.report.ticks as number), 0);
    expect(ticksSum).toBe(paidTicks);

    const save = await getSave(token);
    expect(save.body.data.inventory).toHaveLength(1);
    expect(save.body.data.inventory[0]).toMatchObject({ item_id: 'copper_ore', quantity: paidTicks });
    expect(save.body.data.skills.mining.exp).toBe(paidTicks * 10);
  });

  it('主路径回归：start → settle-due（继续）→ stop 结束动作', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    await request(app.getHttpServer())
      .post('/api/action/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'mining', actionId: 'mine_copper' })
      .expect(201);

    // 走满一圈后结清，动作继续
    await new Promise((resolve) => setTimeout(resolve, 3200));
    const settled = await settleDue(token).expect(201);
    expect(settled.body.report.ticks).toBeGreaterThanOrEqual(1);
    expect(settled.body.current_action).not.toBeNull();

    // 再 stop：正常结束（此时通常不足一圈，报告可为空——符合预期）
    const stopped = await request(app.getHttpServer())
      .post('/api/action/stop')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(stopped.body.current_action).toBeNull();

    const after = await request(app.getHttpServer())
      .get('/api/action/current')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(after.body.current_action).toBeNull();
  });
});
