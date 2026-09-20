// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';
import { CURRENT_SAVE_VERSION, type SaveDataV4 } from './../src/save/save-shape.js';
import { stack, v4Data } from './save-fixtures.js';

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
  const email = `queue-e2e-${randomUUID()}@example.com`;
  const username = `queue_${randomUUID().slice(0, 8)}`;
  const password = 'test-password-8';
  await request(app.getHttpServer()).post('/api/auth/register').send({ username, email, password }).expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken as string;
}

async function ensureSave(token: string) {
  await request(app.getHttpServer()).get('/api/save').set('Authorization', `Bearer ${token}`).expect(200);
}

async function writeData(token: string, data: SaveDataV4) {
  await request(app.getHttpServer())
    .post('/api/save')
    .set('Authorization', `Bearer ${token}`)
    .send({ version: CURRENT_SAVE_VERSION, data })
    .expect(201);
}

async function readData(token: string): Promise<SaveDataV4> {
  const res = await request(app.getHttpServer())
    .get('/api/save')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.data as SaveDataV4;
}

const enqueue = (token: string, skillId: string, actionId: string, count: number) =>
  request(app.getHttpServer())
    .post('/api/action/queue')
    .set('Authorization', `Bearer ${token}`)
    .send({ skillId, actionId, count });

const getQueue = (token: string) =>
  request(app.getHttpServer())
    .get('/api/action/queue')
    .set('Authorization', `Bearer ${token}`);

const settleDue = (token: string) =>
  request(app.getHttpServer())
    .post('/api/action/settle-due')
    .set('Authorization', `Bearer ${token}`);

describe('/api/action/queue (e2e)', () => {
  it('未带 token 访问队列接口返回 401', async () => {
    await request(app.getHttpServer()).get('/api/action/queue').expect(401);
    await request(app.getHttpServer()).post('/api/action/queue').send({}).expect(401);
  });

  it('入队 3 项：GET 返回队列与槽位信息（10 槽 / 3 可用）', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    await enqueue(token, 'mining', 'mine_copper', 5).expect(201);
    await enqueue(token, 'woodcutting', 'chop_maple', 3).expect(201);
    const third = await enqueue(token, 'mining', 'mine_copper', 2).expect(201);
    expect(third.body.queue_slots).toEqual({ max: 10, unlocked: 3 });

    const res = await getQueue(token).expect(200);
    expect(res.body.action_queue).toEqual([
      { action_id: 'mine_copper', skill_id: 'mining', count: 5 },
      { action_id: 'chop_maple', skill_id: 'woodcutting', count: 3 },
      { action_id: 'mine_copper', skill_id: 'mining', count: 2 },
    ]);
    expect(res.body.queue_slots).toEqual({ max: 10, unlocked: 3 });
  });

  it('第 4 项被拒（本体仅开放 3 槽）', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    await enqueue(token, 'mining', 'mine_copper', 1).expect(201);
    await enqueue(token, 'mining', 'mine_copper', 1).expect(201);
    await enqueue(token, 'mining', 'mine_copper', 1).expect(201);
    const res = await enqueue(token, 'mining', 'mine_copper', 1).expect(403);
    expect(res.body.message).toContain('队列已满');
  });

  it('入队校验：技能/动作不匹配 403、等级不足 403、count<1 400', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    // mine_copper 不属于 woodcutting
    await enqueue(token, 'woodcutting', 'mine_copper', 1).expect(403);
    // mine_iron 需要 15 级
    await enqueue(token, 'mining', 'mine_iron', 1).expect(403);
    // count 非法
    await enqueue(token, 'mining', 'mine_copper', 0).expect(400);
  });

  it('PATCH 改行：改次数与换工作', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await enqueue(token, 'mining', 'mine_copper', 5).expect(201);

    const patched = await request(app.getHttpServer())
      .patch('/api/action/queue/0')
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 9 })
      .expect(200);
    expect(patched.body.action_queue[0]).toMatchObject({ action_id: 'mine_copper', count: 9 });

    const swapped = await request(app.getHttpServer())
      .patch('/api/action/queue/0')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'woodcutting', actionId: 'chop_maple', count: 4 })
      .expect(200);
    expect(swapped.body.action_queue[0]).toEqual({
      action_id: 'chop_maple',
      skill_id: 'woodcutting',
      count: 4,
    });
  });

  it('DELETE 移除行', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await enqueue(token, 'mining', 'mine_copper', 1).expect(201);
    await enqueue(token, 'woodcutting', 'chop_maple', 1).expect(201);

    const res = await request(app.getHttpServer())
      .delete('/api/action/queue/0')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.action_queue).toEqual([
      { action_id: 'chop_maple', skill_id: 'woodcutting', count: 1 },
    ]);
  });

  it('PATCH 换掉正在跑的队首：先结算旧动作再让新动作从头起跑，不丢收益', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    const interval = 3000; // mine_copper
    await writeData(
      token,
      v4Data({
        current_action: {
          skill_id: 'mining',
          action_id: 'mine_copper',
          started_at: Date.now() - interval - 500,
        },
        action_queue: [{ action_id: 'mine_copper', skill_id: 'mining', count: 5 }],
      }),
    );

    const res = await request(app.getHttpServer())
      .patch('/api/action/queue/0')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'woodcutting', actionId: 'chop_maple', count: 3 })
      .expect(200);
    expect(res.body.action_queue).toEqual([
      { action_id: 'chop_maple', skill_id: 'woodcutting', count: 3 },
    ]);
    // 旧动作已被结算：1 圈铜矿入包，current_action 清空
    expect(res.body.current_action).toBeNull();
    const save = await readData(token);
    expect(save.current_action).toBeNull();
    expect(save.inventory).toEqual([
      expect.objectContaining({ kind: 'stack', item_id: 'copper_ore', quantity: 1 }),
    ]);
  });

  it('在线逐项推进：空闲时 settle-due 自动起跑队首，完成后移除并接续下一项', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    const interval = 3000; // mine_copper
    // 队列：2 圈铜矿(3s) + 1 圈枫木(3s)；started_at 提前 2 圈多一点
    const startedAt = Date.now() - (2 * interval + interval / 2);
    await writeData(
      token,
      v4Data({
        current_action: { skill_id: 'mining', action_id: 'mine_copper', started_at: startedAt },
        action_queue: [
          { action_id: 'mine_copper', skill_id: 'mining', count: 2 },
          { action_id: 'chop_maple', skill_id: 'woodcutting', count: 1 },
        ],
      }),
    );

    const first = await settleDue(token).expect(201);
    // 第一项 2 圈完成 → 从队列移除；第二项接续起跑
    expect(first.body.queue_reports[0]).toMatchObject({ action_id: 'mine_copper', ticks: 2, completed: true });
    expect(first.body.action_queue).toEqual([
      { action_id: 'chop_maple', skill_id: 'woodcutting', count: 1 },
    ]);
    expect(first.body.current_action).toMatchObject({ action_id: 'chop_maple' });
    expect(first.body.report.gained).toEqual([{ item_id: 'copper_ore', amount: 2 }]);

    // 第二项走满一圈，完成 → 队列清空、回到空闲
    const started2 = first.body.current_action.started_at as number;
    const save = await readData(token);
    save.current_action = { skill_id: 'woodcutting', action_id: 'chop_maple', started_at: started2 };
    // 直接改写 started_at 为过去，模拟时间经过
    await writeData(token, {
      ...save,
      current_action: {
        skill_id: 'woodcutting',
        action_id: 'chop_maple',
        started_at: Date.now() - interval - 500,
      },
    });

    const second = await settleDue(token).expect(201);
    expect(second.body.action_queue).toEqual([]);
    expect(second.body.current_action).toBeNull();
    expect(second.body.report.gained).toEqual([{ item_id: 'maple_log', amount: 1 }]);

    const finalSave = await readData(token);
    expect(finalSave.current_action).toBeNull();
    expect(finalSave.action_queue).toEqual([]);
  });

  it('空闲 + 队列非空：settle-due 自动起跑队首', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await writeData(
      token,
      v4Data({
        action_queue: [{ action_id: 'mine_copper', skill_id: 'mining', count: 3 }],
      }),
    );

    const res = await settleDue(token).expect(201);
    expect(res.body.current_action).toMatchObject({ action_id: 'mine_copper' });
    expect(typeof res.body.current_action.started_at).toBe('number');
    expect(res.body.action_queue).toHaveLength(1);
  });

  it('离线按队列顺序结算：不超 24h，逐项完成', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    const interval = 3000;
    // 队列：2 圈铜矿 + 1 圈枫木；started_at 提前 2 天 → 受 24h 上限，但两项总时长 9s 远小于上限
    await writeData(
      token,
      v4Data({
        current_action: { skill_id: 'mining', action_id: 'mine_copper', started_at: Date.now() - 2 * 24 * 3600 * 1000 },
        action_queue: [
          { action_id: 'mine_copper', skill_id: 'mining', count: 2 },
          { action_id: 'chop_maple', skill_id: 'woodcutting', count: 1 },
        ],
      }),
    );

    const res = await settleDue(token).expect(201);
    // 24h 上限内两项都能跑完
    expect(res.body.action_queue).toEqual([]);
    expect(res.body.report.gained).toEqual([
      { item_id: 'copper_ore', amount: 2 },
      { item_id: 'maple_log', amount: 1 },
    ]);
    expect(res.body.report.effective_seconds).toBeLessThanOrEqual(86_400);
    expect(res.body.current_action).toBeNull();
  });

  it('材料耗尽：按实际圈数结算并中止后续队列项', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    // burn_charcoal 间隔 2s、耗 1 枫木；给 2 个枫木但队列要 5 圈，后续还有一项铜矿
    await writeData(
      token,
      v4Data({
        skills: { firemaking: { exp: 0 } },
        inventory: [stack('maple_log', 2)],
        action_queue: [
          { action_id: 'burn_charcoal', skill_id: 'firemaking', count: 5 },
          { action_id: 'mine_copper', skill_id: 'mining', count: 3 },
        ],
      }),
    );

    // 先起跑
    await settleDue(token).expect(201);
    const save = await readData(token);
    // 把 started_at 拨到过去：足够 5 圈的时间
    await writeData(token, {
      ...save,
      current_action: {
        skill_id: 'firemaking',
        action_id: 'burn_charcoal',
        started_at: Date.now() - 5 * 2000 - 500,
      },
    });

    const res = await settleDue(token).expect(201);
    const burn = (res.body.queue_reports as Array<Record<string, unknown>>).find(
      (r) => r.action_id === 'burn_charcoal',
    );
    expect(burn).toMatchObject({ ticks: 2, completed: false, stop_reason: 'input_exhausted' });
    // 后续铜矿项未被消费，剩余队列保留
    expect(res.body.action_queue).toEqual([
      { action_id: 'burn_charcoal', skill_id: 'firemaking', count: 3 },
      { action_id: 'mine_copper', skill_id: 'mining', count: 3 },
    ]);
    expect(res.body.current_action).toBeNull();

    const finalSave = await readData(token);
    expect(finalSave.current_action).toBeNull();
    expect(finalSave.inventory).toEqual([]); // 2 个枫木全被消耗
  });

  it('手动开始与队列互斥（方案 b）：队列非空时 start 返回 409', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);
    await enqueue(token, 'mining', 'mine_copper', 3).expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/action/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'woodcutting', actionId: 'chop_maple' })
      .expect(409);
    expect(res.body.message).toContain('队列进行中');
  });

  it('入队时正在手动跑的动作先被结算，队列接管', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    const interval = 3000;
    await writeData(
      token,
      v4Data({
        current_action: { skill_id: 'mining', action_id: 'mine_copper', started_at: Date.now() - interval - 500 },
      }),
    );

    await enqueue(token, 'woodcutting', 'chop_maple', 2).expect(201);
    const save = await readData(token);
    // 手动动作已被结算（1 圈铜矿入包），current_action 清空等待 settle-due 起跑队首
    expect(save.current_action).toBeNull();
    expect(save.action_queue).toEqual([
      { action_id: 'chop_maple', skill_id: 'woodcutting', count: 2 },
    ]);
    expect(save.inventory).toEqual([
      expect.objectContaining({ kind: 'stack', item_id: 'copper_ore', quantity: 1 }),
    ]);
  });

  it('手动开始（无队列）仍走原通路并可被 stop 结算', async () => {
    const token = await registerAndLogin();
    await ensureSave(token);

    await request(app.getHttpServer())
      .post('/api/action/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ skillId: 'mining', actionId: 'mine_copper' })
      .expect(201);

    const stop = await request(app.getHttpServer())
      .post('/api/action/stop')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(stop.body.current_action).toBeNull();
    expect(stop.body.action_queue).toEqual([]);
  });
});
