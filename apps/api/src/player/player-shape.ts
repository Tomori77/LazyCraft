/**
 * `GET /api/player` 的响应契约与聚合纯函数（task-26）。
 *
 * 为什么聚合逻辑单独成文件而不是全塞进 service？
 *   存档是 JSONB，随时可能被历史数据/手改写入脏值；"技能清单 × 经验 → 等级"、
 *   "槽位补全 null" 这类规则是纯函数，抽出来就能在不开 DB 的情况下单测，
 *   service 只负责取 player 名 + 走权威读路径拿 data。
 *
 * 契约对齐 `packages/shared` 的内容快照与 `docs/UI修改/types.ts` 的 PlayerData：
 *   技能/槽位清单以快照为准（保证与 /api/content 同源、含 DLC），
 *   存档里没有记录的技能按 exp=0（level=1）返回，空槽一律 null。
 */

import {
  levelFromExp,
  type CarriedItem,
  type ContentSnapshot,
  type EquipmentInstance,
} from '@lazycraft/shared';
import {
  DEFAULT_INVENTORY_CAPACITY,
  DEFAULT_STORAGE_CAPACITY,
  type SaveDataV3,
} from '../save/save-shape.js';

/** 玩家等级口径：攻击技能等级。与 inventory / shop / combat 的 PLAYER_LEVEL_SKILL 保持一致，
 *  避免个人信息面板出现"第二套等级轴"（见 04 §3.2 与 task-26 已定口径）。 */
export const PLAYER_LEVEL_SKILL = 'attack';

export interface PlayerSkillProgress {
  exp: number;
  level: number;
}

/** 个人信息面板的聚合结果；字段形状与前端 `PlayerData` 一致 */
export interface PlayerData {
  name: string;
  level: number;
  skills: Record<string, PlayerSkillProgress>;
  abstract_resources: Record<string, number>;
  equipment: Record<string, EquipmentInstance | null>;
  inventory: CarriedItem[];
  storage: CarriedItem[];
  carry: {
    inventory_used: number;
    inventory_capacity: number;
    storage_used: number;
    storage_capacity: number;
  };
}

/** 只把普通对象当记录消费；数组 / 标量 / null 一律视为空，脏存档不炸读路径 */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asItems(value: unknown): CarriedItem[] {
  return Array.isArray(value) ? (value as CarriedItem[]) : [];
}

/** 读某技能的经验并归一化：levelFromExp 对负数/非有限数会抛错，脏值必须回到 0 */
function skillExpOf(rawSkills: unknown, skillId: string): number {
  const exp = asRecord(asRecord(rawSkills)[skillId]).exp;
  return typeof exp === 'number' && Number.isFinite(exp) && exp >= 0 ? exp : 0;
}

/**
 * 内容快照的技能清单 × 存档经验 → 带现算等级的技能 map。
 *
 * 为什么以快照清单为骨架而不是遍历存档里的 skills？
 *   存档只记录"练过的技能"，直接遍历会漏掉新玩家未解锁的技能；
 *   以快照为骨架能让前端拿到的技能集合与 /api/content 完全一致（含 DLC）。
 */
export function buildSkillLevels(
  skillIds: readonly string[],
  rawSkills: unknown,
): Record<string, PlayerSkillProgress> {
  const levels: Record<string, PlayerSkillProgress> = {};
  for (const id of skillIds) {
    const exp = skillExpOf(rawSkills, id);
    // 等级永远现算，不信任/不缓存存档里的 level 字段
    levels[id] = { exp, level: levelFromExp(exp) };
  }
  return levels;
}

/** 玩家等级 = 攻击技能等级（攻击无记录即 1 级） */
export function readPlayerLevel(rawSkills: unknown): number {
  return levelFromExp(skillExpOf(rawSkills, PLAYER_LEVEL_SKILL));
}

/** 脏槽位归一：与 combat.service.readEquipped 同策略——非对象 / 缺 final_stats 按空槽 */
function asEquippedInstance(value: unknown): EquipmentInstance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const stats = (value as EquipmentInstance).final_stats;
  if (!stats || typeof stats !== 'object') return null;
  return value as EquipmentInstance;
}

/**
 * 补全内容快照里的全部槽位：有合法装备则原样返回，否则 null。
 *
 * 只输出快照登记的槽位：前端人体图按快照渲染，快照里没有的槽位即使存档残留装备
 * 也无处安放（不引入前端无法消费的键）。
 */
export function buildEquipmentSlots(
  slotIds: readonly string[],
  rawEquipment: unknown,
): Record<string, EquipmentInstance | null> {
  const bySlot = asRecord(rawEquipment);
  const slots: Record<string, EquipmentInstance | null> = {};
  for (const id of slotIds) slots[id] = asEquippedInstance(bySlot[id]);
  return slots;
}

/** 容器容量：字段缺失按默认值兜底，与 inventory.service 同口径 */
function capacityOf(data: Partial<SaveDataV3>, container: 'inventory' | 'storage'): number {
  const value = container === 'inventory' ? data.inventory_capacity : data.storage_capacity;
  if (typeof value === 'number') return value;
  return container === 'inventory' ? DEFAULT_INVENTORY_CAPACITY : DEFAULT_STORAGE_CAPACITY;
}

/**
 * 组装个人信息面板数据。
 *
 * carry 的 used 刻意取数组长度（格数）而不是物品总数量——前端显示的是
 * "12/100 格"，堆叠 999 个也只占一格，与容量校验口径一致。
 */
export function buildPlayerData(
  name: string,
  snapshot: Pick<ContentSnapshot, 'skills' | 'equipmentSlots'>,
  data: Partial<SaveDataV3>,
): PlayerData {
  const inventory = asItems(data.inventory);
  const storage = asItems(data.storage);
  return {
    name,
    level: readPlayerLevel(data.skills),
    skills: buildSkillLevels(
      snapshot.skills.map((skill) => skill.id),
      data.skills,
    ),
    abstract_resources: asRecord(data.abstract_resources) as Record<string, number>,
    equipment: buildEquipmentSlots(
      snapshot.equipmentSlots.map((slot) => slot.id),
      data.equipment,
    ),
    inventory,
    storage,
    carry: {
      inventory_used: inventory.length,
      inventory_capacity: capacityOf(data, 'inventory'),
      storage_used: storage.length,
      storage_capacity: capacityOf(data, 'storage'),
    },
  };
}
