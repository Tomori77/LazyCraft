// 运行环境由 apps/api/vitest.config.e2e.ts 指定，通过 DATABASE_URL 指向测试数据库
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { buildCoreSnapshot, levelFromExp, playerAttributes, sumEquipmentStats } from '@lazycraft/shared';
import { AppModule } from './../src/app.module.js';
import { CURRENT_SAVE_VERSION, DEFAULT_INVENTORY_CAPACITY, DEFAULT_STORAGE_CAPACITY, type SaveDataV3 } from './../src/save/save-shape.js';
import { equipment, stack, v3Data } from './save-fixtures.js';

let app: INestApplication<App>;

const snapshot = buildCoreSnapshot();
const SKILL_IDS = snapshot.skills.map((s) => s.id);
const SLOT_IDS = snapshot.equipmentSlots.map((s) => s.id);
const ATTRIBUTE_IDS_EXPECTED = snapshot.attributes.map((a) => a.id);

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
  const email = `player-e2e-${randomUUID()}@example.com`;
  const username = `player_${randomUUID().slice(0, 8)}`;
  const password = 'test-password-8';
  await request(app.getHttpServer()).post('/api/auth/register').send({ username, email, password }).expect(201);
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return { token: res.body.accessToken as string, email, username };
}

/** 懒创建存档（保证后续 POST 的版本校验有基线） */
async function ensureSave(token: string) {
  await request(app.getHttpServer()).get('/api/save').set('Authorization', `Bearer ${token}`).expect(200);
}

/** 直接覆写整份存档，用于铺垫技能/背包/仓库/装备状态 */
async function writeData(token: string, data: SaveDataV3) {
  await request(app.getHttpServer())
    .post('/api/save')
    .set('Authorization', `Bearer ${token}`)
    .send({ version: CURRENT_SAVE_VERSION, data })
    .expect(201);
}

const getPlayer = (token: string) =>
  request(app.getHttpServer()).get('/api/player').set('Authorization', `Bearer ${token}`);

describe('/api/player (e2e)', () => {
  it('未登录访问 → 401', async () => {
    await request(app.getHttpServer()).get('/api/player').expect(401);
  });

  it('首次 GET → 默认结构：name=注册用户名、level=1、技能/槽位全覆盖且默认、carry 0/100 + 0/500', async () => {
    const { token, username } = await registerAndLogin();
    const res = await getPlayer(token).expect(200);
    const body = res.body;

    // P3-7：注册用户名直接落成玩家显示名
    expect(body.name).toBe(username);
    expect(typeof body.name).toBe('string');
    expect(body.level).toBe(1);

    // task-34：属性全集必须存在，含 P4-5 要求的新属性
    expect(Object.keys(body.attributes).sort()).toEqual([...ATTRIBUTE_IDS_EXPECTED].sort());
    for (const id of [
      'hp',
      'mp',
      'defense',
      'damage_reduction',
      'evasion_melee',
      'evasion_ranged',
      'evasion_magic',
      'accuracy',
      'max_hit',
      'min_hit',
      'crit_chance',
      'crit_damage',
    ]) {
      expect(typeof body.attributes[id]).toBe('number');
    }
    // 1 级空手：hp=12+2=14、攻击=1、命中 100、暴击伤害 100
    expect(body.attributes.hp).toBe(14);
    expect(body.attributes.attack).toBe(1);
    expect(body.attributes.accuracy).toBe(100);
    expect(body.attributes.crit_damage).toBe(100);

    expect(Object.keys(body.skills).sort()).toEqual([...SKILL_IDS].sort());
    for (const id of SKILL_IDS) {
      expect(body.skills[id]).toEqual({ exp: 0, level: 1 });
    }

    expect(Object.keys(body.equipment).sort()).toEqual([...SLOT_IDS].sort());
    for (const id of SLOT_IDS) {
      expect(body.equipment[id]).toBeNull();
    }

    expect(body.abstract_resources).toEqual({});
    expect(body.inventory).toEqual([]);
    expect(body.storage).toEqual([]);
    expect(body.carry).toEqual({
      inventory_used: 0,
      inventory_capacity: DEFAULT_INVENTORY_CAPACITY,
      storage_used: 0,
      storage_capacity: DEFAULT_STORAGE_CAPACITY,
    });
  });

  it('写入技能/背包/仓库/装备/抽象资源后 GET → 各字段正确', async () => {
    const { token } = await registerAndLogin();
    await ensureSave(token);

    const sword = equipment({ slot: 'main_hand', required_level: 1 });
    const ore = stack('copper_ore', 5);
    const wood = stack('wood', 12);
    const attackExp = 12 ** 3;
    await writeData(
      token,
      v3Data({
        skills: { attack: { exp: attackExp }, mining: { exp: 27 } },
        inventory: [sword, ore],
        storage: [wood],
        equipment: { main_hand: sword },
        abstract_resources: { gold: 1234, res_wood: 56 },
      }),
    );

    const body = (await getPlayer(token).expect(200)).body;

    // level 按 levelFromExp 现算
    expect(body.level).toBe(levelFromExp(attackExp));
    expect(body.level).toBe(12);
    expect(body.skills.attack).toEqual({ exp: attackExp, level: 12 });
    expect(body.skills.mining).toEqual({ exp: 27, level: 3 });
    expect(body.skills.fishing).toEqual({ exp: 0, level: 1 });

    expect(body.abstract_resources).toEqual({ gold: 1234, res_wood: 56 });

    // 属性与装备/等级联动：12 级攻击 + 短剑(+2 攻) → hp=12+24=36、攻击=12+2=14
    expect(body.attributes.hp).toBe(36);
    expect(body.attributes.attack).toBe(14);
    expect(body.attributes).toEqual(
      playerAttributes(attackExp, sumEquipmentStats([sword])),
    );

    // 装备实例原样返回
    expect(body.equipment.main_hand).toMatchObject({
      uid: sword.uid,
      kind: 'equipment',
      template_id: 'short_sword',
      final_stats: sword.final_stats,
      slot: 'main_hand',
    });
    expect(body.equipment.head).toBeNull();

    // 背包/仓库：混装实例原样返回；carry_used 为格数（堆叠 12 个木头只占 1 格）
    expect(body.inventory).toHaveLength(2);
    expect(body.inventory.some((i: { uid: string }) => i.uid === sword.uid)).toBe(true);
    expect(body.storage).toHaveLength(1);
    expect(body.storage[0]).toMatchObject({ uid: wood.uid, item_id: 'wood', quantity: 12 });
    expect(body.carry).toEqual({
      inventory_used: 2,
      inventory_capacity: DEFAULT_INVENTORY_CAPACITY,
      storage_used: 1,
      storage_capacity: DEFAULT_STORAGE_CAPACITY,
    });
  });

  it('脏 equipment（null / 非对象 / 缺 final_stats）不崩且按 null 处理', async () => {
    const { token } = await registerAndLogin();
    await ensureSave(token);

    const dirty = v3Data({
      equipment: {
        head: null,
        neck: 'oops',
        main_hand: { kind: 'equipment', uid: 'broken' },
        chest: [],
        legs: { kind: 'equipment', uid: 'no-stats', final_stats: null },
      },
    });
    await writeData(token, dirty);

    const body = (await getPlayer(token).expect(200)).body;
    for (const id of SLOT_IDS) {
      expect(body.equipment[id]).toBeNull();
    }
    expect(body.level).toBe(1);
  });

  it('脏技能经验（负数）不崩且按 0/1 级处理', async () => {
    const { token } = await registerAndLogin();
    await ensureSave(token);

    await writeData(token, v3Data({ skills: { attack: { exp: -5 }, mining: { exp: 27 } } }));

    const body = (await getPlayer(token).expect(200)).body;
    expect(body.level).toBe(1);
    expect(body.skills.attack).toEqual({ exp: 0, level: 1 });
    expect(body.skills.mining).toEqual({ exp: 27, level: 3 });
  });
});
