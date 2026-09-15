/**
 * 存档数据（data 字段）当前版本的结构定义
 *
 * 为什么把存档结构集中在独立文件而不是嵌套在 service 里？
 *   存档结构是"领域契约"，service 只关心读写与版本号校验；
 *   后续 task-04+ 的技能结算 / 背包系统会基于这里导出的类型消费 data。
 */

/** 存档版本号：每次存档结构变更必须 +1，并补齐对应的 migration 脚本 */
export const CURRENT_SAVE_VERSION = 1;

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
  /** 物品背包（含堆叠数量、品质等） */
  inventory: unknown[];
  /** 当前穿戴的装备，key 为装备槽位 */
  equipment: Record<string, unknown>;
  /** 抽象资源（货币、体力等不占用格子的数值资源） */
  abstract_resources: Record<string, unknown>;
  /** 当前正在执行的动作，null = 空闲 */
  current_action: ActiveActionData | null;
  /** 玩家个人设置（音频、UI 偏好等，不影响结算） */
  settings: Record<string, unknown>;
}

/** 生成一份"空白存档"——新玩家首次 GET 时服务端懒创建的初始形态 */
export function createEmptySaveData(): SaveData {
  return {
    skills: {},
    inventory: [],
    equipment: {},
    abstract_resources: {},
    current_action: null,
    settings: {},
  };
}
