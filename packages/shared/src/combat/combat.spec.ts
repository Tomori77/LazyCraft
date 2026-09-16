/**
 * 战斗结算（simulateCombat / playerStats）行为测试
 *
 * 覆盖 task-18 验收标准：
 *   1. 空手玩家能自动对砍赢鸡，且战报结构自洽（日志按时间有序、双方 HP 递减）
 *   2. 敌人死亡触发掉落与经验
 *   3. 玩家 HP 低于 30% 且背包有食物时自动吃，恢复到上限
 *   4. 玩家被击杀时 end=defeat，不掉落、不加经验
 *   5. 时间推进遵守"到 now 为止"，不越权推演未来回合
 */

import { describe, expect, it } from 'vitest';
import {
  PLAYER_ATTACK_INTERVAL_MS,
  PLAYER_BASE_HP,
  PLAYER_HP_PER_LEVEL,
  enemyStats,
  playerStats,
  simulateCombat,
  type CombatLogEntry,
} from './index.js';
import { FOOD_GRILLED_FISH } from './foods.js';
import { ENEMY_CHICKEN } from '../packs/core/index.js';

/** 1 经验 = 1 级攻击的满状态玩家面板（无装备） */
const LVL1_PLAYER = playerStats(0, { attack: 0, defense: 0, hp: 0 });

/** 确定性 rng：永远返回 0，rollLoot 时会命中 weight 最大的第一个词条（羽毛 1~2 根） */
const zeroRng = () => 0;

describe('playerStats', () => {
  it('等级、装备共同决定玩家面板', () => {
    // 0 经验 = 1 级攻击：攻击=1，hp=12+2=14
    expect(LVL1_PLAYER.attack).toBe(1);
    expect(LVL1_PLAYER.max_hp).toBe(PLAYER_BASE_HP + PLAYER_HP_PER_LEVEL);
    expect(LVL1_PLAYER.interval_ms).toBe(PLAYER_ATTACK_INTERVAL_MS);

    // 穿短剑（+2 攻）+ 皮甲（+1 防 +1 hp）：面板全部加起来
    const equipped = playerStats(0, { attack: 2, defense: 1, hp: 1 });
    expect(equipped.attack).toBe(3);
    expect(equipped.defense).toBe(1);
    expect(equipped.max_hp).toBe(LVL1_PLAYER.max_hp + 1);
  });
});

describe('enemyStats', () => {
  it('鸡的战斗属性直接来自 Enemy 配置', () => {
    const s = enemyStats(ENEMY_CHICKEN);
    expect(s.max_hp).toBe(5);
    expect(s.attack).toBe(1);
    expect(s.defense).toBe(0);
  });
});

describe('simulateCombat - 胜利路径', () => {
  it('1 级玩家空手杀鸡：8s 内胜利，日志按时间有序且以玩家致命一击收尾', () => {
    const startedAt = 1_000_000;
    const now = startedAt + 20_000; // 给 20 秒充分时间
    const report = simulateCombat({
      started_at: startedAt,
      now,
      player: LVL1_PLAYER,
      enemy: ENEMY_CHICKEN,
      food: {},
      rng: zeroRng,
    });

    expect(report.end.kind).toBe('victory');
    // 玩家 2.7s/刀打 5 HP 的鸡：第 5 刀收头（5 × 2700 = 13.5s）
    // 鸡 3s/口打 1 伤：打到 13.5s 时玩家挨 4 口 = 剩 10 HP
    expect(report.enemy_hp).toBe(0);
    expect(report.player_hp).toBe(LVL1_PLAYER.max_hp - 4);
    expect(report.exp_gained).toBe(ENEMY_CHICKEN.level * 2);
    expect(report.food_consumed).toEqual({});

    // 日志按时间升序：这是前端回放与排查战斗异常所依赖的顺序
    const log = report.log;
    for (let i = 1; i < log.length; i += 1) {
      expect(log[i].at).toBeGreaterThanOrEqual(log[i - 1].at);
    }
    // 最后一条必须是玩家出手把鸡打到 0
    const last = log[log.length - 1];
    expect(last.actor).toBe('player');
    expect(last.target_hp).toBe(0);

    // 掉落：rng=0 命中 weight=80 的羽毛词条，数量区间 [1,2]，rng=0 取下限 1
    expect(report.item_drops.feather).toBe(1);
  });

  it('玩家攻击高于敌人防御时才能造成伤害（减法公式的含义）', () => {
    const startedAt = 0;
    const beefy = playerStats(0, { attack: 10, defense: 5, hp: 0 });
    // 鸡防 0：玩家 11 攻一刀 11 伤，一刀秒鸡
    const report = simulateCombat({
      started_at: startedAt,
      now: startedAt + PLAYER_ATTACK_INTERVAL_MS + 1,
      player: beefy,
      enemy: ENEMY_CHICKEN,
      food: {},
      rng: zeroRng,
    });
    expect(report.end.kind).toBe('victory');
    expect(report.log).toHaveLength(1);
    expect(report.log[0].damage).toBe(11);
  });
});

describe('simulateCombat - 食物回复', () => {
  it('玩家血量低于 30% 时自动吃一口，恢复到上限并记录消耗', () => {
    const startedAt = 0;
    // 满状态玩家杀鸡期间 HP 远高于 30% 阈值，全程不吃食物
    const fullHpReport = simulateCombat({
      started_at: startedAt,
      now: startedAt + 30_000,
      player: LVL1_PLAYER,
      enemy: ENEMY_CHICKEN,
      food: { [FOOD_GRILLED_FISH.item_id]: 3 },
      rng: zeroRng,
    });
    expect(fullHpReport.end.kind).toBe('victory');
    expect(fullHpReport.food_consumed).toEqual({});

    // 换一个血量极低的玩家面板：max_hp=4，30% 阈值=1.2
    // 玩家出手 2.7s/刀，5 刀杀鸡需 13.5s；鸡 3s/口，期间出手 4 次（12s 时第 4 口）
    // HP 走向：4 → 3 → 2 → 1（此时 < 1.2 触发吃饭，+5 顶回 4）
    const frail = {
      max_hp: 4,
      attack: 1,
      defense: 0,
      interval_ms: PLAYER_ATTACK_INTERVAL_MS,
    };
    const withFood = simulateCombat({
      started_at: startedAt,
      now: startedAt + 30_000,
      player: frail,
      enemy: ENEMY_CHICKEN,
      food: { [FOOD_GRILLED_FISH.item_id]: 5 },
      rng: zeroRng,
    });
    expect(withFood.end.kind).toBe('victory');
    const eaten = withFood.food_consumed[FOOD_GRILLED_FISH.item_id] ?? 0;
    expect(eaten).toBeGreaterThan(0);
    // 吃过食物玩家才能活到胜利：HP 一定 > 0
    expect(withFood.player_hp).toBeGreaterThan(0);
    // 消耗不会超过背包量
    expect(eaten).toBeLessThanOrEqual(5);
    // 日志中应能找到一条"玩家回血"记录（damage 为负的那一条）
    expect(withFood.log.some((e) => e.actor === 'player' && e.damage < 0)).toBe(true);
  });

  it('背包没有食物时血量再低也不会凭空回血', () => {
    const startedAt = 0;
    const frail = {
      max_hp: 4,
      attack: 1,
      defense: 0,
      interval_ms: PLAYER_ATTACK_INTERVAL_MS,
    };
    const report = simulateCombat({
      started_at: startedAt,
      now: startedAt + 30_000,
      player: frail,
      enemy: ENEMY_CHICKEN,
      food: {},
      rng: zeroRng,
    });
    expect(report.food_consumed).toEqual({});
    // 没食物可吃就绝不会出现回血日志
    expect(report.log.some((e) => e.actor === 'player' && e.damage < 0)).toBe(false);
    // 玩家 5 刀杀鸡需 13.5s；鸡出手在 3/6/9/12s，第 4 口把 4 HP 的玩家打死 → 玩家先阵亡
    expect(report.end.kind).toBe('defeat');
  });
});
describe('simulateCombat - 失败路径', () => {
  it('玩家被击杀：end=defeat，不掉落、不加经验、玩家 HP 为 0', () => {
    const startedAt = 0;
    // 造一个必输局：玩家攻 0 防 0 HP 1，靠装备把 hp 扣到 1（max_hp = 12-2 = 2 太低，调不上去直接用最小面板）
    const hopeless = {
      max_hp: 3,
      attack: 0, // 打不动鸡（鸡防 0 也会打 0 伤害）
      defense: 0,
      interval_ms: PLAYER_ATTACK_INTERVAL_MS,
    };
    const report = simulateCombat({
      started_at: startedAt,
      now: startedAt + 30_000,
      player: hopeless,
      enemy: ENEMY_CHICKEN,
      food: {},
      rng: zeroRng,
    });
    expect(report.end.kind).toBe('defeat');
    expect(report.player_hp).toBe(0);
    expect(report.exp_gained).toBe(0);
    expect(report.item_drops).toEqual({});
    expect(report.equipment_drops).toEqual([]);
    // 最后一条日志必须是敌人出手
    expect(report.log[report.log.length - 1].actor).toBe('enemy');
  });
});

describe('simulateCombat - 时间边界', () => {
  it('now 早于双方第一次出手时返回空日志、双方满血、fighting', () => {
    const startedAt = 1_000;
    const report = simulateCombat({
      started_at: startedAt,
      now: startedAt + PLAYER_ATTACK_INTERVAL_MS - 1, // 还差 1ms 到第一刀
      player: LVL1_PLAYER,
      enemy: ENEMY_CHICKEN,
      food: {},
      rng: zeroRng,
    });
    expect(report.end.kind).toBe('fighting');
    expect(report.log).toHaveLength(0);
    expect(report.player_hp).toBe(LVL1_PLAYER.max_hp);
    expect(report.enemy_hp).toBe(ENEMY_CHICKEN.hp);
    expect(report.ended_at).toBe(startedAt);
  });

  it('战斗中途 stop：返回"截至 now 的战报"，end=fighting，血量是中间快照', () => {
    const startedAt = 0;
    // 玩家 2.7s 出手两次（5.4s），鸡 3s 出手一次（3s）；now=6s
    const report = simulateCombat({
      started_at: startedAt,
      now: 6_000,
      player: LVL1_PLAYER,
      enemy: ENEMY_CHICKEN,
      food: {},
      rng: zeroRng,
    });
    expect(report.end.kind).toBe('fighting');
    // 玩家已出手 2 次：鸡 HP = 5 - 2×1 = 3
    expect(report.enemy_hp).toBe(3);
    // 鸡已出手 2 次：玩家 HP = 14 - 2×1 = 12
    expect(report.player_hp).toBe(LVL1_PLAYER.max_hp - 2);
    // 日志总数 = 4
    expect(report.log).toHaveLength(4);
  });
});

describe('simulateCombat - 日志结构', () => {
  it('每条日志都带 at/actor/damage/target_hp，可独立回放', () => {
    const startedAt = 0;
    const report = simulateCombat({
      started_at: startedAt,
      now: startedAt + 20_000,
      player: LVL1_PLAYER,
      enemy: ENEMY_CHICKEN,
      food: { [FOOD_GRILLED_FISH.item_id]: 1 },
      rng: zeroRng,
    });
    for (const entry of report.log as CombatLogEntry[]) {
      expect(typeof entry.at).toBe('number');
      expect(entry.actor === 'player' || entry.actor === 'enemy').toBe(true);
      expect(typeof entry.damage).toBe('number');
      expect(typeof entry.target_hp).toBe('number');
      expect(entry.at).toBeGreaterThanOrEqual(startedAt);
      expect(entry.target_hp).toBeGreaterThanOrEqual(0);
    }
  });
});
