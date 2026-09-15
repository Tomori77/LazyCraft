/**
 * 任务定义（静态配置层）
 *
 * 为什么任务定义放在后端而不是 shared 包？
 *   任务模板当前只有后端 Service 消费（校验 + 发奖）；
 *   前端只渲染已领取任务的状态，文案走 i18n key。
 *   等出现"前端需要预览未接任务列表"的需求时再提升到 shared，
 *   现在提前共享只会把后端的业务规则泄漏给前端代码库。
 */

/** 目标类型：收集物品 / 制作物品 / 击杀怪物（击杀留给战斗 DLC，先用占位） */
export type GoalType = 'collect_item' | 'craft_item' | 'kill_enemy';

export interface TaskGoal {
  type: GoalType;
  /** 目标对象 ID（物品 id / 怪物 id） */
  target: string;
  /** 需要达成的数量 */
  count: number;
}

export interface TaskReward {
  items: Record<string, number>;
  /** 抽象资源（货币等），key 为资源 id */
  abstract_resources?: Record<string, number>;
}

export interface TaskDef {
  id: string;
  /** i18n key 后缀：quest.task.<i18nKey>.name / .description */
  i18nKey: string;
  goal: TaskGoal;
  reward: TaskReward;
  /** 解锁条件：前置任务 id；空 = 无前置 */
  requires?: string;
}

/** 主线任务：5 步走完核心循环（登录由前端引导承载，主线从"开始采集"起步） */
export const MAIN_QUEST: TaskDef = {
  id: 'main_first_harvest',
  i18nKey: 'main_first_harvest',
  goal: { type: 'collect_item', target: 'copper_ore', count: 3 },
  reward: { items: { maple_log: 5 } },
};

/**
 * 日常任务模板：当前阶段是"模板化静态定义"（与主线同构）。
 *
 * 为什么还没有真正的"每日刷新/随机化"？
 *   task-13 的验收只要求模板可复用；刷新策略（cron / 按日 seed 随机）
 *   属于后续 task 的职责。这里把模板与主线放在同一种数据结构里，
 *   后续加刷新逻辑时只需要新增"从模板实例化"的那一层，不用改任务引擎。
 */
export const DAILY_TEMPLATES: TaskDef[] = [
  {
    id: 'daily_collect_copper',
    i18nKey: 'daily_collect_copper',
    goal: { type: 'collect_item', target: 'copper_ore', count: 10 },
    reward: { items: { maple_log: 3 } },
    requires: MAIN_QUEST.id,
  },
  {
    id: 'daily_chop_maple',
    i18nKey: 'daily_chop_maple',
    goal: { type: 'collect_item', target: 'maple_log', count: 8 },
    reward: { items: { copper_ore: 5 } },
    requires: MAIN_QUEST.id,
  },
  {
    id: 'daily_craft_charcoal',
    i18nKey: 'daily_craft_charcoal',
    goal: { type: 'craft_item', target: 'charcoal', count: 5 },
    reward: { items: { copper_ore: 3, maple_log: 3 } },
    requires: MAIN_QUEST.id,
  },
];

const ALL_TASKS: readonly TaskDef[] = [MAIN_QUEST, ...DAILY_TEMPLATES];

/** 按 id 查任务定义；不存在返回 undefined（调用方负责转 404） */
export function findTaskById(taskId: string): TaskDef | undefined {
  return ALL_TASKS.find((t) => t.id === taskId);
}
