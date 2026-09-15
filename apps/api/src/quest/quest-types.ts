/**
 * 任务进度：存放在存档 data.quests 字段的形状定义
 *
 * 为什么进度存存档而不是独立建表？
 *   任务进度本质是"玩家状态"的一个切面，与技能经验、背包同级；
 *   独立建表会引入跨表事务（发奖要同时改背包和任务行），
 *   而存档的"整份覆盖 + version 乐观锁"已经提供了天然的原子性。
 */

/** 单个玩家任务的进度记录 */
export interface PlayerQuestRecord {
  /** 已领取时刻（服务器毫秒时间戳） */
  accepted_at: number;
  /** 领取时背包里已有的目标物基数：collect_item 进度 = 当前总数 - 基数 */
  baseline: number;
  /** 计数型目标（craft_item / kill_enemy）的累计增量；collect_item 不用此字段（仍为 0） */
  gained: number;
  /** 是否已交付领取奖励 */
  completed: boolean;
}

/**
 * 存档 data.quests 的完整形状。
 * 与 SaveData 其它字段一样使用蛇形命名，序列化进 JSONB 无需转换。
 */
export interface QuestsSaveData {
  quests: Record<string, PlayerQuestRecord>;
}
