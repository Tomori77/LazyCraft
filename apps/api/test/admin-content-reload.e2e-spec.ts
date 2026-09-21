// task-42 内容显式重载 e2e。
//
// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库。
// 管理员账号取得方式同 admin-content.e2e-spec.ts：把邮箱写进 ADMIN_EMAILS，
// 注册时 AccountsService 命中白名单即落库 role='admin'。
//
// 重要：本文件会写 content_pack_state 表，并让服务端换掉内存快照。
// 用例结束必须把 core 置回启用**并 reload**，否则同测试库其它挂 AppModule 的 e2e
// 会因内容缺失而失败（同进程内尤其如此）。
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';
import { PrismaClient } from './../src/lib/prisma-client/client.js';
import { CURRENT_SAVE_VERSION, type SaveDataV4 } from './../src/save/save-shape.js';
import { stack, v4Data } from './save-fixtures.js';

let app: INestApplication<App>;
let prisma: PrismaClient;

// 邮箱 local part 必须 ≤64 字符（@IsEmail 的 RFC 限制），故前后缀都取短
const ADMIN_EMAIL = `creload-admin-${randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = `${process.env.ADMIN_EMAILS ?? ''},${ADMIN_EMAIL}`;

beforeAll(async () => {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.init();
  prisma = app.get(PrismaClient);
});

afterAll(async () => {
  // 兜底恢复：无论用例怎么失败，都别把 core 停用状态留在共享测试库里
  await prisma.contentPackState.upsert({
    where: { id: 'core' },
    create: { id: 'core', enabled: true },
    update: { enabled: true },
  });
  await app.close();
});

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Creds {
  token: string;
  accountId: string;
}

async function registerAndLogin(email: string): Promise<Creds> {
  const password = 'test-password-8';
  const username = `adcreload_${randomUUID().slice(0, 8)}`;
  const regRes = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ username, email, password });
  if (regRes.status !== 201) {
    throw new Error(`register ${regRes.status}: ${JSON.stringify(regRes.body)}`);
  }
  const registered = regRes;
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return { token: res.body.accessToken as string, accountId: registered.body.account.id as string };
}

// admin 邮箱只能注册一次，后续用例复用同一份凭据
let adminCredsPromise: Promise<Creds> | undefined;
const adminCreds = () => (adminCredsPromise ??= registerAndLogin(ADMIN_EMAIL));
const playerCreds = () => registerAndLogin(`creload-p-${randomUUID()}@example.com`);

/** 懒创建存档（保证后续 POST 版本校验有基线） */
async function ensureSave(token: string): Promise<void> {
  const save = await request(app.getHttpServer())
    .get('/api/save')
    .set(authed(token))
    .expect(200);
  expect(save.body.version).toBe(CURRENT_SAVE_VERSION);
}

/** 直接覆写整份存档，用于铺垫动作/队列状态 */
async function writeData(token: string, data: SaveDataV4): Promise<void> {
  await request(app.getHttpServer())
    .post('/api/save')
    .set(authed(token))
    .send({ version: CURRENT_SAVE_VERSION, data })
    .expect(201);
}

const readData = async (token: string): Promise<SaveDataV4> => {
  const res = await request(app.getHttpServer()).get('/api/save').set(authed(token)).expect(200);
  return res.body.data as SaveDataV4;
};

const setCoreEnabled = (token: string, enabled: boolean) =>
  request(app.getHttpServer())
    .patch('/api/admin/content/packs/core')
    .set(authed(token))
    .send({ enabled })
    .expect(200);

const reload = (token: string) =>
  request(app.getHttpServer()).post('/api/admin/content/reload').set(authed(token));

/** 当前公开内容快照 */
const getContent = () =>
  request(app.getHttpServer()).get('/api/content').expect(200);

describe('/api/admin/content/reload (e2e)', () => {
  it('未登录访问 → 401', async () => {
    await request(app.getHttpServer()).post('/api/admin/content/reload').expect(401);
  });

  it('普通账号（player）访问 → 403', async () => {
    const player = await playerCreds();
    await request(app.getHttpServer())
      .post('/api/admin/content/reload')
      .set(authed(player.token))
      .expect(403);
  });

  it('core 启用时重载：成功返回生效集合 + 0 校验错误 + 无中断', async () => {
    const admin = await adminCreds();
    await setCoreEnabled(admin.token, true);

    const res = await reload(admin.token).expect(201);
    expect(res.body.enabled_packs).toContain('core');
    expect(res.body.validate_errors).toBe(0);
    expect(res.body.affected_players).toBe(0);
    expect(res.body.interrupted_actions).toEqual([]);
    expect(Array.isArray(res.body.packs)).toBe(true);
  });

  /**
   * 为什么把"停用 → 断言 → 恢复"收进同一个 it()？
   *   停用 core 会换掉全局内容快照并按设计全库中断引用停用动作的存档；
   *   同库的其它 e2e 正跑着 core 动作时会被打到。把整个停用窗口收敛到一个用例内、
   *   并在 finally 里**立即**恢复 core + 重载，可把对他人的影响时间压到最短
   *   （默认 e2e 已串行跑文件，这里再做一层收敛以防将来并行）。
   */
  it('停用 core → reload：内容即时切换 + 中断引用停用动作的存档 + 其它数据不动（结尾恢复）', async () => {
    const admin = await adminCreds();

    // 存档 A：引用 core 动作（应被中断）+ 携带其它玩家数据（必须原样保留）
    const affected = await playerCreds();
    await ensureSave(affected.token);
    await writeData(
      affected.token,
      v4Data({
        current_action: { skill_id: 'mining', action_id: 'mine_tiny_vein', started_at: Date.now() },
        action_queue: [
          { skill_id: 'woodcutting', action_id: 'chop_tree', count: 3 },
          // 未安装 pack 的动作 id：不在"已停用动作集合"里，必须原样保留
          { skill_id: 'dlc', action_id: 'dlc_legacy_action', count: 5 },
        ],
        inventory: [stack('copper_ore', 7)],
        abstract_resources: { gold: 42 },
        skills: { mining: { exp: 120 } },
      }),
    );

    // 存档 B：不引用任何 core 动作（必须完全不被改动）
    const intact = await playerCreds();
    await ensureSave(intact.token);
    const untouched = v4Data({
      current_action: null,
      action_queue: [{ skill_id: 'dlc', action_id: 'dlc_legacy_action', count: 2 }],
      inventory: [stack('wood', 9)],
      abstract_resources: { gold: 3 },
      skills: { woodcutting: { exp: 27 } },
    });
    await writeData(intact.token, untouched);

    try {
      // 停用前：core 内容可见
      const before = await getContent();
      const beforeIds = new Set((before.body.actions as Array<{ id: string }>).map((a) => a.id));
      expect(beforeIds.has('mine_tiny_vein')).toBe(true);

      await setCoreEnabled(admin.token, false);
      const res = await reload(admin.token).expect(201);

      // 不重启下 /api/content 立即用新集合（动作/技能/pack 全消失）
      const after = await getContent();
      expect((after.body.actions as unknown[]).length).toBe(0);
      expect((after.body.skills as unknown[]).length).toBe(0);
      expect((after.body.packs as unknown[]).length).toBe(0);

      // 中断：响应列出被中断动作，且不含"未安装动作"
      expect(res.body.affected_players).toBeGreaterThanOrEqual(1);
      expect(res.body.interrupted_actions).toContain('mine_tiny_vein');
      expect(res.body.interrupted_actions).toContain('chop_tree');
      expect(res.body.interrupted_actions).not.toContain('dlc_legacy_action');

      // 存档 A：current_action 清空，队列只剩未引用停用动作的那一行；其余字段原样
      const data = await readData(affected.token);
      expect(data.current_action).toBeNull();
      expect(data.action_queue).toHaveLength(1);
      expect(data.action_queue![0].action_id).toBe('dlc_legacy_action');
      expect(data.action_queue![0].count).toBe(5);
      expect(data.inventory).toHaveLength(1);
      expect((data.inventory[0] as { item_id: string }).item_id).toBe('copper_ore');
      expect((data.inventory[0] as { quantity: number }).quantity).toBe(7);
      expect(data.abstract_resources).toEqual({ gold: 42 });
      expect(data.skills).toEqual({ mining: { exp: 120 } });

      // 存档 B：完全未被改动
      expect(await readData(intact.token)).toEqual(untouched);
    } finally {
      // 立即恢复：同库其它 e2e 依赖 core，缩短全局停用窗口
      await setCoreEnabled(admin.token, true);
      await reload(admin.token).expect(201);
    }
  });

  it('reload 写审计（action=content_pack.reload，detail 含前后启用集合与 validate_errors）', async () => {
    const admin = await adminCreds();

    await reload(admin.token).expect(201);

    const audit = await request(app.getHttpServer())
      .get('/api/admin/audit-logs')
      .query({ action: 'content_pack.reload', limit: 100 })
      .set(authed(admin.token))
      .expect(200);

    const record = (audit.body.items as Array<Record<string, unknown>>).find(
      (row) => row.action === 'content_pack.reload',
    );
    expect(record).toBeTruthy();
    expect(record).toMatchObject({
      admin_account_id: admin.accountId,
      action: 'content_pack.reload',
      target_type: 'content_pack',
    });
    const detail = record!.detail as {
      before_packs: string[];
      after_packs: string[];
      validate_errors: number;
    };
    expect(Array.isArray(detail.before_packs)).toBe(true);
    expect(Array.isArray(detail.after_packs)).toBe(true);
    expect(typeof detail.validate_errors).toBe('number');
  });

  it('恢复：重新启用 core 并 reload，内容立即回来', async () => {
    const admin = await adminCreds();
    await setCoreEnabled(admin.token, true);
    const res = await reload(admin.token).expect(201);
    expect(res.body.enabled_packs).toContain('core');

    const content = await getContent();
    const actionIds = new Set((content.body.actions as Array<{ id: string }>).map((a) => a.id));
    expect(actionIds.has('mine_tiny_vein')).toBe(true);
  });

  it('恢复后玩家可基于新快照开始 core 动作（action/start 用新内容集合）', async () => {
    const player = await playerCreds();
    await ensureSave(player.token);
    await request(app.getHttpServer())
      .post('/api/action/start')
      .set(authed(player.token))
      .send({ skillId: 'mining', actionId: 'mine_tiny_vein' })
      .expect(201);
  });
});
