/**
 * 外部 DLC 加载 e2e（task-43）。
 *
 * 覆盖：
 *   1. 好 DLC：放临时挂载目录 → 启动后 `/api/content` 能看到其技能/动作/物品与 pack 元信息；
 *   2. 坏 DLC：manifest 语法错 / 入口缺失 / 形状不合规 → **应用仍能启动**，
 *      `/api/admin/content/dlc-errors` 与 reload 响应都能报出目录 + 阶段；
 *   3. 重载拾取新增 DLC：运行中写新目录 → reload → 不重启即出现（验证 cache-busting）；
 *   4. 外部 pack 与内置 pack 统一启停：停用 → reload 内容消失；恢复 → reload 回来；
 *   5. 鉴权：非 admin 403 / 未登录 401。
 *
 * 关键：`DLC_DIR` 必须在 `Test.createTestingModule(...).compile()` **之前**设好，
 * 因为 ContentService 在 onModuleInit 里扫描目录。用例结束必须清理临时目录并恢复 env。
 * 另一个 spec 文件不设 DLC_DIR（默认 /app/dlc 不存在）= 外部 DLC 为 0，长度断言不变。
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from './../src/app.module.js';
import { PrismaClient } from './../src/lib/prisma-client/client.js';

let app: INestApplication<App>;
let prisma: PrismaClient;
let dlcRoot: string;
const originalDlcDir = process.env.DLC_DIR;

const ADMIN_EMAIL = `dlcx-admin-${randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = `${process.env.ADMIN_EMAILS ?? ''},${ADMIN_EMAIL}`;

const EXTERNAL_ACTION = 'dlcx_gather';
const EXTERNAL_ITEM = 'dlcx_shard';
const EXTERNAL_SKILL = 'dlcx_survey';

/** 合法外部 DLC：技能 + 动作 + 物品自洽（action 引用本包技能/物品，validate 无错） */
const EXTERNAL_ENTRY = `
export const pack = {
  id: 'ext_pack',
  name: '外部测试包',
  version: '1.0.0',
  register(registry) {
    registry.skill({
      id: '${EXTERNAL_SKILL}',
      name: '勘测',
      type: 'non_combat',
      max_level: 99,
      breakthrough_enabled: false,
    });
    registry.item({
      id: '${EXTERNAL_ITEM}',
      name: '碎片',
      type: 'material',
      tier: 1,
      stack_max: 99,
      tradeable: false,
      quality: ['common'],
      source_skill: '${EXTERNAL_SKILL}',
      use_tags: [],
      rarity: 'normal',
      broadcast_threshold: 'epic',
    });
    registry.action({
      id: '${EXTERNAL_ACTION}',
      skill_id: '${EXTERNAL_SKILL}',
      name: '勘测碎片',
      interval_ms: 1000,
      exp: 1,
      input_items: {},
      output_items: { '${EXTERNAL_ITEM}': 1 },
      output_exp: 0,
      required_level: 1,
      tier: 1,
    });
  },
};
`;

async function writeDlc(
  name: string,
  manifest: unknown,
  entry: string | null,
): Promise<string> {
  const dir = join(dlcRoot, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'manifest.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    'utf8',
  );
  if (entry !== null) await writeFile(join(dir, 'index.js'), entry, 'utf8');
  return dir;
}

beforeAll(async () => {
  dlcRoot = await mkdtemp(join(tmpdir(), 'lazycraft-dlc-e2e-'));
  // 启动前铺好：一个好 DLC + 三个坏 DLC（语法错 / 入口缺失 / 形状错）
  await writeDlc(
    'good',
    { id: 'ext_pack', name: '外部测试包', version: '1.0.0', entry: 'index.js' },
    EXTERNAL_ENTRY,
  );
  await writeDlc('bad-json', '{ this is not json', EXTERNAL_ENTRY);
  await writeDlc(
    'missing-entry',
    { id: 'missing', name: '缺入口', version: '1', entry: 'nope.js' },
    null,
  );
  await writeDlc(
    'bad-shape',
    { id: 'badshape', name: '坏形状', version: '1', entry: 'index.js' },
    'export const pack = { id: "badshape", name: "坏形状", version: "1" };',
  );

  process.env.DLC_DIR = dlcRoot;

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  prisma = app.get(PrismaClient);
});

afterAll(async () => {
  // 兜底恢复：别把外部 pack 的停用状态留在共享测试库
  await prisma.contentPackState.deleteMany({ where: { id: 'ext_pack' } });
  await app.close();
  await rm(dlcRoot, { recursive: true, force: true });
  if (originalDlcDir === undefined) delete process.env.DLC_DIR;
  else process.env.DLC_DIR = originalDlcDir;
});

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function registerAndLogin(email: string) {
  const password = 'test-password-8';
  const username = `dlcx_${randomUUID().slice(0, 8)}`;
  const registered = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ username, email, password })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return {
    token: res.body.accessToken as string,
    accountId: registered.body.account.id as string,
  };
}

let adminCredsPromise:
  Promise<{ token: string; accountId: string }> | undefined;
const adminCreds = () => (adminCredsPromise ??= registerAndLogin(ADMIN_EMAIL));
const playerToken = () =>
  registerAndLogin(`dlcx-p-${randomUUID()}@example.com`).then((c) => c.token);

const getContent = () =>
  request(app.getHttpServer()).get('/api/content').expect(200);
const reload = (token: string) =>
  request(app.getHttpServer())
    .post('/api/admin/content/reload')
    .set(authed(token));

const setExtEnabled = (token: string, enabled: boolean) =>
  request(app.getHttpServer())
    .patch('/api/admin/content/packs/ext_pack')
    .set(authed(token))
    .send({ enabled })
    .expect(200);

describe('外部 DLC 加载 (e2e)', () => {
  it('启动后 /api/content 含好 DLC 的技能/动作/物品与 pack 元信息', async () => {
    const res = await getContent();
    const skills = res.body.skills as Array<{ id: string }>;
    const actions = res.body.actions as Array<{ id: string }>;
    const items = res.body.itemCatalog as Array<{ id: string }>;
    const packs = res.body.packs as Array<{
      id: string;
      name: string;
      version: string;
    }>;

    expect(skills.some((s) => s.id === EXTERNAL_SKILL)).toBe(true);
    expect(actions.some((a) => a.id === EXTERNAL_ACTION)).toBe(true);
    expect(items.some((i) => i.id === EXTERNAL_ITEM)).toBe(true);

    // 外部 pack 的 name/version 必须进快照 packs[]（否则前端/管理页看不到）
    const ext = packs.find((p) => p.id === 'ext_pack');
    expect(ext).toMatchObject({
      id: 'ext_pack',
      name: '外部测试包',
      version: '1.0.0',
    });
  });

  it('坏 DLC 不影响启动：dlc-errors 报出目录 + 阶段，好 DLC 照常可用', async () => {
    const { token } = await adminCreds();
    const res = await request(app.getHttpServer())
      .get('/api/admin/content/dlc-errors')
      .set(authed(token))
      .expect(200);

    expect(res.body.dir).toBe(dlcRoot);
    const errors = res.body.errors as Array<{
      dir: string;
      stage: string;
      message: string;
    }>;
    const stages = new Map(
      errors.map((e) => [e.dir.split(/[\\/]/).pop(), e.stage]),
    );
    expect(stages.get('bad-json')).toBe('manifest');
    expect(stages.get('missing-entry')).toBe('import');
    expect(stages.get('bad-shape')).toBe('shape');
    for (const error of errors) {
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.dir).toContain(dlcRoot);
    }
    // 应用照常可用
    await getContent();
  });

  it('admin 列表同时含内置 core 与外部 ext_pack，外部行 external=true', async () => {
    const { token } = await adminCreds();
    const res = await request(app.getHttpServer())
      .get('/api/admin/content/packs')
      .set(authed(token))
      .expect(200);

    const list = res.body as Array<{ id: string; external: boolean }>;
    expect(Array.isArray(list)).toBe(true);
    expect(list.find((p) => p.id === 'core')?.external).toBe(false);
    expect(list.find((p) => p.id === 'ext_pack')?.external).toBe(true);
  });

  it('reload 响应带 load_errors 数量与明细', async () => {
    const { token } = await adminCreds();
    const res = await reload(token).expect(201);
    expect(res.body.load_errors).toBe(3);
    const details = res.body.load_error_details as Array<{
      dir: string;
      stage: string;
    }>;
    expect(details.length).toBe(3);
    for (const d of details) expect(typeof d.stage).toBe('string');
    expect(res.body.enabled_packs).toContain('ext_pack');
  });

  it('外部 pack 与内置 pack 统一启停：停用 → reload 内容消失；恢复 → reload 回来', async () => {
    const admin = await adminCreds();
    try {
      await setExtEnabled(admin.token, false);
      const res = await reload(admin.token).expect(201);
      expect(res.body.enabled_packs).not.toContain('ext_pack');

      const after = await getContent();
      const actionIds = new Set(
        (after.body.actions as Array<{ id: string }>).map((a) => a.id),
      );
      expect(actionIds.has(EXTERNAL_ACTION)).toBe(false);
      // 外部包停用不能牵连内置 core
      expect(actionIds.has('mine_tiny_vein')).toBe(true);

      // 停用写操作进审计（target=ext_pack）
      const audit = await request(app.getHttpServer())
        .get('/api/admin/audit-logs')
        .query({
          target_type: 'content_pack',
          target_id: 'ext_pack',
          limit: 100,
        })
        .set(authed(admin.token))
        .expect(200);
      expect(
        (audit.body.items as Array<{ action: string }>).some(
          (row) => row.action === 'content_pack.disable',
        ),
      ).toBe(true);
    } finally {
      await setExtEnabled(admin.token, true);
      const restored = await reload(admin.token).expect(201);
      expect(restored.body.enabled_packs).toContain('ext_pack');
    }

    const back = await getContent();
    const actionIds = new Set(
      (back.body.actions as Array<{ id: string }>).map((a) => a.id),
    );
    expect(actionIds.has(EXTERNAL_ACTION)).toBe(true);
  });

  /**
   * 模块缓存验证：运行中新增一个 DLC 目录 → reload → 不重启进程即可见。
   * 若不处理 ESM 缓存/目录重扫，这条会失败。
   */
  it('重载拾取运行中新增的 DLC（无需重启）', async () => {
    const admin = await adminCreds();
    const newAction = 'late_dlc_action';
    const newSkill = 'late_dlc_skill';
    await writeDlc(
      'late',
      { id: 'late_pack', name: '后加包', version: '2.0.0', entry: 'index.js' },
      `export const pack = {
        id: 'late_pack', name: '后加包', version: '2.0.0',
        register(registry) {
          registry.skill({ id: '${newSkill}', name: '后加技能', type: 'non_combat', max_level: 99, breakthrough_enabled: false });
          registry.action({
            id: '${newAction}', skill_id: '${newSkill}', name: '后加动作',
            interval_ms: 1000, exp: 1, input_items: {}, output_items: {}, output_exp: 0,
            required_level: 1, tier: 1,
          });
        },
      };`,
    );

    try {
      const before = await getContent();
      const beforeIds = new Set(
        (before.body.actions as Array<{ id: string }>).map((a) => a.id),
      );
      expect(beforeIds.has(newAction)).toBe(false);

      const res = await reload(admin.token).expect(201);
      expect(res.body.enabled_packs).toContain('late_pack');

      const after = await getContent();
      const afterIds = new Set(
        (after.body.actions as Array<{ id: string }>).map((a) => a.id),
      );
      expect(afterIds.has(newAction)).toBe(true);
      const packs = after.body.packs as Array<{ id: string; version: string }>;
      expect(packs.find((p) => p.id === 'late_pack')?.version).toBe('2.0.0');
    } finally {
      await rm(join(dlcRoot, 'late'), { recursive: true, force: true });
      await prisma.contentPackState.deleteMany({ where: { id: 'late_pack' } });
      await reload(admin.token).expect(201);
    }
  });

  /**
   * 更新同名 DLC 的文件后重载拾取新版本 —— 直接验证入口 ESM 的 cache-busting。
   * 同路径 entry 若不 bust specifier，Node 会返回第一次 import 的旧模块对象。
   */
  it('更新同名 DLC 文件后重载拾取新版本（cache-busting）', async () => {
    const admin = await adminCreds();
    const skill = 'cache_dlc_skill';
    await writeDlc(
      'cached',
      { id: 'cache_pack', name: '缓存包', version: '1.0.0', entry: 'index.js' },
      `export const pack = {
        id: 'cache_pack', name: '缓存包', version: '1.0.0',
        register(registry) { registry.skill({ id: '${skill}', name: '缓存技能', type: 'non_combat', max_level: 99, breakthrough_enabled: false }); },
      };`,
    );

    try {
      const first = await reload(admin.token).expect(201);
      expect(first.body.enabled_packs).toContain('cache_pack');
      const firstPacks = (await getContent()).body.packs as Array<{
        id: string;
        version: string;
      }>;
      expect(firstPacks.find((p) => p.id === 'cache_pack')?.version).toBe(
        '1.0.0',
      );

      // 覆盖同名文件（版本 + 内容），mtime/size 变化触发 cache-bust
      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeDlc(
        'cached',
        {
          id: 'cache_pack',
          name: '缓存包',
          version: '2.0.0',
          entry: 'index.js',
        },
        `// v2 内容更长，确保 size 也变化（Windows 下 mtime 粒度可能较粗）
          export const pack = {
          id: 'cache_pack', name: '缓存包', version: '2.0.0',
          register(registry) { registry.skill({ id: '${skill}', name: '缓存技能', type: 'non_combat', max_level: 99, breakthrough_enabled: false }); },
        };`,
      );

      const second = await reload(admin.token).expect(201);
      expect(second.body.enabled_packs).toContain('cache_pack');
      const packs = (await getContent()).body.packs as Array<{
        id: string;
        version: string;
      }>;
      expect(packs.find((p) => p.id === 'cache_pack')?.version).toBe('2.0.0');
    } finally {
      await rm(join(dlcRoot, 'cached'), { recursive: true, force: true });
      await prisma.contentPackState.deleteMany({ where: { id: 'cache_pack' } });
      await reload(admin.token).expect(201);
    }
  });

  it('鉴权：未登录访问 dlc-errors → 401；普通账号 → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/content/dlc-errors')
      .expect(401);
    const token = await playerToken();
    await request(app.getHttpServer())
      .get('/api/admin/content/dlc-errors')
      .set(authed(token))
      .expect(403);
  });
});
