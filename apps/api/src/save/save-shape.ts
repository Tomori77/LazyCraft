/**
 * 存档数据（data 字段）当前版本的结构定义
 *
 * 为什么把存档结构集中在独立文件而不是嵌套在 service 里？
 *   存档结构是"领域契约"，service 只关心读写与版本号校验；
 *   后续 task-04+ 的技能结算 / 背包系统会基于这里导出的类型消费 data。
 */

import type { ActionQueueItem, CarriedItem, EquipmentInstance } from '@lazycraft/shared';

/** 存档版本号：每次存档结构变更必须 +1，并补齐对应的 migration 脚本 */
export const CURRENT_SAVE_VERSION = 4;

/** 容量默认值：背包与仓库的初始格数（DLC 可扩展） */
export const DEFAULT_INVENTORY_CAPACITY = 100;
export const DEFAULT_STORAGE_CAPACITY = 500;

/**
 * 存档中"正在执行的动作"的形状
 *
 * 为什么 skill_id 也要冗余存进来？
 *   idle 引擎的 ActiveAction 只存 action_id，反查 skill 需要遍历整张动作表。
 *   存档是"文档"，一次冗余写入换来所有读取方（前端展示 / 结算路由）零查找成本。
 */
export interface ActiveActionData {
  skill_id: string;
  action_id: string;
  /** 服务器时间戳（毫秒）：动作开始时刻 */
  started_at: number;
}

/**
 * 存档 data 字段的 v1 结构
 *
 * 字段命名遵循《框架设计》5.4 节"存档即文档"原则——
 * 全部用蛇形下划线（与 DB / JSON 风格一致），而不是 TypeScript 常见的驼峰；
 * 这样序列化进 JSONB 后不需要再做命名转换，减少出错面。
 */
export interface SaveData {
  /** 各技能的经验/等级，key 为 skill_id */
  skills: Record<string, unknown>;
  /**
   * 物品背包：堆叠物与装备实例混装的容器。
   *
   * v3 起由 `{item_id,quantity}[]` 升级为 `CarriedItem[]`——
   * 装备实例（品质/词缀/属性快照）此前无处安放，无法支持"从背包拖装备"。
   */
  inventory: CarriedItem[];
  /**
   * 当前穿戴的装备：槽位 → 实例（空槽为 null）。
   *
   * 类型保持宽松以兼容历史空档（`{}`），但语义上应为
   * `Record<EquipmentSlot, EquipmentInstance | null>`。
   */
  equipment: Record<string, EquipmentInstance | null>;
  /** 抽象资源（货币、体力等不占用格子的数值资源） */
  abstract_resources: Record<string, unknown>;
  /** 当前正在执行的动作，null = 空闲 */
  current_action: ActiveActionData | null;
  /** 玩家个人设置（音频、UI 偏好等，不影响结算） */
  settings: Record<string, unknown>;
  /**
   * 动作队列（v4 起）。
   *
   * 基类里声明为可选、v4 里声明为必有：读路径面对老存档时字段可能缺失
   * （读取侧一律按空队列兜底），而写路径产物必须是 v4 完整形态。
   */
  action_queue?: ActionQueueItem[];
}

/**
 * 存档 data 字段的 v2 结构：在 v1 之上新增"当前战斗"状态。
 *
 * 为什么战斗状态走存档 JSONB 而不另建 combat 表：
 *   战斗与挂机活动互斥（玩家同一时刻只能做一件事），把 current_combat
 *   收进同一份 JSONB 让"活动 → 战斗"切换只需一次条件更新（JSON 字段原子
 *   替换），不会出现两个子系统基于过期状态互相覆盖的并发缝隙。
 *   字段允许缺失（v1 存档由 migrate1to2 升级为 v2 时自动补齐 null）。
 */
export interface SaveDataV2 extends SaveData {
  /** 当前正在进行的战斗，null = 未在战斗中 */
  current_combat: { enemy_id: string; started_at: number } | null;
}

/**
 * 存档 data 字段的 v3 结构：容器模型落地（《04 §2.6》）。
 *
 * 新增 `storage`（仓库）与两个容量字段；`inventory` 在 v3 起即为 CarriedItem[]，
 * 因此这里只是把 v2 已具备的字段补上容器的精确类型。
 */
export interface SaveDataV3 extends SaveDataV2 {
  /** 仓库：与背包同构的容器，初始容量更大 */
  storage: CarriedItem[];
  /** 背包格数上限（DLC 可扩展） */
  inventory_capacity: number;
  /** 仓库格数上限（DLC 可扩展） */
  storage_capacity: number;
}

/**
 * 存档 data 字段的 v4 结构：动作队列（task-36，P4-7）。
 *
 * 新增 `action_queue`（队列项数组，存剩余圈数）。队列与 current_action 的关系：
 * current_action 是"队首正在跑的那个"，action_queue 是"还没跑完的清单"。
 * 队首跑完后从 action_queue 移除，下一位接任 current_action。
 */
export interface SaveDataV4 extends SaveDataV3 {
  /** 动作队列：按顺序执行的待办项，空数组 = 无队列 */
  action_queue: ActionQueueItem[];
}
/** 生成一份"空白存档"——新玩家首次 GET 时服务端懒创建的初始形态（v4） */
export function createEmptySaveData(): SaveDataV4 {
  return {
    skills: {},
    inventory: [],
    equipment: {},
    abstract_resources: {},
    current_action: null,
    current_combat: null,
    settings: {},
    storage: [],
    inventory_capacity: DEFAULT_INVENTORY_CAPACITY,
    storage_capacity: DEFAULT_STORAGE_CAPACITY,
    action_queue: [],
  };
}
