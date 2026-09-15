import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SaveService } from '../save/save.service.js';
import type { SaveData } from '../save/save-shape.js';
import { DAILY_TEMPLATES, findTaskById, MAIN_QUEST, type TaskDef } from './quest-defs.js';
import type { PlayerQuestRecord, QuestsSaveData } from './quest-types.js';

/** 背包格子形状：与 ActionService 保持一致的读取方式 */
interface ItemStack {
  item_id: string;
  quantity: number;
}

/**
 * 任务（主线 + 日常）服务
 *
 * 服务器权威关键点：
 *   1. accept / progress / claim 都基于"读存档 → 改 data → 条件版本写回"，
 *      利用 SaveService 的 version 乐观锁兜底并发（与 start/stop 的 CAS 同思路，
 *      但任务操作频率低，直接走 POST /api/save 的 409 语义即可）；
 *   2. progress 永远用服务端背包/状态重算，不信客户端报数；
 *   3. claim 发奖与标记完成在同一次 data 覆盖里完成——原子性由"整份覆盖"保证。
 */
@Injectable()
export class QuestService {
  constructor(private readonly saveService: SaveService) {}

  /* ---------------------------------------------------------------- */
  /* 查询                                                              */
  /* ---------------------------------------------------------------- */

  /** 当前账号的全部任务快照：可用列表 = 主线（未完成）+ 主线完成后的日常 */
  async list(accountId: string) {
    const { data } = await this.saveService.read(accountId);
    const records = this.readQuests(data);
    const mainDone = records[MAIN_QUEST.id]?.completed === true;

    const visible: TaskDef[] = mainDone ? [MAIN_QUEST, ...DAILY_TEMPLATES] : [MAIN_QUEST];
    return {
      quests: visible.map((def) => this.toView(def, records[def.id])),
    };
  }

  /* ---------------------------------------------------------------- */
  /* 接受                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 领取任务。
   *
   * baseline 为什么取"领取瞬间背包里目标物总数"？
   *   collect_item 语义是"从领取时点起收集 N 个"，
   *   防止玩家领取前就囤好材料直接秒交。
   */
  async accept(accountId: string, taskId: string) {
    const def = findTaskById(taskId);
    if (!def) throw new NotFoundException(`任务不存在: ${taskId}`);

    const { version, data } = await this.saveService.read(accountId);
    const records = this.readQuests(data);

    // 日常任务有前置：主线没走完不允许接（约束"主线走通后日常列表出现"的验收）
    if (def.requires && records[def.requires]?.completed !== true) {
      throw new ConflictException(`请先完成前置任务: ${def.requires}`);
    }
    const existed = records[taskId];
    if (existed && !existed.completed) {
      throw new ConflictException('任务已领取，无需重复接受');
    }
    if (existed?.completed) {
      // 当前版本 daily 不刷新：完成后不可重复领取
      throw new ConflictException('任务已完成，本周期不可重复领取');
    }

    const baseline = def.goal.type === 'collect_item'
      ? this.countItem(data, def.goal.target)
      : 0;

    const nextRecord: PlayerQuestRecord = {
      accepted_at: Date.now(),
      baseline,
      gained: 0,
      completed: false,
    };
    const nextData: SaveData = {
      ...data,
      quests: { ...records, [taskId]: nextRecord },
    } as SaveData & QuestsSaveData;
    await this.saveService.write(accountId, version, nextData as unknown as Record<string, unknown>);

    return { quest: this.toView(def, nextRecord) };
  }

  /* ---------------------------------------------------------------- */
  /* 进度                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 查询/重算单条任务进度。
   *
   * 为什么 progress 要做成显式端点而不是"list 时顺带算"？
   *   战斗/制作类事件的累计需要"事件发生方主动上报"，
   *   当前阶段由结算钩子调用 recordCraft()；collect_item 则在每次
   *   progress 调用时从背包现算。两条路径都收敛到同一个 view，
   *   让前端只认"progress 接口返回的进度"。
   */
  async progress(accountId: string, taskId: string) {
    const def = findTaskById(taskId);
    if (!def) throw new NotFoundException(`任务不存在: ${taskId}`);

    const { data } = await this.saveService.read(accountId);
    const record = this.readQuests(data)[taskId];
    if (!record) throw new NotFoundException(`尚未领取任务: ${taskId}`);

    return { quest: this.toView(def, record, data) };
  }

  /* ---------------------------------------------------------------- */
  /* 交付                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 交付任务：校验进度达标 → 发奖（写背包）→ 标记完成。
   *
   * 为什么发奖和完成标记必须放在同一次 write？
   *   分两次写会出现"奖已发但任务没标完成"的中间态，
   *   玩家可以利用这个窗口重复领奖。整份覆盖保证二者同时生效。
   */
  async claim(accountId: string, taskId: string) {
    const def = findTaskById(taskId);
    if (!def) throw new NotFoundException(`任务不存在: ${taskId}`);

    const { version, data } = await this.saveService.read(accountId);
    const records = this.readQuests(data);
    const record = records[taskId];
    if (!record) throw new NotFoundException(`尚未领取任务: ${taskId}`);
    if (record.completed) throw new ConflictException('任务已交付，请勿重复领取奖励');

    const progress = this.computeProgress(def, record, data);
    if (progress < def.goal.count) {
      throw new ConflictException(`任务进度不足：${progress}/${def.goal.count}`);
    }

    const nextData: SaveData = {
      ...data,
      inventory: this.addRewardItems(data, def),
      quests: { ...records, [taskId]: { ...record, completed: true } },
    } as SaveData & QuestsSaveData;
    await this.saveService.write(accountId, version, nextData as unknown as Record<string, unknown>);

    return {
      quest: this.toView(def, { ...record, completed: true }),
      reward: def.reward,
    };
  }

  /* ---------------------------------------------------------------- */
  /* 对外：供结算钩子调用（craft_item 类)                              */
  /* ---------------------------------------------------------------- */

  /**
   * 结算一次"产出物品"事件后，把增量累计到进行中的 craft_item 任务上。
   *
   * 由 ActionService.stop 的结算路径调用：结算报告里 gained 的物品
   * 即"本次制作产出"。collect_item 不走这里——它的进度从背包现算。
   *
   * 为什么 fire-and-forget 而不是合并进同一次 write？
   *   stop 的 data 覆盖（CAS）在 ActionService 里完成，如果这里再写一次
   *   会与该次写竞争；把 craft 增量记录进 data.quests[taskId].gained
   *   必须基于 stop 后的最新存档。用一个独立 read-modify-write，
   *   冲突时由 saveService 的 version 校验兜底，失败仅丢一次计数（下次周期再补）。
   */
  async recordGainedFromSettlement(accountId: string, gained: Array<{ item_id: string; amount: number }>) {
    if (gained.length === 0) return;
    const { version, data } = await this.saveService.read(accountId);
    const records = this.readQuests(data);

    let dirty = false;
    const nextRecords = { ...records };
    for (const [taskId, record] of Object.entries(records)) {
      if (record.completed) continue;
      const def = findTaskById(taskId);
      if (!def || def.goal.type !== 'craft_item') continue;
      const delta = gained
        .filter((g) => g.item_id === def.goal.target && g.amount > 0)
        .reduce((sum, g) => sum + g.amount, 0);
      if (delta > 0) {
        nextRecords[taskId] = { ...record, gained: record.gained + delta };
        dirty = true;
      }
    }
    if (!dirty) return;

    const nextData = {
      ...data,
      quests: nextRecords,
    } as SaveData & QuestsSaveData;
    // 失败静默：计数型增量丢一档不会影响玩家完成能力，只慢一拍
    await this.saveService
      .write(accountId, version, nextData as unknown as Record<string, unknown>)
      .catch(() => undefined);
  }

  /* ---------------------------------------------------------------- */
  /* 内部工具                                                          */
  /* ---------------------------------------------------------------- */

  /** 存档 data.quests 字段可能不存在（老存档 / 空存档），一律兜底空表 */
  private readQuests(data: SaveData): Record<string, PlayerQuestRecord> {
    const quests = (data as SaveData & Partial<QuestsSaveData>).quests;
    if (!quests || typeof quests !== 'object') return {};
    return quests as Record<string, PlayerQuestRecord>;
  }

  /** 背包里某物品的总数；背包缺失按 0 */
  private countItem(data: SaveData, itemId: string): number {
    const inventory = Array.isArray(data.inventory) ? (data.inventory as ItemStack[]) : [];
    return inventory
      .filter((s) => s?.item_id === itemId)
      .reduce((sum, s) => sum + (s.quantity ?? 0), 0);
  }

  /** 计算一条任务当前进度：collect_item 现算，craft_item 读 gained 累计 */
  private computeProgress(def: TaskDef, record: PlayerQuestRecord, data: SaveData): number {
    if (def.goal.type === 'collect_item') {
      return Math.max(0, this.countItem(data, def.goal.target) - record.baseline);
    }
    return record.gained;
  }

  /** 把奖励物品合并进背包：已有堆叠 +N；没有则新增一格 */
  private addRewardItems(data: SaveData, def: TaskDef): ItemStack[] {
    const inventory: ItemStack[] = Array.isArray(data.inventory)
      ? (data.inventory as ItemStack[]).map((s) => ({ ...s }))
      : [];
    for (const [itemId, qty] of Object.entries(def.reward.items)) {
      if (qty <= 0) continue;
      const existed = inventory.find((s) => s.item_id === itemId);
      if (existed) {
        existed.quantity += qty;
      } else {
        inventory.push({ item_id: itemId, quantity: qty });
      }
    }
    return inventory;
  }

  /** 视图模型：统一返回给前端的任务快照（含进度） */
  private toView(def: TaskDef, record: PlayerQuestRecord | undefined, data?: SaveData) {
    const progress = record
      ? data
        ? this.computeProgress(def, record, data)
        : def.goal.type === 'collect_item'
          ? 0 // accept 响应里 baseline 已记，客户端还没新数据
          : record.gained
      : 0;
    return {
      id: def.id,
      i18n_key: def.i18nKey,
      goal_type: def.goal.type,
      goal_target: def.goal.target,
      goal_count: def.goal.count,
      reward: def.reward,
      accepted: record !== undefined,
      completed: record?.completed ?? false,
      progress,
    };
  }
}
