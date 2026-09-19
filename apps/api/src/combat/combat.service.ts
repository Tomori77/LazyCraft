import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../lib/prisma-client/client.js';
import {
  FOODS,
  addStacksToCarried,
  findEnemyById,
  findFoodById,
  findLootTableById,
  newUid,
  playerStats,
  simulateCombat,
  toEquipmentInstance,
  type CarriedItem,
  type CombatReport,
  type Enemy,
} from '@lazycraft/shared';
import { SaveService } from '../save/save.service.js';
import { BroadcastService } from '../broadcast/broadcast.service.js';
import type { SaveData, SaveDataV2 } from '../save/save-shape.js';

/**
 * 战斗服务（task-18）
 *
 * 服务器权威的三个关键点，与 ActionService 完全同构：
 *   1. 所有 started_at / now 都取服务器时钟——永远不信客户端时间戳；
 *   2. 每次战斗状态变更都先把"期望值"写进 updateMany 的 WHERE 子句做 CAS，
 *      防止两个标签页同时 start/stop 时互相覆盖；
 *   3. 战斗推演用 packages/shared 的 simulateCombat()，与前端预览走同一份规则代码。
 *
 * 与 ActionService 的分工：
 *   ActionService 管"挂机技能动作"（挖矿 / 砍树），CombatService 管"打怪"。
 *   两者消费同一份 SaveData，但互斥——start 战斗前必须先确认没有进行中的活动，
 *   start 活动前必须先确认没有进行中的战斗。
 */
@Injectable()
export class CombatService {
  constructor(
    private readonly saveService: SaveService,
    private readonly broadcastService: BroadcastService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* 查询                                                                */
  /* ---------------------------------------------------------------- */

  /**
   * 查询当前战斗状态。
   *
   * 进行中：返回截至 now 的实时战报（前端用它渲染血条 / 回放日志）。
   * 空闲：返回 current_combat=null，前端展示"打怪入口"。
   */
  async current(accountId: string) {
    const { data } = await this.saveService.read(accountId);
    const combat = this.readCombat(data);
    if (!combat) return { current_combat: null };

    const enemy = this.findEnemyOrThrow(combat.enemy_id);
    const now = Date.now();
    const report = this.simulate(data, enemy, combat.started_at, now);

    return {
      current_combat: combat,
      enemy,
      report,
    };
  }

  /* ---------------------------------------------------------------- */
  /* 开始                                                                */
  /* ---------------------------------------------------------------- */

  /**
   * 开始战斗。
   *
   * 服务器权威规则：同一时间只能干一件事。
   *   - 已有进行中的活动 → 409（先停止挂机再开打）
   *   - 已有进行中的战斗 → 409（重复开始不重置计时）
   */
  async start(accountId: string, enemyId: string) {
    const enemy = this.findEnemyOrThrow(enemyId);

    // 先读档做校验；校验不过不碰写路径
    const { data } = await this.saveService.read(accountId);
    if (data.current_action) {
      throw new ConflictException('已有进行中的活动，请先停止再开始战斗');
    }
    const existing = this.readCombat(data);
    if (existing) {
      // 重复开始同一个敌人 = 无操作（对齐 idle 的"重复开始不重置 started_at"）
      if (existing.enemy_id === enemyId) {
        return { current_combat: existing, enemy };
      }
      throw new ConflictException('已在战斗中，请先停止当前战斗');
    }

    const startedAt = Date.now();
    const nextData = this.withCombat(data, { enemy_id: enemyId, started_at: startedAt });
    await this.compareAndSwapCombat(accountId, null, nextData);

    return { current_combat: { enemy_id: enemyId, started_at: startedAt }, enemy };
  }

  /* ---------------------------------------------------------------- */
  /* 停止                                                                */
  /* ---------------------------------------------------------------- */

  /**
   * 停止战斗：推演至 now → 写入结算结果 → 清空 current_combat。
   *
   * 为什么 stop 也要 CAS：
   *   玩家可能双击 stop，或两个标签页同时停；
   *   第一次成功结算后 current_combat 已清空，第二次必须 409，
   *   否则会基于"已无战斗"的状态再返回一份误导性的空战报。
   */
  async stop(accountId: string) {
    const { data } = await this.saveService.read(accountId);
    const combat = this.readCombat(data);
    if (!combat) {
      throw new ConflictException('当前没有进行中的战斗');
    }
    const enemy = this.findEnemyOrThrow(combat.enemy_id);

    const now = Date.now();
    const report = this.simulate(data, enemy, combat.started_at, now);

    // 把结算产物落到存档：经验、掉落物、食物消耗、战斗状态清空
    const nextData = this.applyReport(data, report, enemy);
    await this.compareAndSwapCombat(accountId, combat, nextData);

    // 装备实例品质达 epic 即写广播流。
    // 为什么放在 CAS 成功之后？——广播是"掉落已成事实"的对外宣告，
    // 先宣告后落库会造成"广播说有、存档里没有"的不一致；
    // 反过来"存档有、广播丢"是 recordDrop 已兜底的良性降级。
    if (report.end.kind === 'victory' && report.equipment_drops.length > 0) {
      const player = await this.saveService.ensurePlayer(accountId);
      for (const eq of report.equipment_drops) {
        // recordDrop 内部已按 broadcast_threshold 默认 'epic' 判定并吞掉写库异常；
        // 这里无需额外 try/catch
        void this.broadcastService.recordDrop(player.id, eq.template_id, eq.quality);
      }
    }

    return { report, current_combat: null };
  }

  /* ---------------------------------------------------------------- */
  /* 内部：推演                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * 从存档构造 simulateCombat 的入参并跑一次完整推演。
   *
   * 装备属性来源：当前 P0 存档里 equipment 槽位还没有实际消费方
   * （战斗模块是第一个写入方），因此这里读取的是空兜底对象——
   * 等装备穿戴功能（后续任务）落地后，这一段会读取 data.equipment 聚合 final_stats。
   */
  private simulate(data: SaveData | SaveDataV2, enemy: Enemy, startedAt: number, now: number): CombatReport {
    const skills = (data.skills ?? {}) as Record<string, { exp?: number } | undefined>;
    const attackExp = typeof skills['attack']?.exp === 'number' ? (skills['attack']!.exp as number) : 0;

    // P0：存档里暂时没有"已穿戴装备"切片——装备槽位由任务链的后续任务写入；
    // 战斗模块先把读取点留出来，确保存档 schema 就位后只需改这一处
    const equipmentStats = { attack: 0, defense: 0, hp: 0 };

    // 食物存量：只遍历堆叠实例，把"在 FOODS 表里登记过的物品"聚成 food map
    const inventory = Array.isArray(data.inventory) ? (data.inventory as CarriedItem[]) : [];
    const food: Record<string, number> = {};
    for (const item of inventory) {
      if (item?.kind !== 'stack') continue;
      if (!findFoodById(item.item_id)) continue;
      food[item.item_id] = (food[item.item_id] ?? 0) + (typeof item.quantity === 'number' ? item.quantity : 0);
    }

    return simulateCombat({
      started_at: startedAt,
      now,
      player: playerStats(attackExp, equipmentStats),
      enemy,
      food,
    });
  }

  /* ---------------------------------------------------------------- */
  /* 内部：把战报回写到存档                                                */
  /* ---------------------------------------------------------------- */

  /**
   * 结算后落盘：消耗食物 / 写入掉落物 / 累加攻击经验 / 清空 current_combat。
   *
   * 为什么失败时也清空 current_combat 而不是保留让玩家重试：
   *   服务器权威原则 —— 玩家被打死是"已发生的现实"，不应让他
   *   "反悔"重新推一遍；保留 current_combat 反而会让玩家卡在
   *   "已死但还在打"的鬼畜状态。
   */
  private applyReport(data: SaveData | SaveDataV2, report: CombatReport, enemy: Enemy): SaveDataV2 {
    let next: SaveDataV2 = { ...(data as SaveDataV2), current_combat: null };

    // 1. 扣食物：从后往前扣（与 idle 的向左压缩相反——保留背包前段的视觉稳定性）；
    //    就地改数量以保留 uid，装备实例原样带过
    const consumedFood = report.food_consumed;
    if (Object.keys(consumedFood).length > 0) {
      const inv = Array.isArray(next.inventory) ? [...(next.inventory as CarriedItem[])] : [];
      for (const [foodId, qty] of Object.entries(consumedFood)) {
        let remaining = qty;
        for (let i = inv.length - 1; i >= 0 && remaining > 0; i -= 1) {
          const item = inv[i];
          if (item.kind !== 'stack' || item.item_id !== foodId) continue;
          const take = Math.min(item.quantity, remaining);
          inv[i] = { ...item, quantity: item.quantity - take };
          remaining -= take;
        }
      }
      next = {
        ...next,
        inventory: inv.filter((item) => item.kind !== 'stack' || item.quantity > 0),
      };
    }

    // 2. 结算掉落物：物品与装备实例都直接进背包（同一容器混装）
    if (report.end.kind === 'victory') {
      let inv = Array.isArray(next.inventory) ? [...(next.inventory as CarriedItem[])] : [];

      const items = report.item_drops;
      if (Object.keys(items).length > 0) {
        // 战斗掉落的材料恒为 common（与旧口径一致）
        inv = addStacksToCarried(
          inv,
          Object.entries(items).map(([item_id, quantity]) => ({ item_id, quantity, quality: 'common' as const })),
        );
      }

      // 装备实例（含词缀 / 属性快照）：落盘前经 toEquipmentInstance 补 slot / required_level；
      // 模板缺失时返回 null（配置错误安全出口），丢弃该件但不影响本次战斗结算
      for (const eq of report.equipment_drops) {
        const instance = toEquipmentInstance(eq, newUid());
        if (instance) inv.push(instance);
      }

      next = { ...next, inventory: inv };
    }

    // 3. 累加攻击经验：胜利才有（与 simulateCombat 的 exp_gained 对齐）
    if (report.exp_gained > 0) {
      const skills = { ...((next.skills ?? {}) as Record<string, { exp?: number } | undefined>) };
      const prev = typeof skills['attack']?.exp === 'number' ? (skills['attack']!.exp as number) : 0;
      skills['attack'] = { ...skills['attack'], exp: prev + report.exp_gained };
      next = { ...next, skills };
    }

    return next;
  }

  /* ---------------------------------------------------------------- */
  /* 内部：读写辅助                                                        */
  /* ---------------------------------------------------------------- */

  private findEnemyOrThrow(enemyId: string): Enemy {
    const enemy = findEnemyById(enemyId);
    if (!enemy) throw new NotFoundException(`敌人不存在: ${enemyId}`);
    return enemy;
  }

  /** 从存档 data 读 current_combat；v1 老数据没有该字段时按 null 兜底 */
  private readCombat(data: SaveData | SaveDataV2): { enemy_id: string; started_at: number } | null {
    const raw = (data as SaveDataV2).current_combat;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.enemy_id !== 'string' || typeof raw.started_at !== 'number') return null;
    return raw;
  }

  /** 把 current_combat 写回存档（不动其他字段） */
  private withCombat(
    data: SaveData | SaveDataV2,
    combat: { enemy_id: string; started_at: number } | null,
  ): SaveDataV2 {
    return { ...(data as SaveDataV2), current_combat: combat };
  }

  /**
   * 把 current_combat 从 expected 改成 nextData 的原子写入。
   *
   * 与 ActionService 的 compare-and-swap 完全同构：
   *   把期望值写进 WHERE 子句，让数据库行锁串行化两次并发请求；
   *   count=0 时抛 409，让调用方重新拉取后再试。
   */
  private async compareAndSwapCombat(
    accountId: string,
    expected: { enemy_id: string; started_at: number } | null,
    nextData: SaveDataV2,
  ) {
    const player = await this.saveService.ensurePlayer(accountId);
    const where: Prisma.SaveWhereInput = {
      playerId: player.id,
      ...(expected === null
        ? { data: { path: ['current_combat'], equals: Prisma.JsonNull } }
        : {
            data: {
              path: ['current_combat'],
              equals: expected as unknown as Prisma.InputJsonValue,
            },
          }),
    };
    const result = await this.saveService.prisma.save.updateMany({
      where,
      data: { data: nextData as unknown as Prisma.InputJsonValue },
    });
    if (result.count === 0) {
      throw new ConflictException('战斗状态已变化，请重新拉取后重试');
    }
  }
}
