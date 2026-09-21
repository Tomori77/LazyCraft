import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../lib/prisma-client/client.js';
import {
  dueTicks,
  levelFromExp,
  mergeSettledStacks,
  nextTickAt,
  settle,
  settleQueue,
  aggregateQueueReports,
  QUEUE_MAX_SLOTS,
  QUEUE_UNLOCKED_SLOTS,
  StopReason,
  type ActionQueueItem,
  type CarriedItem,
  type ItemStack,
  type PlayerState,
  type Quality,
  type QueueItemReport,
  type SettledStack,
  type SkillAction,
  type SettleReport,
  type StackItemInstance,
} from '@lazycraft/shared';
import { SaveService } from '../save/save.service.js';
import { ContentService } from '../content/content.service.js';
import {
  DEFAULT_INVENTORY_CAPACITY,
  type ActiveActionData,
  type SaveData,
  type SaveDataV3,
} from '../save/save-shape.js';

/**
 * 引擎 ItemStack 的本地扩展：quality 在类型上不属于 ItemStack，
 * 但会随 settle 的浅拷贝原样保留，合并回容器时需要它来正确匹配堆叠。
 */
type EngineStack = ItemStack & { quality?: Quality };

interface SkillsMap {
  [skillId: string]: { exp?: number } | undefined;
}

/**
 * 活动（挂机动作）服务
 *
 * 服务器权威的三个关键点：
 *   1. 所有 started_at / now 都取服务器时钟，永远不信客户端时间戳；
 *   2. 每次写存档前都重读 DB，并条件更新 current_action——防止两个标签页并发时互相覆盖；
 *   3. 结算用 packages/shared 的 settle()，与前端预览走同一份规则代码。
 */
/**
 * 结算产物订阅：任务模块（task-13）用来累计 craft_item 任务进度。
 *
 * 为什么用"注册监听器"而不是直接注入 QuestService？
 *   动作模块（task-08）早于任务模块（task-13）存在；二者需要相互消费
 *   会形成 import 环。用注册接口把"是否有人关心 gained"做成可选能力，
 *   QuestModule 加载时自己注册进来；测试只加载 ActionModule 时行为退化为
 *   "无监听器 = 不上报"，与历史版本完全一致。
 */
export type SettlementListener = (
  accountId: string,
  gained: SettleReport['gained'],
) => void | Promise<void>;

/** 空结算报告：settle-due 在"无到期圈/无活动"时的统一返回，前端可当无产出处理 */
function emptyReport(): SettleReport {
  return {
    effective_seconds: 0,
    ticks: 0,
    gained: [],
    consumed: [],
    lost: [],
    exp_gained: {},
    stop_reason: StopReason.NoTicks,
  };
}

@Injectable()
export class ActionService {
  constructor(
    private readonly saveService: SaveService,
    // 动作/技能解析统一走内容快照，保证与 /api/content 同一事实源（含 DLC 注册内容）
    private readonly contentService: ContentService,
  ) {}

  /** 结算产物监听器：QuestService 注册，触发 craft_item 任务的进度累计 */
  private settlementListeners: SettlementListener[] = [];

  /** 由外部模块（QuestModule.onModuleInit）注册；多次注册按顺序逐个调用 */
  registerSettlementListener(listener: SettlementListener) {
    this.settlementListeners.push(listener);
  }

  /**
   * 把存档 data 切成 idle 引擎认识的 PlayerState。
   * 存档是 JSONB，字段可能缺失（比如老存档），全部走兜底默认值。
   *
   * 为什么只取 kind:'stack'？
   *   idle 引擎按"格"处理 `ItemStack`；装备实例不参与挂机产出/消耗，
   *   混进去会让引擎把它当成 quantity 未定义的怪物格。装备在 stop 合并阶段原样保留。
   */
  private toPlayerState(data: SaveData): PlayerState {
    const skills = (data.skills ?? {}) as SkillsMap;
    const skill_exp: Record<string, number> = {};
    for (const [skillId, rec] of Object.entries(skills)) {
      skill_exp[skillId] = typeof rec?.exp === 'number' ? rec.exp : 0;
    }
    const current = data.current_action as ActiveActionData | null;
    return {
      inventory: this.stacksOf(data),
      inventory_capacity:
        typeof (data as Partial<SaveDataV3>).inventory_capacity === 'number'
          ? (data as Partial<SaveDataV3>).inventory_capacity!
          : DEFAULT_INVENTORY_CAPACITY,
      skill_exp,
      // 引擎只认 action_id / started_at；skill_id 是存档层的冗余，不传给引擎
      current_action: current
        ? { action_id: current.action_id, started_at: current.started_at }
        : null,
    };
  }

  /**
   * 从存档 inventory 提取堆叠物并转成引擎 ItemStack；装备实例不参与挂机。
   *
   * 为什么把 quality 也带上（引擎类型虽不含该字段）？
   *   settle 内部只做 `{...s}` 浅拷贝与就地数量增减，额外属性会随原格保留；
   *   若丢掉，合并回容器时 rare 堆叠会匹配不上而被误删——直接违反"不许丢数据"。
   */
  private stacksOf(data: SaveData): EngineStack[] {
    const inventory = Array.isArray(data.inventory) ? (data.inventory as CarriedItem[]) : [];
    return inventory
      .filter((item): item is StackItemInstance => item?.kind === 'stack')
      .map((s) => ({ item_id: s.item_id, quantity: s.quantity, quality: s.quality }));
  }

  /** 从存档 skills 读出玩家某技能等级（无记录按 1 级） */
  private skillLevel(data: SaveData, skillId: string): number {
    const skills = (data.skills ?? {}) as SkillsMap;
    const exp = typeof skills[skillId]?.exp === 'number' ? (skills[skillId]!.exp as number) : 0;
    return levelFromExp(exp);
  }

  /**
   * 开始活动。
   *
   * 与队列的互斥（已定方案 b）：
   *   队列非空时禁止手动开始单动作——否则"手动覆盖 current_action"会与
   *   队列的自动接续相互打架（谁该跑队首变得不可判定）。要手动玩，先清空队列。
   *   空闲且队列非空时，settle-due 会自动起跑队首，玩家无需手动开始。
   *
   * 为什么用"条件 updateMany"而不是 read-check-write？
   *   两个请求同时抢开始时，check 都可能通过、write 互相覆盖；
   *   把"current_action 为 null"写进 WHERE 子句，让数据库行锁串行化，
   *   后到的那次 count=0，直接转成 409——不需要事务也不需要 SELECT FOR UPDATE。
   */
  async start(accountId: string, skillId: string, actionId: string) {
    const action = this.findActionOrThrow(actionId);
    this.assertActionBelongsToSkill(action, skillId);

    // 第一次读：做校验。校验不过就不该碰 DB 写路径
    const { data } = await this.saveService.read(accountId);
    if (data.current_action) {
      // 已有活动在进行：服务器权威规则"同一时间只能有一个主动活动"
      throw new ConflictException('已有进行中的活动，请先停止再开始新的');
    }
    if (this.readQueue(data).length > 0) {
      // 队列非空时手动开始被拒（方案 b）；提示玩家先清空队列
      throw new ConflictException('队列进行中，无法手动开始单个动作；请先清空队列');
    }
    this.assertLevelEnough(data, action);
    this.assertMaterialsEnough(data, action);

    // 构造"开始动作后"的存档：只改 current_action，其它字段原样回填
    const started_at = Date.now();
    const nextData: SaveData = {
      ...data,
      current_action: {
        skill_id: action.skill_id,
        action_id: action.id,
        started_at,
      },
    };
    await this.compareAndSwapCurrentAction(accountId, null, nextData);

    return {
      current_action: nextData.current_action,
      // 刚开始 = 0 圈已完成，nextTickAt 即 started_at + interval（走 shared 同一口径）
      next_tick_at: nextTickAt(started_at, action.interval_ms, started_at),
      // 随响应一并下发 interval_ms：前端启动进度条动画需要它，
      // 否则要在 start 之后再发一次 GET /current 补这个字段（远程 DB 下多一次 ~230ms 往返）。
      // 只增字段、不改任何语义，服务器权威口径不变。
      interval_ms: action.interval_ms,
    };
  }

  /**
   * 手动停止活动：结算 → 清空 current_action → 返回结算报告。
   *
   * 队列语义（task-36）：停止 = "停下一切"。若队列非空，按队列顺序把
   * 截至 now 的圈（含离线欠圈，受 24h 上限）结算掉，然后清空队列与当前动作。
   * 为什么不保留队列？保留的话 settle-due 的"空闲即起跑"会立刻把它重新拉起，
   * 玩家点击停止将毫无效果；要保留队列就该用队列面板做"暂停/删除"。
   *
   * 为什么 stop 也要条件更新？
   *   防止玩家双击 stop：第一次成功结算后 current_action 已清空，
   *   第二次必须 409，否则会基于"已无动作"的状态再返回一份全零报告误导前端。
   */
  async stop(accountId: string) {
    const { data } = await this.saveService.read(accountId);
    const current = data.current_action as ActiveActionData | null;
    const queue = this.readQueue(data);

    // 空闲但队列存在（刚入队、settle-due 尚未起跑）：停 = 清空队列
    if (!current) {
      if (queue.length > 0) {
        const nextData: SaveData = { ...data, action_queue: [] };
        await this.compareAndSwapCurrentAction(accountId, null, nextData);
        return { report: emptyReport(), current_action: null, action_queue: [] };
      }
      throw new ConflictException('当前没有进行中的活动');
    }

    const now = Date.now();

    // 队列非空：按队列顺序结清截至 now 的圈，然后清空
    if (queue.length > 0) {
      const result = settleQueue({
        player: this.toPlayerState(data),
        queue,
        now,
        resolveAction: (id) => this.resolveActionOrUndefined(id),
      });
      const report = aggregateQueueReports(result.reports, result.stop_reason);
      const inventory = mergeSettledStacks(
        Array.isArray(data.inventory) ? (data.inventory as CarriedItem[]) : [],
        result.player.inventory as SettledStack[],
      );
      // stop = 停下一切：即使队列尚有剩余，也整条清掉
      const nextData: SaveData = {
        ...data,
        inventory,
        skills: this.mergeExpIntoSkills(data, result.player.skill_exp),
        current_action: null,
        action_queue: [],
      };
      await this.compareAndSwapCurrentAction(accountId, current, nextData);
      await this.notifyGained(accountId, report.gained);
      return { report, current_action: null, action_queue: [], queue_reports: result.reports };
    }

    const action = this.findActionOrThrow(current.action_id);
    const { player, report } = settle({
      player: this.toPlayerState(data),
      action,
      now,
    });

    // 结算后的引擎背包合并回容器：优先复用同 (item_id, quality) 已有实例的 uid，
    // 避免每次结算都换 uid 导致前端背包整片重挂载
    const inventory = mergeSettledStacks(
      Array.isArray(data.inventory) ? (data.inventory as CarriedItem[]) : [],
      player.inventory as SettledStack[],
    );

    // 把结算后的引擎状态写回存档字段；current_action 置空由引擎保证，这里再显式一次兜底
    const nextData: SaveData = {
      ...data,
      inventory,
      skills: this.mergeExpIntoSkills(data, player.skill_exp),
      current_action: null,
    };
    await this.compareAndSwapCurrentAction(accountId, current, nextData);

    await this.notifyGained(accountId, report.gained);

    return { report, current_action: null, action_queue: [] };
  }

  /**
   * 查询当前活动 + 预计下次结算时刻（**只读，不写存档**）。
   *
   * next_tick_at 必须随 now 推进：= started_at + (已完成圈数 + 1) × interval。
   * 若恒取 started_at + interval，前端进度条走满后进不了下一圈（P1-1 的根因），
   * 且无法与"已结算的圈"对齐。计算收敛在 shared 的 nextTickAt()，前后端同源。
   */
  async current(accountId: string) {
    const { data } = await this.saveService.read(accountId);
    const current = data.current_action as ActiveActionData | null;
    const queue = this.readQueue(data);
    if (!current) {
      return { current_action: null, action_queue: queue };
    }
    const action = this.findActionOrThrow(current.action_id);
    const now = Date.now();
    return {
      current_action: current,
      action_queue: queue,
      next_tick_at: nextTickAt(current.started_at, action.interval_ms, now),
      interval_ms: action.interval_ms,
    };
  }

  /**
   * 结清"截至现在的所有到期整圈"，并保持动作继续（梅尔沃式逐圈产出）。
   *
   * 与 stop 的区别：
   *   - stop 结清后 current_action 置空；
   *   - settleDue 结清后把已结算的圈从 started_at 上推进掉（started_at += ticks × interval），
   *     动作 id/skill 不变，下一圈从新边界继续，不会重复结算同一批圈。
   *
   * 队列语义（task-36）：
   *   - 队列非空且当前无动作 → 自动开始队首项（"空闲即起跑"）；
   *   - 队首项完成设定圈数 → 移除并接续下一项，每圈即时产出体验不破坏。
   *   两种情况都用同一个 CAS 写路径：把"期望的 current_action"写进 WHERE，
   *   并发争抢只有一个能成功。
   *
   * 为什么用条件写入而不是普通 update？
   *   两个标签页可能同时到达圈末，都会算出同一批 ticks；把"期望的原 current_action
   *   （含原 started_at）"写进 WHERE，只有一个能成功，另一个 count=0 → 409，
   *   防止同一批圈被发放两次。
   */
  async settleDue(accountId: string) {
    const { data } = await this.saveService.read(accountId);
    const current = data.current_action as ActiveActionData | null;
    const queue = this.readQueue(data);
    const now = Date.now();

    // 空闲 + 有队列：自动起跑队首（把 current_action 落成队首项）。
    // CAS 期望 null：两个并发请求只有一个能起跑，另一个 409 后重拉即可。
    if (!current && queue.length > 0) {
      const head = queue[0];
      const action = this.findActionOrThrow(head.action_id);
      const nextData: SaveData = {
        ...data,
        current_action: {
          skill_id: action.skill_id,
          action_id: action.id,
          started_at: now,
        },
      };
      await this.compareAndSwapCurrentAction(accountId, null, nextData);
      return {
        report: emptyReport(),
        current_action: nextData.current_action,
        action_queue: queue,
        queue_reports: [] as QueueItemReport[],
        next_tick_at: nextTickAt(now, action.interval_ms, now),
        interval_ms: action.interval_ms,
      };
    }

    // 没有进行中的活动：返回空报告而不是 409。
    // 为什么？前端"圈末触发结算"与"玩家恰好在此期间 stop"会天然竞争，
    // 这时返回空报告让前端平滑收敛到空闲，比报错更符合幂等语义。
    if (!current) {
      return {
        report: emptyReport(),
        current_action: null,
        action_queue: queue,
        queue_reports: [] as QueueItemReport[],
        next_tick_at: null,
        interval_ms: null,
      };
    }

    const action = this.findActionOrThrow(current.action_id);
    const ticks = dueTicks(current.started_at, action.interval_ms, now);

    // 尚未走满一圈：不改存档，原样回当前状态供前端续走
    if (ticks === 0) {
      return {
        report: emptyReport(),
        current_action: current,
        action_queue: queue,
        queue_reports: [] as QueueItemReport[],
        next_tick_at: nextTickAt(current.started_at, action.interval_ms, now),
        interval_ms: action.interval_ms,
      };
    }

    // 队列为空：沿用 v4 之前的单动作通路（口径与既有 e2e 完全一致）
    if (queue.length === 0) {
      return this.settleDueSingle(accountId, data, current, action, ticks, now);
    }

    // 有队列：按队列顺序结清（队首必为 current.action_id，否则视为未起跑）
    const result = settleQueue({
      player: this.toPlayerState(data),
      queue,
      now,
      resolveAction: (id) => this.resolveActionOrUndefined(id),
    });
    const report = aggregateQueueReports(result.reports, result.stop_reason);
    const inventory = mergeSettledStacks(
      Array.isArray(data.inventory) ? (data.inventory as CarriedItem[]) : [],
      result.player.inventory as SettledStack[],
    );
    const nextCurrent = this.activeActionDataOf(result.player.current_action, data);
    const nextData: SaveData = {
      ...data,
      inventory,
      skills: this.mergeExpIntoSkills(data, result.player.skill_exp),
      current_action: nextCurrent,
      action_queue: result.queue,
    };
    await this.compareAndSwapCurrentAction(accountId, current, nextData);

    await this.notifyGained(accountId, report.gained);

    return {
      report,
      current_action: nextCurrent,
      action_queue: result.queue,
      queue_reports: result.reports,
      // next_tick_at 必须按"续跑的当前动作"算 interval，不能沿用已被换掉的队首
      next_tick_at: this.nextTickFor(nextCurrent, now),
      interval_ms: this.intervalFor(nextCurrent),
    };
  }

  /** 无队列时的单动作逐圈结算（v4 之前的行为原样保留） */
  private async settleDueSingle(
    accountId: string,
    data: SaveData,
    current: ActiveActionData,
    action: SkillAction,
    ticks: number,
    now: number,
  ) {
    // 传 now = started_at + ticks * interval：让引擎恰好结算 ticks 圈，
    // 既不会多算（now 已到的不足一圈），也不会漏算
    const settledAt = current.started_at + ticks * action.interval_ms;
    const { player, report } = settle({
      player: this.toPlayerState(data),
      action,
      now: settledAt,
    });

    // 是否继续：引擎因材料耗尽/背包满提前停，或实际圈数少于到期圈数 → 动作结束
    const stopped =
      report.stop_reason === StopReason.InputExhausted ||
      report.stop_reason === StopReason.InventoryFull ||
      report.ticks < ticks;

    const inventory = mergeSettledStacks(
      Array.isArray(data.inventory) ? (data.inventory as CarriedItem[]) : [],
      player.inventory as SettledStack[],
    );

    const nextCurrent: ActiveActionData | null = stopped
      ? null
      : { ...current, started_at: current.started_at + ticks * action.interval_ms };

    const nextData: SaveData = {
      ...data,
      inventory,
      skills: this.mergeExpIntoSkills(data, player.skill_exp),
      current_action: nextCurrent,
    };
    await this.compareAndSwapCurrentAction(accountId, current, nextData);

    await this.notifyGained(accountId, report.gained);

    return {
      report,
      current_action: nextCurrent,
      action_queue: [] as ActionQueueItem[],
      queue_reports: [] as QueueItemReport[],
      next_tick_at: nextCurrent
        ? nextTickAt(nextCurrent.started_at, action.interval_ms, now)
        : null,
      interval_ms: action.interval_ms,
    };
  }

  /* ---------------------------------------------------------------- */
  /* 内容重载时中断引用已停用内容的动作（task-42）                         */
  /* ---------------------------------------------------------------- */

  /**
   * 中断所有"当前动作 / 队列项引用了给定动作 id"的存档。
   *
   * 为什么放在 ActionService 而不是 admin 侧？
   *   写存档的 CAS 范式（条件 updateMany + 期望 current_action）只有这里有一套；
   *   在管理服务里复制一份，等于让"改存档必须条件写"这条铁律出现第二个实现，
   *   将来任一处改动就会分叉。把它做成受控 public 方法，admin 只负责"给动作 id 列表 + 记审计"。
   *
   * 为什么用 read → 计算 → CAS 而不是一条 SQL 直接改 JSONB？
   *   清除规则（队首/队列行的取舍、清空后 current_action 置 null）是**领域规则**，
   *   用 TS 表达比写一段 JSONB 拼接 SQL 更可读、更不易错；CAS 保证并发安全。
   *
   * 扫描范围：调用方传入的 actionIds 已是"当前所有已停用 pack 的动作全集"，
   *   因此本方法本身是幂等的——重复调用同一份集合不会漏掉中断残留。
   *
   * 性能：先用 DB 侧 JSONB 查询**只定位**受影响存档（不把 data 拉回 Node），
   *   再逐条走一次 CAS 写。受影响量通常远小于全表。
   */
  async interruptActionsReferencing(
    actionIds: string[],
  ): Promise<{ affectedPlayers: number; interruptedActions: string[] }> {
    if (actionIds.length === 0) return { affectedPlayers: 0, interruptedActions: [] };
    const target = new Set(actionIds);

    // 只取存档 id（定位），data 在逐条 CAS 前再读——避免把大 JSONB 全量搬进内存
    const rows = await this.saveService.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id
         FROM saves
        WHERE (data -> 'current_action' ->> 'action_id') = ANY($1::text[])
           OR EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(COALESCE(data -> 'action_queue', '[]'::jsonb)) AS q
                 WHERE q ->> 'action_id' = ANY($1::text[])
              )`,
      actionIds,
    );

    const interrupted = new Set<string>();
    for (const row of rows) {
      await this.interruptOneSave(row.id, target, interrupted);
    }

    return { affectedPlayers: rows.length, interruptedActions: [...interrupted].sort() };
  }

  /**
   * 对单份存档执行中断：只删"引用停用动作"的 current_action 与队列行，
   * 其它字段（背包/技能/资源/装备）一律原样保留。
   *
   * 为什么用 save.id 作为 CAS 定位而不是 accountId？
   *   interruptActionsReferencing 是"按存档定位"的批量操作（可能一份账号多角色），
   *   这里按主键精确定位，不再经 accountId 反查玩家。
   */
  private async interruptOneSave(
    saveId: string,
    target: ReadonlySet<string>,
    interrupted: Set<string>,
  ): Promise<void> {
    const save = await this.saveService.prisma.save.findUnique({
      where: { id: saveId },
      select: { data: true },
    });
    if (!save) return;
    const data = save.data as unknown as SaveData;

    const current = data.current_action as ActiveActionData | null;
    const queue = this.readQueue(data);
    const currentHit = current !== null && target.has(current.action_id);
    const keptQueue = queue.filter((item) => !target.has(item.action_id));
    const queueHit = keptQueue.length !== queue.length;
    if (!currentHit && !queueHit) return;

    // 记录被中断的动作 id（含队列行），供响应/审计诊断
    if (currentHit && current) interrupted.add(current.action_id);
    for (const item of queue) {
      if (target.has(item.action_id)) interrupted.add(item.action_id);
    }

    // 只清"被停用动作"：队列剩余项原样保留。若清空后无 current 且队列非空，
    // current_action 置 null 即可——既有 settle-due 的"空闲即起跑"会接续队首，
    // 保持"队首 = current_action"这一既有不变量。
    const nextData: SaveData = {
      ...data,
      current_action: currentHit ? null : current,
      action_queue: keptQueue,
    };
    // 条件写入：把"读到的 current_action"写进 WHERE（与 compareAndSwapCurrentAction 同一范式），
    // 若玩家在此期间恰好改过动作，本次 count=0 → 跳过，交由下一轮重载/结算处理，绝不覆盖新状态。
    const result = await this.saveService.prisma.save.updateMany({
      where: {
        id: saveId,
        ...(current === null
          ? { data: { path: ['current_action'], equals: Prisma.JsonNull } }
          : {
              data: {
                path: ['current_action'],
                equals: current as unknown as Prisma.InputJsonValue,
              },
            }),
      },
      data: { data: nextData as unknown as Prisma.InputJsonValue },
    });
    // count=0 = 存档已消失或 current_action 已被并发改动，静默跳过即可（幂等）
    if (result.count === 0) return;
  }

  /* ---------------------------------------------------------------- */
  /* 内部工具                                                          */
  /* ---------------------------------------------------------------- */

  private findActionOrThrow(actionId: string): SkillAction {
    const action = this.contentService
      .getSnapshot()
      .actions.find((a) => a.id === actionId);
    if (!action) throw new NotFoundException(`动作不存在: ${actionId}`);
    return action;
  }

  /** skillId / actionId 必须匹配：动作表是唯一的，客户端传的 skillId 只是"意图确认" */
  private assertActionBelongsToSkill(action: SkillAction, skillId: string) {
    const skill = this.contentService
      .getSnapshot()
      .skills.find((s) => s.id === skillId);
    if (!skill) throw new NotFoundException(`技能不存在: ${skillId}`);
    if (action.skill_id !== skillId) {
      throw new ForbiddenException(`动作 ${action.id} 不属于技能 ${skillId}`);
    }
  }

  private assertLevelEnough(data: SaveData, action: SkillAction) {
    const level = this.skillLevel(data, action.skill_id);
    if (level < action.required_level) {
      throw new ForbiddenException(
        `技能 ${action.skill_id} 等级不足：需要 ${action.required_level} 级，当前 ${level} 级`,
      );
    }
  }

  private assertMaterialsEnough(data: SaveData, action: SkillAction) {
    for (const [itemId, qty] of Object.entries(action.input_items)) {
      if (qty <= 0) continue;
      // 材料只统计堆叠实例，装备不参与制作
      const total = this.stacksOf(data)
        .filter((s) => s.item_id === itemId)
        .reduce((sum, s) => sum + s.quantity, 0);
      if (total < qty) {
        throw new ForbiddenException(`材料不足：${itemId} 需要 ${qty}，当前 ${total}`);
      }
    }
  }

  /**
   * 把引擎算出的 skill_exp 覆写回存档 skills 字段。
   * 存档里的 skills 可能带额外字段（等级缓存/上次结算时间等），
   * 这里只改 exp，其它字段保留——避免结算把前端写入的 UI 偏好吃掉。
   */
  private mergeExpIntoSkills(data: SaveData, skillExp: Record<string, number>): SaveData['skills'] {
    const skills = { ...((data.skills ?? {}) as SkillsMap) };
    for (const [skillId, exp] of Object.entries(skillExp)) {
      // 展开 undefined 不会产生任何 key，等价于 ...(rec ?? {})
      skills[skillId] = { ...skills[skillId], exp };
    }
    return skills;
  }

  /**
   * "期望 current_action = expected 时才允许覆盖成 nextData"的条件写入。
   * 并发争抢时只有一个请求能成功，另一个 count=0 → 409。
   */
  private async compareAndSwapCurrentAction(
    accountId: string,
    expected: ActiveActionData | null,
    nextData: SaveData,
  ) {
    // 用 relation 过滤直接按 accountId 定位存档，省掉"先 ensurePlayer 拿 player.id"的
    // 一次串行往返（远程 DB 下 ~80ms）。调用方在此之前都已走过 read()，
    // player 必然存在，因此不必在此懒创建；不存在时 count=0 同样落到 409。
    const where: Prisma.SaveWhereInput = {
      player: { accountId },
      ...(expected === null
        ? { data: { path: ['current_action'], equals: Prisma.JsonNull } }
        : {
            data: {
              path: ['current_action'],
              equals: expected as unknown as Prisma.InputJsonValue,
            },
          }),
    };
    const result = await this.saveService.prisma.save.updateMany({
      where,
      data: { data: nextData as unknown as Prisma.InputJsonValue },
    });
    if (result.count === 0) {
      // 并发下另一个请求已经改了 current_action，本次操作基于过期状态，拒绝之
      throw new ConflictException('活动状态已变化，请重新拉取后重试');
    }
  }

  /** 动作解析器（不抛错的版本）：队列结算遇到已删内容时剔除该行而不是整单失败 */
  private resolveActionOrUndefined(actionId: string): SkillAction | undefined {
    return this.contentService.getSnapshot().actions.find((a) => a.id === actionId);
  }

  /** 从存档读队列；老存档字段缺失按空队列兜底 */
  private readQueue(data: SaveData): ActionQueueItem[] {
    const raw = data.action_queue;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (item): item is ActionQueueItem =>
          typeof item?.action_id === 'string' &&
          typeof item?.skill_id === 'string' &&
          typeof item?.count === 'number' &&
          item.count > 0,
      )
      .map((item) => ({ action_id: item.action_id, skill_id: item.skill_id, count: item.count }));
  }

  /** 引擎的 ActiveAction → 存档的 ActiveActionData（补 skill_id 冗余） */
  private activeActionDataOf(
    active: { action_id: string; started_at: number } | null,
    data: SaveData,
  ): ActiveActionData | null {
    if (!active) return null;
    const action = this.resolveActionOrUndefined(active.action_id);
    const skillId =
      action?.skill_id ??
      this.readQueue(data).find((q) => q.action_id === active.action_id)?.skill_id ??
      '';
    return { skill_id: skillId, action_id: active.action_id, started_at: active.started_at };
  }

  /** 当前动作的下一个结算时刻；动作不存在（内容被删）时退回 null */
  private nextTickFor(current: ActiveActionData | null, now: number): number | null {
    if (!current) return null;
    const action = this.resolveActionOrUndefined(current.action_id);
    return action ? nextTickAt(current.started_at, action.interval_ms, now) : null;
  }

  /** 当前动作的单次间隔；动作不存在（内容被删）时退回 null */
  private intervalFor(current: ActiveActionData | null): number | null {
    if (!current) return null;
    return this.resolveActionOrUndefined(current.action_id)?.interval_ms ?? null;
  }

  /** 通知结算监听器；失败静默，不阻塞主写路径 */
  private async notifyGained(accountId: string, gained: SettleReport['gained']) {
    for (const listener of this.settlementListeners) {
      try {
        await listener(accountId, gained);
      } catch {
        // 忽略监听器内部错误
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* 队列 CRUD（task-36）                                              */
  /* ---------------------------------------------------------------- */

  /** 查询队列 + 槽位信息（只读） */
  async getQueue(accountId: string) {
    const { data } = await this.saveService.read(accountId);
    return this.queuePayload(data, this.readQueue(data));
  }

  /**
   * 入队。
   *
   * 校验：技能/动作匹配、等级达标、槽位未满。槽位口径为"已占用行数"——
   * 队列每行只放一个动作（不做堆叠），与"10 槽"的 UI 语义一致。
   * 与 start 的互斥：队列为空时入队会自动起跑（见 settleDue 空闲分支），
   * 手动开始则禁止在队列非空时进行（assertQueueNotActive），二者不互相踩踏。
   */
  async enqueue(accountId: string, skillId: string, actionId: string, count: number) {
    const action = this.findActionOrThrow(actionId);
    this.assertActionBelongsToSkill(action, skillId);
    if (!Number.isInteger(count) || count < 1) {
      throw new ForbiddenException('工作次数必须是 ≥1 的整数');
    }

    const { data } = await this.saveService.read(accountId);
    this.assertLevelEnough(data, action);

    const queue = this.readQueue(data);
    if (queue.length >= QUEUE_UNLOCKED_SLOTS) {
      throw new ForbiddenException(
        `队列已满：本体仅开放 ${QUEUE_UNLOCKED_SLOTS} / ${QUEUE_MAX_SLOTS} 槽`,
      );
    }

    const item: ActionQueueItem = { action_id: action.id, skill_id: action.skill_id, count };
    const current = data.current_action as ActiveActionData | null;

    // 队列为空但正在手动跑一个动作：入队即接管。
    // 先把这个手动动作结算掉（不吞已产出的圈），再落队列；否则
    // settleQueue 会因"current 与队首不符"而无法结算它，直接丢收益。
    if (current && queue.length === 0) {
      const running = this.findActionOrThrow(current.action_id);
      const { player } = settle({
        player: this.toPlayerState(data),
        action: running,
        now: Date.now(),
      });
      const inventory = mergeSettledStacks(
        Array.isArray(data.inventory) ? (data.inventory as CarriedItem[]) : [],
        player.inventory as SettledStack[],
      );
      const nextData: SaveData = {
        ...data,
        inventory,
        skills: this.mergeExpIntoSkills(data, player.skill_exp),
        current_action: null,
        action_queue: [item],
      };
      await this.compareAndSwapCurrentAction(accountId, current, nextData);
      return this.queuePayload(nextData, [item]);
    }

    const nextQueue = [...queue, item];
    const nextData: SaveData = { ...data, action_queue: nextQueue };
    await this.compareAndSwapCurrentAction(accountId, current, nextData);
    return this.queuePayload(nextData, nextQueue);
  }

  /** 修改某行：改圈数 / 换工作（换工作时重跑技能匹配与等级校验） */
  async updateQueueItem(
    accountId: string,
    index: number,
    patch: { skillId?: string; actionId?: string; count?: number },
  ) {
    const { data } = await this.saveService.read(accountId);
    const queue = this.readQueue(data);
    this.assertQueueIndex(queue, index);
    const currentItem = queue[index];

    let action = this.findActionOrThrow(patch.actionId ?? currentItem.action_id);
    const skillId = patch.skillId ?? action.skill_id;
    this.assertActionBelongsToSkill(action, skillId);
    this.assertLevelEnough(data, action);

    const count = patch.count ?? currentItem.count;
    if (!Number.isInteger(count) || count < 1) {
      throw new ForbiddenException('工作次数必须是 ≥1 的整数');
    }

    const nextQueue = queue.map((item, i) =>
      i === index
        ? { action_id: action.id, skill_id: action.skill_id, count }
        : item,
    );

    // 不变量：正在跑的动作必须等于队首项。若改的是运行中的队首且换了工作，
    // 先把旧动作结算掉（不吞已产出的圈）再清空 current_action，让新动作从头起跑；
    // 否则 settleQueue 会因"current 与队首不符"把它当成未起跑，重置 started_at 丢收益。
    const current = data.current_action as ActiveActionData | null;
    const headChanged = index === 0 && current && current.action_id !== action.id;
    if (headChanged && current) {
      const running = this.findActionOrThrow(current.action_id);
      const { player } = settle({ player: this.toPlayerState(data), action: running, now: Date.now() });
      const inventory = mergeSettledStacks(
        Array.isArray(data.inventory) ? (data.inventory as CarriedItem[]) : [],
        player.inventory as SettledStack[],
      );
      const nextData: SaveData = {
        ...data,
        inventory,
        skills: this.mergeExpIntoSkills(data, player.skill_exp),
        current_action: null,
        action_queue: nextQueue,
      };
      await this.compareAndSwapCurrentAction(accountId, current, nextData);
      return this.queuePayload(nextData, nextQueue);
    }

    const nextData: SaveData = { ...data, action_queue: nextQueue };
    await this.compareAndSwapCurrentAction(accountId, current, nextData);
    return this.queuePayload(nextData, nextQueue);
  }

  /**
   * 移除某行。
   *
   * 若移除的正是"当前正在跑"的队首，则同时停掉它：
   * 否则 current_action 会指向一个已不在队列里的动作，语义不自洽。
   * 这里对队首做结算（不丢已产出的圈）后再切换到新的队首 / 空闲。
   */
  async removeQueueItem(accountId: string, index: number) {
    const { data } = await this.saveService.read(accountId);
    const queue = this.readQueue(data);
    this.assertQueueIndex(queue, index);

    const removed = queue[index];
    const current = data.current_action as ActiveActionData | null;
    const isRunningHead = index === 0 && current?.action_id === removed.action_id;

    let nextData: SaveData = { ...data, action_queue: queue.filter((_, i) => i !== index) };

    if (isRunningHead && current) {
      const action = this.findActionOrThrow(current.action_id);
      const now = Date.now();
      const { player, report } = settle({
        player: this.toPlayerState(data),
        action,
        now,
      });
      const inventory = mergeSettledStacks(
        Array.isArray(data.inventory) ? (data.inventory as CarriedItem[]) : [],
        player.inventory as SettledStack[],
      );
      const restQueue = queue.filter((_, i) => i !== index);
      // 队首被移除后：队列还有下一项就立刻起跑，否则回到空闲
      const nextHead = restQueue[0];
      const nextCurrent: ActiveActionData | null = nextHead
        ? { skill_id: nextHead.skill_id, action_id: nextHead.action_id, started_at: now }
        : null;
      nextData = {
        ...data,
        inventory,
        skills: this.mergeExpIntoSkills(data, player.skill_exp),
        current_action: nextCurrent,
        action_queue: restQueue,
      };
      await this.compareAndSwapCurrentAction(accountId, current, nextData);
      await this.notifyGained(accountId, report.gained);
    } else {
      await this.compareAndSwapCurrentAction(accountId, current, nextData);
    }

    return this.queuePayload(nextData, this.readQueue(nextData));
  }

  /** 清空队列（测试 / 玩家一次性放弃队列用） */
  async clearQueue(accountId: string) {
    const { data } = await this.saveService.read(accountId);
    const current = data.current_action as ActiveActionData | null;
    // 清空队列时若正在跑队首，需要把它停掉（结算后空闲），否则 current_action 悬空
    const nextData: SaveData = { ...data, action_queue: [], current_action: current };
    if (current) {
      const action = this.findActionOrThrow(current.action_id);
      const { player } = settle({ player: this.toPlayerState(data), action, now: Date.now() });
      nextData.inventory = mergeSettledStacks(
        Array.isArray(data.inventory) ? (data.inventory as CarriedItem[]) : [],
        player.inventory as SettledStack[],
      );
      nextData.skills = this.mergeExpIntoSkills(data, player.skill_exp);
      nextData.current_action = null;
    }
    await this.compareAndSwapCurrentAction(accountId, current, nextData);
    return this.queuePayload(nextData, []);
  }

  private assertQueueIndex(queue: ActionQueueItem[], index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= queue.length) {
      throw new NotFoundException(`队列项不存在: index ${index}`);
    }
  }

  /** 统一队列响应：队列 + 槽位信息（10 槽 / 3 可用） */
  private queuePayload(data: SaveData, queue: ActionQueueItem[]) {
    return {
      action_queue: queue,
      queue_slots: {
        max: QUEUE_MAX_SLOTS,
        unlocked: QUEUE_UNLOCKED_SLOTS,
      },
      current_action: (data.current_action as ActiveActionData | null) ?? null,
    };
  }
}
