import { apiGet, apiPost } from '../lib/api.ts';
import type {
  CarriedItem,
  EquipmentInstance,
  EquipmentSlot,
  PlayerAttributes,
} from '@lazycraft/shared';

/**
 * 玩家信息接口客户端（task-26 后端契约的前端唯一一份形状定义）。
 *
 * 为什么 PlayerData 定义在这里而不是 docs/UI修改/types.ts 的第二份？
 *   该结构由后端 `apps/api/src/player/player-shape.ts` 产出，
 *   前端只消费；保留一份前端契约即可，避免与 shared 的 CarriedItem/EquipmentSlot 漂移。
 */
export interface PlayerSkillProgress {
  exp: number;
  level: number;
}

export interface PlayerData {
  name: string;
  /** 当前账号自身角色（'player' / 'admin'，task-38）；仅用于前端决定是否显示管理入口 */
  role: string;
  level: number;
  skills: Record<string, PlayerSkillProgress>;
  /** 最终人物属性（task-34）：属性 id → 数值，展示名/格式由 /api/content 的属性元数据驱动 */
  attributes: PlayerAttributes;
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

export function fetchPlayer(token: string): Promise<PlayerData> {
  return apiGet('/player', token);
}

/**
 * 装备/卸下/移动都写存档，必须带 token（走 apiGet/apiPost 统一鉴权与 401 自愈）。
 */
export function equipRequest(token: string, uid: string, slot: EquipmentSlot): Promise<unknown> {
  return apiPost('/inventory/equip', { uid, slot }, token);
}

export function unequipRequest(token: string, slot: EquipmentSlot): Promise<unknown> {
  return apiPost('/inventory/unequip', { slot }, token);
}

export function moveRequest(
  token: string,
  uid: string,
  from: 'inventory' | 'storage',
  to: 'inventory' | 'storage',
): Promise<unknown> {
  return apiPost('/inventory/move', { uid, from, to }, token);
}
