// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
//
// 管理员账号取得方式同 admin-shop.e2e-spec.ts：把邮箱写进 ADMIN_EMAILS，
// 注册时 AccountsService 命中白名单即落库 role='admin'。
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';
import { CURRENT_SAVE_VERSION, type SaveDataV4 } from './../src/save/save-shape.js';
import { equipment, stack, v4Data } from './save-fixtures.js';

let app: INestApplication<App>;

const ADMIN_EMAIL = `admin-player-e2e-admin-${randomUUID()}@example.com`;
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

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Creds {
  token: string;
  email: string;
  accountId: string;
}

async function registerAndLogin(email?: string): Promise<Creds> {
  const finalEmail = email ?? `admin-player-e2e-${randomUUID()}@example.com`;
  const username = `adminplayer_${randomUUID().slice(0, 8)}`;
  const password = 'test-password-8';
  const registered = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ username, email: finalEmail, password })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: finalEmail, password })
    .expect(200);
  return {
    token: res.body.accessToken as string,
    email: finalEmail,
    accountId: registered.body.account.id as string,
  };
}

// admin 邮箱只能注册一次，后续用例复用同一份凭据
let adminCredsPromise: Promise<Creds> | undefined;
const adminCreds = () => (adminCredsPromise ??= registerAndLogin(ADMIN_EMAIL));

/** 懒创建存档（保证后续 POST 的版本校验有基线）；同时拿回 player.id */
async function ensureSave(token: string): Promise<string> {
  const save = await request(app.getHttpServer())
    .get('/api/save')
    .set(authed(token))
    .expect(200);
  expect(save.body.version).toBe(CURRENT_SAVE_VERSION);
  const player = await request(app.getHttpServer())
    .get('/api/player')
    .set(authed(token))
    .expect(200);
  // /api/player 不返回 player.id；改用 admin list 按 email 定位（见 playerIdOf）
  expect(typeof player.body.name).toBe('string');
  return player.body.name as string;
}

/** 直接覆写整份存档，用于铺垫容量/技能/动作状态 */
async function writeData(token: string, data: SaveDataV4) {
  await request(app.getHttpServer())
    .post('/api/save')
    .set(authed(token))
    .send({ version: CURRENT_SAVE_VERSION, data })
    .expect(201);
}

const getSave = (token: string) =>
  request(app.getHttpServer()).get('/api/save').set(authed(token));

/** 从管理列表里按邮箱找到 player.id（管理接口按 playerId 操作，故测试必须先取到） */
async function playerIdOf(adminToken: string, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .get('/api/admin/players')
    .query({ query: email, limit: 10 })
    .set(authed(adminToken))
    .expect(200);
  const row = (res.body.items as Array<{ id: string; email: string }>).find(
    (item) => item.email === email,
  );
  expect(row).toBeTruthy();
  return row!.id;
}

describe('/api/admin/players (e2e)', () => {
  it('未登录访问全部 401', async () => {
    await request(app.getHttpServer()).get('/api/admin/players').expect(401);
    await request(app.getHttpServer()).get(`/api/admin/players/${randomUUID()}`).expect(401);
    await request(app.getHttpServer())
      .patch(`/api/admin/players/${randomUUID()}/role`)
      .send({ role: 'admin' })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/api/admin/players/${randomUUID()}/ban`)
      .send({ banned: true })
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/admin/players/${randomUUID()}/grant-items`)
      .send({ items: [{ item_id: 'wood', quantity: 1 }] })
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/admin/players/${randomUUID()}/grant-resources`)
      .send({ resources: { gold: 1 } })
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/admin/players/${randomUUID()}/reset-state`)
      .send({ what: 'all' })
      .expect(401);
  });

  it('普通账号（player）访问管理接口返回 403', async () => {
    const player = await registerAndLogin();
    await request(app.getHttpServer())
      .get('/api/admin/players')
      .set(authed(player.token))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/admin/players/${randomUUID()}/grant-items`)
      .set(authed(player.token))
      .send({ items: [{ item_id: 'wood', quantity: 1 }] })
      .expect(403);
  });

  it('列表按邮箱搜索命中，摘要含等级/资源/容量且不泄露密码', async () => {
    const admin = await adminCreds();
    const player = await registerAndLogin();
    await ensureSave(player.token);
    // 给这个玩家铺垫资源与技能，验证摘要确实取到了 JSONB 切片
    await writeData(
      player.token,
      v4Data({
        abstract_resources: { gold: 77 },
        skills: { attack: { exp: 27 } },
        inventory: [stack('wood', 3)],
      }),
    );

    const res = await request(app.getHttpServer())
      .get('/api/admin/players')
      .query({ query: player.email })
      .set(authed(admin.token))
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.page).toBe('number');
    expect(typeof res.body.limit).toBe('number');

    const row = (res.body.items as Array<Record<string, unknown>>).find(
      (item) => item.email === player.email,
    )!;
    expect(row).toBeTruthy();
    expect(row.role).toBe('player');
    expect(row.banned).toBe(false);
    expect(typeof row.created_at).toBe('number');
    expect(row).not.toHaveProperty('passwordHash');
    expect(row).not.toHaveProperty('data');
    const summary = row.summary as Record<string, unknown>;
    expect(summary.level).toBe(3); // 27 exp = 3 级
    expect(summary.abstract_resources).toEqual({ gold: 77 });
    expect(summary.inventory_used).toBe(1);
    expect(summary.inventory_capacity).toBe(100);
  });

  it('搜索无命中时返回空列表而不是报错', async () => {
    const admin = await adminCreds();
    const res = await request(app.getHttpServer())
      .get('/api/admin/players')
      .query({ query: `no-such-${randomUUID()}` })
      .set(authed(admin.token))
      .expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('详情返回只读快照（技能/资源/背包/装备/容量）', async () => {
    const admin = await adminCreds();
    const player = await registerAndLogin();
    await ensureSave(player.token);
    const sword = equipment({ slot: 'main_hand', required_level: 1 });
    await writeData(
      player.token,
      v4Data({
        skills: { attack: { exp: 8 } },
        abstract_resources: { gold: 5, res_wood: 2 },
        inventory: [stack('copper_ore', 5), sword],
        equipment: { main_hand: sword },
        inventory_capacity: 30,
        storage_capacity: 60,
      }),
    );
    const playerId = await playerIdOf(admin.token, player.email);

    const res = await request(app.getHttpServer())
      .get(`/api/admin/players/${playerId}`)
      .set(authed(admin.token))
      .expect(200);

    expect(res.body).toMatchObject({
      id: playerId,
      account_id: player.accountId,
      email: player.email,
      role: 'player',
      banned: false,
    });
    const snapshot = res.body.snapshot as Record<string, any>;
    expect(snapshot.level).toBe(2); // 8 exp = 2 级
    expect(snapshot.abstract_resources).toEqual({ gold: 5, res_wood: 2 });
    expect(snapshot.inventory).toHaveLength(2);
    expect(snapshot.equipment.main_hand.uid).toBe(sword.uid);
    expect(snapshot.carry).toEqual({
      inventory_used: 2,
      inventory_capacity: 30,
      storage_used: 0,
      storage_capacity: 60,
    });
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('详情：playerId 不存在 → 404', async () => {
    const admin = await adminCreds();
    await request(app.getHttpServer())
      .get(`/api/admin/players/${randomUUID()}`)
      .set(authed(admin.token))
      .expect(404);
  });

  it('改角色 player→admin→player，并落审计', async () => {
    const admin = await adminCreds();
    const player = await registerAndLogin();
    await ensureSave(player.token);
    const playerId = await playerIdOf(admin.token, player.email);

    const promoted = await request(app.getHttpServer())
      .patch(`/api/admin/players/${playerId}/role`)
      .set(authed(admin.token))
      .send({ role: 'admin' })
      .expect(200);
    expect(promoted.body).toMatchObject({ role: 'admin', changed: true });

    // 提权后立即生效：该账号现在能读管理接口（不依赖旧 token 的角色）
    await request(app.getHttpServer())
      .get('/api/admin/players')
      .set(authed(player.token))
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/admin/players/${playerId}/role`)
      .set(authed(admin.token))
      .send({ role: 'player' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/admin/players')
      .set(authed(player.token))
      .expect(403);

    const audit = await request(app.getHttpServer())
      .get('/api/admin/audit-logs')
      .query({ target_type: 'player', target_id: playerId })
      .set(authed(admin.token))
      .expect(200);
    const record = (audit.body.items as Array<Record<string, unknown>>).find(
      (row) => row.action === 'player.role_update',
    );
    expect(record).toBeTruthy();
    expect(record!.admin_account_id).toBe(admin.accountId);
  });

  it('不允许取消自己的管理员角色 → 403', async () => {
    const admin = await adminCreds();
    const self = await playerIdOf(admin.token, admin.email);
    await request(app.getHttpServer())
      .patch(`/api/admin/players/${self}/role`)
      .set(authed(admin.token))
      .send({ role: 'player' })
      .expect(403);
  });

  it('DTO 校验：role/banned/what 非法 → 400', async () => {
    const admin = await adminCreds();
    const player = await registerAndLogin();
    await ensureSave(player.token);
    const playerId = await playerIdOf(admin.token, player.email);

    await request(app.getHttpServer())
      .patch(`/api/admin/players/${playerId}/role`)
      .set(authed(admin.token))
      .send({ role: 'root' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/admin/players/${playerId}/ban`)
      .set(authed(admin.token))
      .send({ banned: 'yes' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/admin/players/${playerId}/reset-state`)
      .set(authed(admin.token))
      .send({ what: 'everything' })
      .expect(400);
  });

  it('封禁 → 该账号登录 401、已签发 token 立即失效；解封恢复', async () => {
    const admin = await adminCreds();
    const player = await registerAndLogin();
    await ensureSave(player.token);

    // 封禁前：token 可正常访问
    await request(app.getHttpServer()).get('/api/player').set(authed(player.token)).expect(200);

    const playerId = await playerIdOf(admin.token, player.email);
    await request(app.getHttpServer())
      .patch(`/api/admin/players/${playerId}/ban`)
      .set(authed(admin.token))
      .send({ banned: true })
      .expect(200);

    // 拦截点二：已签发 token 带 banned 复核 → 401
    await request(app.getHttpServer()).get('/api/player').set(authed(player.token)).expect(401);
    // 拦截点一：重新登录被拒（密码正确也 401）
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: player.email, password: 'test-password-8' })
      .expect(401);

    // 解封 → 登录恢复
    await request(app.getHttpServer())
      .patch(`/api/admin/players/${playerId}/ban`)
      .set(authed(admin.token))
      .send({ banned: false })
      .expect(200);
    const relogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: player.email, password: 'test-password-8' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/player')
      .set(authed(relogin.body.accessToken as string))
      .expect(200);
  });

  it('不允许封禁自己 → 403', async () => {
    const admin = await adminCreds();
    const self = await playerIdOf(admin.token, admin.email);
    await request(app.getHttpServer())
      .patch(`/api/admin/players/${self}/ban`)
      .set(authed(admin.token))
      .send({ banned: true })
      .expect(403);
  });

  it('发放物品/装备入背包（白板），并落审计', async () => {
    const admin = await adminCreds();
    const player = await registerAndLogin();
    await ensureSave(player.token);
    const playerId = await playerIdOf(admin.token, player.email);

    const res = await request(app.getHttpServer())
      .post(`/api/admin/players/${playerId}/grant-items`)
      .set(authed(admin.token))
      .send({
        items: [{ item_id: 'wood', quantity: 5 }],
        equipments: [{ template_id: 'short_sword', quality: 'common' }],
      })
      .expect(201);
    expect(res.body.granted).toEqual([
      { kind: 'item', item_id: 'wood', quantity: 5 },
      { kind: 'equipment', template_id: 'short_sword', quality: 'common' },
    ]);

    const save = (await getSave(player.token).expect(200)).body.data as SaveDataV4;
    expect(save.inventory).toHaveLength(2);
    const wood = save.inventory.find((i) => i.kind === 'stack')!;
    expect(wood).toMatchObject({ item_id: 'wood', quantity: 5 });
    const eq = save.inventory.find((i) => i.kind === 'equipment')!;
    expect(eq).toMatchObject({ template_id: 'short_sword', quality: 'common' });
    // 白板：管理发放不走词缀抽奖
    expect((eq as { prefix_affix: unknown }).prefix_affix).toBeNull();

    const audit = await request(app.getHttpServer())
      .get('/api/admin/audit-logs')
      .query({ target_type: 'player', target_id: playerId })
      .set(authed(admin.token))
      .expect(200);
    expect(
      (audit.body.items as Array<{ action: string }>).some(
        (row) => row.action === 'player.grant_items',
      ),
    ).toBe(true);
  });

  it('发放物品：背包容量不足 → 403 且存档不变', async () => {
    const admin = await adminCreds();
    const player = await registerAndLogin();
    await ensureSave(player.token);
    // 容量 1 且已占 1 格：再发 2 种不同物品必超格
    await writeData(player.token, v4Data({ inventory: [stack('wood', 1)], inventory_capacity: 1 }));
    const before = (await getSave(player.token).expect(200)).body.data;
    const playerId = await playerIdOf(admin.token, player.email);

    const res = await request(app.getHttpServer())
      .post(`/api/admin/players/${playerId}/grant-items`)
      .set(authed(admin.token))
      .send({ items: [{ item_id: 'copper_ore', quantity: 1 }, { item_id: 'iron_ore', quantity: 1 }] })
      .expect(403);
    expect(res.body.message).toContain('容量不足');

    const after = (await getSave(player.token).expect(200)).body.data;
    expect(after).toEqual(before);
  });

  it('发放物品：未注册 item_id / 非法数量 / 未注册模板 / 空请求 → 400', async () => {
    const admin = await adminCreds();
    const player = await registerAndLogin();
    await ensureSave(player.token);
    const playerId = await playerIdOf(admin.token, player.email);
    const url = `/api/admin/players/${playerId}/grant-items`;

    await request(app.getHttpServer())
      .post(url)
      .set(authed(admin.token))
      .send({ items: [{ item_id: 'no_such_item', quantity: 1 }] })
      .expect(400);
    await request(app.getHttpServer())
      .post(url)
      .set(authed(admin.token))
      .send({ items: [{ item_id: 'wood', quantity: 0 }] })
      .expect(400);
    await request(app.getHttpServer())
      .post(url)
      .set(authed(admin.token))
      .send({ equipments: [{ template_id: 'no_such_template' }] })
      .expect(400);
    // 皮甲模板只允许 common~uncommon，epic 属模板区间不符
    await request(app.getHttpServer())
      .post(url)
      .set(authed(admin.token))
      .send({ equipments: [{ template_id: 'worn_leather_armor', quality: 'epic' }] })
      .expect(400);
    // 两个数组都空
    await request(app.getHttpServer())
      .post(url)
      .set(authed(admin.token))
      .send({ items: [], equipments: [] })
      .expect(400);
  });

  it('补抽象资源（不占背包），非法 id → 400，扣成负数 → 400', async () => {
    const admin = await adminCreds();
    const player = await registerAndLogin();
    await ensureSave(player.token);
    const playerId = await playerIdOf(admin.token, player.email);
    const url = `/api/admin/players/${playerId}/grant-resources`;

    const res = await request(app.getHttpServer())
      .post(url)
      .set(authed(admin.token))
      .send({ resources: { gold: 500, res_wood: 3 } })
      .expect(201);
    expect(res.body.changes).toEqual(
      expect.arrayContaining([
        { id: 'gold', delta: 500, before: 0, after: 500 },
        { id: 'res_wood', delta: 3, before: 0, after: 3 },
      ]),
    );

    // 抽象资源不占背包：背包保持空
    const save = (await getSave(player.token).expect(200)).body.data as SaveDataV4;
    expect(save.inventory).toEqual([]);
    expect(save.abstract_resources).toEqual({ gold: 500, res_wood: 3 });

    // 未注册资源 id
    await request(app.getHttpServer())
      .post(url)
      .set(authed(admin.token))
      .send({ resources: { no_such_resource: 1 } })
      .expect(400);
    // 扣成负数被拒
    await request(app.getHttpServer())
      .post(url)
      .set(authed(admin.token))
      .send({ resources: { gold: -1000 } })
      .expect(400);
    // 空对象
    await request(app.getHttpServer())
      .post(url)
      .set(authed(admin.token))
      .send({ resources: {} })
      .expect(400);

    const audit = await request(app.getHttpServer())
      .get('/api/admin/audit-logs')
      .query({ target_type: 'player', target_id: playerId })
      .set(authed(admin.token))
      .expect(200);
    expect(
      (audit.body.items as Array<{ action: string }>).some(
        (row) => row.action === 'player.grant_resources',
      ),
    ).toBe(true);
  });

  it('重置状态：action 清 current_action + 队列，combat 单独清当前战斗', async () => {
    const admin = await adminCreds();
    const player = await registerAndLogin();
    await ensureSave(player.token);
    const playerId = await playerIdOf(admin.token, player.email);
    const url = `/api/admin/players/${playerId}/reset-state`;

    await writeData(
      player.token,
      v4Data({
        current_action: { skill_id: 'mining', action_id: 'mine_copper', started_at: Date.now() },
        action_queue: [{ action_id: 'mine_copper', skill_id: 'mining', count: 5 }],
        current_combat: { enemy_id: 'chicken', started_at: Date.now() },
      }),
    );

    const res = await request(app.getHttpServer())
      .post(url)
      .set(authed(admin.token))
      .send({ what: 'all' })
      .expect(201);
    expect(res.body.cleared).toEqual({ current_action: true, action_queue: true, current_combat: true });

    const save = (await getSave(player.token).expect(200)).body.data as SaveDataV4 & {
      current_combat: unknown;
    };
    expect(save.current_action).toBeNull();
    expect(save.action_queue).toEqual([]);
    expect(save.current_combat).toBeNull();

    // 幂等：没卡时再重置同样成功（并落审计）
    await request(app.getHttpServer())
      .post(url)
      .set(authed(admin.token))
      .send({ what: 'action' })
      .expect(201);

    const audit = await request(app.getHttpServer())
      .get('/api/admin/audit-logs')
      .query({ target_type: 'player', target_id: playerId })
      .set(authed(admin.token))
      .expect(200);
    expect(
      (audit.body.items as Array<{ action: string }>).some(
        (row) => row.action === 'player.reset_state',
      ),
    ).toBe(true);
  });
});
