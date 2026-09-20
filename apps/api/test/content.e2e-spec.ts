import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ACTIONS, HAND_DRAWN_ICONS, ITEMS, SKILLS } from '@lazycraft/shared';
import { ContentModule } from './../src/content/content.module.js';

// 只挂载 ContentModule 而非整个 AppModule：内容接口公开且不碰数据库，
// 单独挂载既验证了"无需登录可访问"，又不让本测试被远程 PG 的可用性牵连。
describe('ContentController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ContentModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/content 无需登录返回 200 且结构齐全', async () => {
    const res = await request(app.getHttpServer()).get('/api/content').expect(200);

    expect(Array.isArray(res.body.skills)).toBe(true);
    expect(Array.isArray(res.body.actions)).toBe(true);
    expect(Array.isArray(res.body.abstractResources)).toBe(true);
    expect(Array.isArray(res.body.equipmentSlots)).toBe(true);
    expect(Array.isArray(res.body.itemCatalog)).toBe(true);
    expect(Array.isArray(res.body.icons)).toBe(true);

    // 技能 / 物品目录以 Registry 为准，必须覆盖 data/*.ts 的全量表
    expect(res.body.skills).toHaveLength(SKILLS.length);
    expect(res.body.itemCatalog.length).toBeGreaterThanOrEqual(ITEMS.length);
    // 动作 = ACTIONS + CorePack 专有 2 条
    expect(res.body.actions).toHaveLength(ACTIONS.length + 2);
    // 图标 = CorePack 登记的本体手绘全部
    expect(res.body.icons).toHaveLength(HAND_DRAWN_ICONS.length);
  });

  it('返回的每条动作都带 tier，技能都带分组字段', async () => {
    const res = await request(app.getHttpServer()).get('/api/content').expect(200);

    for (const action of res.body.actions as Array<{ id: string; tier: unknown }>) {
      expect(typeof action.tier).toBe('number');
    }
    for (const skill of res.body.skills as Array<{ type: unknown }>) {
      expect(['combat', 'non_combat']).toContain(skill.type);
    }
  });

  it('内容与 CorePack 注册结果一致：SKILLS/ACTIONS 都能在返回里找到', async () => {
    const res = await request(app.getHttpServer()).get('/api/content').expect(200);

    const skillIds = new Set((res.body.skills as Array<{ id: string }>).map((s) => s.id));
    for (const skill of SKILLS) expect(skillIds.has(skill.id)).toBe(true);

    const actionIds = new Set((res.body.actions as Array<{ id: string }>).map((a) => a.id));
    for (const action of ACTIONS) expect(actionIds.has(action.id)).toBe(true);
  });

  it('icons 与 CorePack 登记的本体手绘图标一致', async () => {
    const res = await request(app.getHttpServer()).get('/api/content').expect(200);

    const iconNames = new Set(
      (res.body.icons as Array<{ name: string }>).map((i) => i.name),
    );
    for (const icon of HAND_DRAWN_ICONS) expect(iconNames.has(icon.name)).toBe(true);

    // 每条图标都带可渲染的 paths，否则前端会渲染成空白
    for (const icon of res.body.icons as Array<{
      name: string;
      source: unknown;
      paths: Array<{ d: string }>;
    }>) {
      expect(icon.source).toBe('hand-drawn');
      expect(icon.paths.length).toBeGreaterThan(0);
      for (const p of icon.paths) expect(p.d.length).toBeGreaterThan(0);
    }
  });
});
