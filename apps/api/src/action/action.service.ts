import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../lib/prisma-client/client.js';
import {
  findActionById,
  levelFromExp,
  settle,
  SKILLS,
  type ItemStack,
  type PlayerState,
  type SkillAction,
  OFFLINE_CAP_MS,
} from '@lazycraft/shared';
import { SaveService } from '../save/save.service.js';
import type { ActiveActionData, SaveData } from '../save/save-shape.js';

/** 背包格子形状：存档 data.inventory 与 idle 引擎 ItemStack 保持一致 */
type Inventory = ItemStack[];

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
@Injectable()
export class ActionService {
  constructor(private readonly saveService: SaveService) {}

  /**
   * 把存档 data 切成 idle 引擎认识的 PlayerState。
   * 存档是 JSONB，字段可能缺失（比如老存档），全部走兜底默认值。
   */
  private toPlayerState(data: SaveData): PlayerState {
    const skills = (data.skills ?? {}) as SkillsMap;
    const skill_exp: Record<string, number> = {};
    for (const [skillId, rec] of Object.entries(skills)) {
      skill_exp[skillId] = typeof rec?.exp === 'number' ? rec.exp : 0;
    }
    const current = data.current_action as ActiveActionData | null;
    return {
      inventory: Array.isArray(data.inventory) ? (data.inventory as Inventory) : [],
      inventory_capacity: 100, // 设计清单：背包 100 格，DLC 可扩展
      skill_exp,
      // 引擎只认 action_id / started_at；skill_id 是存档层的冗余，不传给引擎
      current_action: current
        ? { action_id: current.action_id, started_at: current.started_at }
        : null,
    };
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

    // 把结算后的引擎状态写回存档字段；current_action 置空由引擎保证，这里再显式一次兜底
    const nextData: SaveData = {
      ...data,
      inventory: player.inventory,
      skills: this.mergeExpIntoSkills(data, player.skill_exp),
      current_action: null,
    };
    await this.compareAndSwapCurrentAction(accountId, current, nextData);

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
    const action = findActionById(actionId);
    if (!action) throw new NotFoundException(`动作不存在: ${actionId}`);
    return action;
  }

  /** skillId / actionId 必须匹配：动作表是唯一的，客户端传的 skillId 只是"意图确认" */
  private assertActionBelongsToSkill(action: SkillAction, skillId: string) {
    const skill = SKILLS.find((s) => s.id === skillId);
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
    const inventory = Array.isArray(data.inventory) ? (data.inventory as Inventory) : [];
    for (const [itemId, qty] of Object.entries(action.input_items)) {
      if (qty <= 0) continue;
      const total = inventory
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
