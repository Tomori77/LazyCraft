/**
 * 战斗核心 —— 服务器权威的第二块结算引擎（第一块是 idle）。
 *
 * 为什么放在 packages/shared？
 *   与 idle 同一铁律：前端用它做"若开打会打成什么样"的预演，
 *   后端用它做权威结算并回写存档。规则的任何一份拷贝都会在未来
 *   变成"前端显示能赢、后端判你死了"的事故源头。
 *
 * 为什么整段战斗一次性算完，而不是挂在 tick 循环上？
 *   与 idle.settle 同构：战斗状态只有"开始时刻 + 敌人"两个输入，
 *   过程是确定的数值推演（伤害公式是减法不是概率），逐事件模拟
 *   没有信息增量；一次性推演让 stop 在任意时刻都返回"截至现在的
 *   完整战报"，断线重连也能凭 started_at 重放同一结果。
 *
 * 为什么伤害是 atk - def 的减法？
 *   P0 阶段数值极小（鸡 1 攻对玩家 ~0 防），乘区公式在低数值段
 *   会产生大量 0 伤害回合，玩家看不懂"为什么我打不动 1 级怪"；
 *   减法公式直白（面板差即伤害），平衡性留给战斗 DLC 换公式。
 *
 * 随机性声明：
 *   死亡掉落走 rollLoot，需要 rng；由调用方注入（默认 Math.random），
 *   与 idle 引擎"时间戳必须由后端注入"的作风一致——本模块不自带
 *   任何不可控输入。
 */

import type { Enemy } from '../types.js';
import { levelFromExp } from '../skill/skill-service.js';
import { rollLoot, findLootTableById, type LootResult, type Equipment } from '../loot/index.js';
import { FOODS } from './foods.js';

/** 食物恢复量表：推演里动态查，防御"背包里有非食物物品"的脏数据 */
const FOOD_HEAL: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(Object.values(FOODS).map((f) => [f.item_id, f.heal])),
);

/* ------------------------------------------------------------------ */
/* 平衡常量（集中在此，调平衡只动这一段）                                  */
/* ------------------------------------------------------------------ */

/** 玩家攻击间隔（毫秒）：比鸡快 300ms，空手也能稳定先手 */
export const PLAYER_ATTACK_INTERVAL_MS = 2_700;

/** 玩家单次攻击的基础攻击间隔之外的等级加成：攻击等级每级 +1 攻击力 */
export const PLAYER_ATTACK_PER_LEVEL = 1;

/** 玩家基础生命值：1 级玩家的生命值（无装备时） */
export const PLAYER_BASE_HP = 12;

/** 每点攻击等级额外生命：让"练攻击"有直观的生存回报 */
export const PLAYER_HP_PER_LEVEL = 2;

/** 死亡惩罚的比例系数：死亡后损失（清空当前战斗的一切收益，回到起点） */
export const DEATH_PENALTY_NOTE = '战斗失败后不会丢失物品，但本次战斗的全部收益作废';

/* ------------------------------------------------------------------ */
/* 类型                                                                  */
/* ------------------------------------------------------------------ */

/** 战斗参与者（玩家侧）的输入属性 */
export interface CombatantStats {
  /** 生命值上限 */
  max_hp: number;
  /** 攻击力 */
  attack: number;
  /** 防御力 */
  defense: number;
  /** 攻击间隔（毫秒） */
  interval_ms: number;
}

/** 玩家背包切片：战斗只需要知道有多少食物 */
export interface CombatInventory {
  /** item_id -> 数量 */
  food: Record<string, number>;
}

/** 战斗开始入参 */
export interface StartCombatInput {
  /** 服务器当前时间（毫秒）：必须是服务器时钟，永远不信客户端 */
  now: number;
  /** 攻击技能累计经验（推出玩家攻击等级/攻防） */
  attack_exp: number;
  /** 装备提供的属性加成（task-14 装备快照：武器攻击 + 护甲防御 + 生命） */
  equipment_stats: { attack: number; defense: number; hp: number };
  /** 背包里的食物存量（item_id -> 数量） */
  food: CombatInventory['food'];
}

/** 一次有效攻击的战斗日志条目（前端逐条回放到日志面板） */
export interface CombatLogEntry {
  /** 服务器时间戳：这一次攻击发生的时刻 */
  at: number;
  /** 出手方 */
  actor: 'player' | 'enemy';
  /** 实际造成的伤害（已扣防御，最小 0） */
  damage: number;
  /** 受击方剩余生命 */
  target_hp: number;
}

/** 战斗结束形态 */
export type CombatEndState =
  | { kind: 'fighting' }
  | { kind: 'victory'; loot: LootResult | undefined }
  | { kind: 'defeat' };

/** 一次完整推演（从开始到某个时间点）的战报 */
export interface CombatReport {
  /** 战斗开始时刻（= 入参 started_at） */
  started_at: number;
  /** 推演截止时刻（= 入参 now，或死亡/胜利发生的自然时刻之前的最后一次有效攻击） */
  ended_at: number;
  /** 战斗结果 */
  end: CombatEndState;
  /** 玩家当前生命（结束时的快照；胜利/战斗中为当前值，死亡为 0） */
  player_hp: number;
  /** 敌人当前生命（结束时的快照；胜利为 0） */
  enemy_hp: number;
  /** 玩家吃掉了多少食物（item_id -> 数量） */
  food_consumed: Record<string, number>;
  /** 完整攻击日志（含玩家与敌人的每一次出手） */
  log: CombatLogEntry[];
  /** 战斗结束时给予的攻击技能经验（胜利=敌人等级×2，失败=0） */
  exp_gained: number;
  /** 掉落的装备实例（rollLoot 出 equipment 时），用于后端入 player_equipment 表 */
  equipment_drops: Equipment[];
  /** 直接掉物品的部分（item_id -> 数量），用于后端入背包 */
  item_drops: Record<string, number>;
}

/** 进行中的战斗快照（存到存档 data.combat） */
export interface ActiveCombat {
  /** 敌人 id */
  enemy_id: string;
  /** 服务器时间戳（毫秒）：战斗开始时刻 */
  started_at: number;
}

/* ------------------------------------------------------------------ */
/* 玩家面板属性计算（纯函数）                                              */
/* ------------------------------------------------------------------ */

/** 由攻击经验推玩家当前攻击等级（最低 1 级） */
export function playerAttackLevel(attackExp: number): number {
  return levelFromExp(attackExp);
}

/**
 * 计算玩家战斗面板属性。
 *
 * 为什么 max_hp 不是固定 10？
 *   《框架设计》的"练级有回报"原则：攻击等级既影响"打得动"也影响"扛得住"。
 *   把 hp 挂在等级上，避免了 P0 单独再做一套"生命技能"。
 */
export function playerStats(attackExp: number, equipment: { attack: number; defense: number; hp: number }): CombatantStats {
  const level = playerAttackLevel(attackExp);
  return {
    max_hp: PLAYER_BASE_HP + level * PLAYER_HP_PER_LEVEL + Math.max(0, equipment.hp),
    attack: level * PLAYER_ATTACK_PER_LEVEL + Math.max(0, equipment.attack),
    defense: Math.max(0, equipment.defense),
    interval_ms: PLAYER_ATTACK_INTERVAL_MS,
  };
}

/** 敌人面板属性：直接读 Enemy 数据，间隔给一个统一的"小怪攻速" */
export function enemyStats(enemy: Enemy): CombatantStats {
  return {
    max_hp: Math.max(1, enemy.hp),
    attack: Math.max(0, enemy.attack),
    defense: Math.max(0, enemy.defense),
    // 敌人攻击间隔：固定 3s。未来需要"快攻型小怪"再把 interval 挂到 Enemy 类型上。
    interval_ms: 3_000,
  };
}

/* ------------------------------------------------------------------ */
/* 主推演：从 started_at 一次性推到 now                                   */
/* ------------------------------------------------------------------ */

export interface SimulateCombatInput {
  /** 服务器时间戳：战斗开始时刻 */
  started_at: number;
  /** 服务器时间戳：推演截止时刻（必须 ≥ started_at） */
  now: number;
  /** 玩家面板 */
  player: CombatantStats;
  /** 敌人配置 */
  enemy: Enemy;
  /** 背包食物存量（会被消耗；按 FOODS 表的注册顺序食用） */
  food: Record<string, number>;
  /** 掉落随机数源（胜利时调用一次 rollLoot） */
  rng?: () => number;
}

/**
 * 推演一场战斗到指定时刻。
 *
 * 为什么不在每次 attack 事件里立即结算掉落/经验？
 *   掉落只在"敌人死亡"那一刻触发，而推演过程可能跨过那个时刻继续打；
 *   把死亡判定放在"每一轮出手"之后、掉落放在战后统一结算，
 *   日志读起来才是"打死 → 播掉落"的顺序，而不是掉落夹在战报中段。
 *
 * 食物触发规则（P0 用最简单的一档）：
 *   玩家受到伤害后，如果 hp < max_hp 的 30%，且背包有食物，立即吃一口。
 *   为什么是 30% 而不是 50%：
 *   低数值区间（玩家 ~14 HP）下 30% ≈ 4 HP，恰好在"鸡一口 1 伤"的
 *   节奏里留出 3~4 次挨打的容错；50% 会让玩家几乎不掉血，挂机收益
 *   失去"带食物"的策略感。
 */
export function simulateCombat(input: SimulateCombatInput): CombatReport {
  const { started_at, now, enemy, rng = Math.random } = input;
  const player = input.player;
  const enemyStat = enemyStats(enemy);

  // 玩家剩余食物的工作副本：推演期间只动这份，不改入参
  const foodLeft: Record<string, number> = { ...input.food };
  // 食物食用顺序：按 item_id 字典序固定，保证同一存档推演结果可复现
  const foodOrder = Object.keys(foodLeft).sort();

  const playerMaxHp = player.max_hp;
  const enemyMaxHp = enemyStat.max_hp;

  let playerHp = playerMaxHp;
  let enemyHp = enemyMaxHp;

  const log: CombatLogEntry[] = [];
  const foodConsumed: Record<string, number> = {};

  // 双方下一次出手时刻：玩家从 started_at + interval 起手，敌人稍后
  let playerNextAt = started_at + player.interval_ms;
  let enemyNextAt = started_at + enemyStat.interval_ms;

  /** 玩家吃一口食物（如果触发了恢复条件） */
  const tryEat = (at: number) => {
    if (playerHp >= playerMaxHp * 0.3) return;
    for (const foodId of foodOrder) {
      const left = foodLeft[foodId] ?? 0;
      if (left <= 0) continue;
      // 动态查食物配置，背包里有但配置表里没有的物品不吃（防御配错）
      const heal = FOOD_HEAL[foodId];
      if (!heal) continue;
      foodLeft[foodId] = left - 1;
      foodConsumed[foodId] = (foodConsumed[foodId] ?? 0) + 1;
      playerHp = Math.min(playerMaxHp, playerHp + heal);
      log.push({ at, actor: 'player', damage: -heal, target_hp: playerHp });
      return;
    }
  };

  /**
   * 一方出手：伤害 = max(0, atk - def)，扣目标 HP 并记日志；
   * 返回目标是否死亡。
   */
  const strike = (actor: 'player' | 'enemy', at: number): boolean => {
    if (actor === 'player') {
      const damage = Math.max(0, player.attack - enemyStat.defense);
      enemyHp = Math.max(0, enemyHp - damage);
      log.push({ at, actor, damage, target_hp: enemyHp });
      return enemyHp <= 0;
    }
    // 敌人出手：先算基础伤害，扣玩家 HP
    const damage = Math.max(0, enemyStat.attack - player.defense);
    playerHp = Math.max(0, playerHp - damage);
    log.push({ at, actor, damage, target_hp: playerHp });
    // 玩家被打后若血量告急且有食物，立刻吃一口再继续
    if (playerHp > 0) tryEat(at);
    return playerHp <= 0;
  };

  // —— 主循环：按时间顺序交错双方出手，直到一方死亡或推演到 now ——
  let endedAt = started_at;
  let outcome: CombatEndState = { kind: 'fighting' };

  while (true) {
    // 取下一次最早的出手方；平手时玩家先手（观感更爽，且数值上无差异）
    const playerTurn = playerNextAt <= enemyNextAt;
    const at = playerTurn ? playerNextAt : enemyNextAt;
    if (at > now) break; // 推演到目标时刻为止
    endedAt = at;

    const dead = strike(playerTurn ? 'player' : 'enemy', at);
    if (dead) {
      outcome = playerTurn ? { kind: 'victory', loot: undefined } : { kind: 'defeat' };
      break;
    }
    if (playerTurn) {
      playerNextAt += player.interval_ms;
    } else {
      enemyNextAt += enemyStat.interval_ms;
    }
  }

  // —— 胜利收尾：抽掉落、结算经验 ——
  let expGained = 0;
  const itemDrops: Record<string, number> = {};
  const equipmentDrops: Equipment[] = [];

  if (outcome.kind === 'victory') {
    // 经验与敌人等级挂钩：打高级怪回报更高（防止刷 1 级鸡到满级）
    expGained = Math.max(1, enemy.level) * 2;
    const table = enemy.loot_table_id ? findLootTableById(enemy.loot_table_id) : undefined;
    if (table) {
      const loot = rollLoot({ table, rng });
      outcome = { kind: 'victory', loot };
      if (loot?.kind === 'item') {
        itemDrops[loot.item_id] = (itemDrops[loot.item_id] ?? 0) + loot.quantity;
      } else if (loot?.kind === 'equipment') {
        equipmentDrops.push(loot.equipment);
      }
    }
  }

  return {
    started_at,
    ended_at: endedAt,
    end: outcome,
    player_hp: playerHp,
    enemy_hp: enemyHp,
    food_consumed: foodConsumed,
    log,
    exp_gained: expGained,
    equipment_drops: equipmentDrops,
    item_drops: itemDrops,
  };
}
