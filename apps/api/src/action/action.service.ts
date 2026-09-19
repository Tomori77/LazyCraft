import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../lib/prisma-client/client.js';
import {
  levelFromExp,
  mergeSettledStacks,
  settle,
  type CarriedItem,
  type ItemStack,
  type PlayerState,
  type Quality,
  type SettledStack,
  type SkillAction,
  type SettleReport,
  type StackItemInstance,
  OFFLINE_CAP_MS,
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
      next_tick_at: started_at + action.interval_ms,
    };
  }

  /**
   * 手动停止活动：结算 → 清空 current_action → 返回结算报告。
   *
   * 为什么 stop 也要条件更新？
   *   防止玩家双击 stop：第一次成功结算后 current_action 已清空，
   *   第二次必须 409，否则会基于"已无动作"的状态再返回一份全零报告误导前端。
   */
  async stop(accountId: string) {
    const { data } = await this.saveService.read(accountId);
    const current = data.current_action as ActiveActionData | null;
    if (!current) {
      throw new ConflictException('当前没有进行中的活动');
    }
    const action = this.findActionOrThrow(current.action_id);

    const now = Date.now();
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

    // 通知结算监听器（任务模块据此累计 craft_item 进度）；
    // 失败静默——不阻塞 stop 的主路径，监听器自己负责兜错
    for (const listener of this.settlementListeners) {
      try {
        await listener(accountId, report.gained);
      } catch {
        // 忽略监听器内部错误
      }
    }

    return { report, current_action: null };
  }

  /**
   * 查询当前活动 + 预计下次结算时刻。
   * 空闲时 current 为 null；next_tick_at 封顶在 started_at + 24h（离线硬上限）。
   */
  async current(accountId: string) {
    const { data } = await this.saveService.read(accountId);
    const current = data.current_action as ActiveActionData | null;
    if (!current) {
      return { current_action: null };
    }
    const action = this.findActionOrThrow(current.action_id);
    return {
      current_action: current,
      next_tick_at: Math.min(
        current.started_at + action.interval_ms,
        current.started_at + OFFLINE_CAP_MS,
      ),
      interval_ms: action.interval_ms,
    };
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
    // 不经过 read()：这里只需要 player.id 当锁定位点，读 data 反而多一次 IO
    const player = await this.saveService.ensurePlayer(accountId);
    const where: Prisma.SaveWhereInput = {
      playerId: player.id,
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
}
