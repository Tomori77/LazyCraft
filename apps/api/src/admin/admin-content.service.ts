import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BUILTIN_PACKS,
  createRegistry,
  type ContentPack,
} from '@lazycraft/shared';
import { PrismaClient } from '../lib/prisma-client/client.js';
import { ContentPackStateService } from '../content/content-pack-state.service.js';
import { ContentPackDirectoryService } from '../content/content-pack-directory.service.js';
import { ContentService } from '../content/content.service.js';
import type { DlcLoadError } from '../content/dlc-loader.service.js';
import { ActionService } from '../action/action.service.js';
import { AdminAuditService } from './admin-audit.service.js';

/** 管理视角的 pack 行：含启用状态与"是否需要应用重载生效"提示 */
export interface AdminPackView {
  id: string;
  name: string;
  version: string;
  /** 是否来自外部 DLC（挂载目录），false = 内置包（前端可据此标注） */
  external: boolean;
  /** 持久化的启用状态（本次改动后、重载前，可能尚未在当前进程生效） */
  enabled: boolean;
  /** 当前进程快照里是否真的注册了这个包（重载前的"实际生效值"） */
  active: boolean;
  /** true = 落盘值与当前进程生效值不一致，点「应用重载」后才会一致 */
  restart_required: boolean;
}

/** 停用影响面：只统计"当前动作/队列仍引用该包动作"的存档数，不列举玩家、不改数据 */
export interface PackImpactView {
  affected_saves: number;
  affected_actions: string[];
  sampled_items: string[];
}

/** 重载结果视图：重载后启用集合 + 校验错误数 + 中断统计 + DLC 加载失败，供前端一次性展示 */
export interface ContentReloadView {
  /** 重载后实际注册进快照的 pack id 集合 */
  enabled_packs: string[];
  /** 重载前实际注册进快照的 pack id 集合（审计口径） */
  previous_packs: string[];
  /** 重载时 `validate()` 的错误数（0 = 内容自洽；>0 也照样重载成功） */
  validate_errors: number;
  /** 重扫挂载目录时加载失败的 DLC 数（task-43：只报告，不影响重载成功） */
  load_errors: number;
  /** 加载失败明细（目录 + 阶段 + 可诊断信息），最多前 20 条 */
  load_error_details: DlcLoadError[];
  /** 被中断（引用已停用动作）的存档数 */
  affected_players: number;
  /** 被中断的动作 id 列表（可诊断） */
  interrupted_actions: string[];
  /** 重载后的 pack 列表（含 enabled/active/restart_required），省前端再拉一次 */
  packs: AdminPackView[];
}

/**
 * 内容包（DLC）管理服务（task-41，方案 (b)）。
 *
 * 已定决策：**只做"启停已编译进来的 pack"**，不做内容入库。
 * 因此本服务不新增/不删除 pack，只翻转 `content_pack_state` 里的一行开关。
 *
 * task-43 起"已编译进来的 pack"扩为运行时可启停集合 = 内置包 + 外部 DLC；
 * 本服务不再直接读 `BUILTIN_PACKS`，一律走 ContentPackDirectoryService，
 * 这样列表/校验/重扫三处看到的可用集合永远一致（外部 DLC 也能被启停）。
 * 安全边界不变：**不提供**上传/在线编辑 DLC 的接口，DLC 文件只能由能写
 * 服务器挂载目录的运维放置；本服务只读取文件系统给出的结果。
 *
 * task-42 起语义变化：开关不再需要重启进程才生效——管理员在管理后台点
 * 「应用重载」会调 `ContentService.reload()` 换掉内存快照（见 reload()）。
 * 快照仍然是"显式重载才换"，不会因为一次 PATCH 就自动刷新：
 * 这样管理员可以先改多个开关，再一次性应用，也避免半途换快照带来的可观测性问题。
 *
 * 停用警告的深度取舍（回复里也会说明）：
 *   只做**只读的轻量引用统计**——用 DB 侧 JSONB 查询数出"有多少份存档的
 *   current_action / action_queue 仍指向该包的动作"，作为"影响规模"提示；
 *   不逐份展开 inventory/storage 做物品级全量扫描。
 */
@Injectable()
export class AdminContentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly packState: ContentPackStateService,
    private readonly directory: ContentPackDirectoryService,
    private readonly content: ContentService,
    // 中断写存档必须走 ActionService 的 CAS 范式，不在本服务里复制一份（见 interruptActionsReferencing）
    private readonly action: ActionService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 列出全部可用 pack（内置 + 外部 DLC）+ 启用状态 + 待应用重载提示 */
  async list(): Promise<AdminPackView[]> {
    // 先重扫目录：外部 DLC 是"放目录即可见"，列表页刷新时让新增包立刻出现
    await this.directory.refresh();
    const states = await this.packState.states();
    return this.availablePacks().map((pack) =>
      this.toView(pack, states.get(pack.id) ?? true),
    );
  }

  /**
   * 加载失败的外部 DLC 列表（task-43，只读）。
   *
   * 先重扫再返回：让管理页"刷新"按钮拿到的是目录此刻的真实状态，
   * 而不是上次重载时缓存的旧错误。扫描本身不抛，坏 DLC 只会变成一条记录。
   */
  async dlcErrors(): Promise<{
    dir: string;
    errors: DlcLoadError[];
  }> {
    await this.directory.refresh();
    return { dir: this.directory.dir(), errors: [...this.directory.errors()] };
  }

  /**
   * 启用 / 停用指定 pack：落库 + 审计。
   *
   * 改动**不自动换快照**：响应里的 restart_required 会告诉前端"落盘值 ≠ 当前生效值，
   * 需点「应用重载」"（重载语义见 reload()）。
   *
   * id 必须是当前可用集合（内置 + 外部 DLC）里的 pack，否则 404——管理接口不该
   * 能写进一个永远不会被注册的虚构 id（那只会污染开关表）。
   * 幂等：状态没变时不重复写库、不落审计（审计只记真实变更）。
   */
  async setEnabled(
    adminAccountId: string,
    id: string,
    enabled: boolean,
  ): Promise<AdminPackView> {
    const pack = this.directory.find(id);
    if (!pack) throw new NotFoundException(`内容包不存在: ${id}`);

    const before = await this.packState.isEnabled(id);
    if (before !== enabled) {
      await this.packState.setEnabled(id, enabled);
      await this.audit.record({
        adminAccountId,
        action: enabled ? 'content_pack.enable' : 'content_pack.disable',
        targetType: 'content_pack',
        targetId: id,
        detail: { before, after: enabled, restart_required: true },
      });
    }

    return this.toView(pack, enabled);
  }

  /**
   * 应用重载（task-42）：按最新落盘启用集合重建内存快照，并中断引用已停用内容的动作。
   *
   * 顺序很重要：
   *   1. 重新读启用集合（以 DB 实时值为准，不信任上一次 list 的缓存）；
   *   2. `ContentService.reload()` 换快照——**先换再中断**：中断后若快照仍是旧的，
   *      settle-due 会按旧内容把被停用动作重新拉起，中断等于白做；
   *   3. 扫"当前所有已停用 pack 的动作"并中断引用它们的存档（幂等全扫，不只算本次新停用，
   *      这样重复重载/历史残留都不会漏）；
   *   4. 落审计（前后启用集合 + validate 错误数 + 影响面）。
   *
   * 为什么 validate 报错也照样成功返回？
   *   可诊断优先：停用 pack 本来就会让引用它的内容变成"未注册"，这是管理员预期内的
   *   结果；此时拒绝重载或抛 500 反而会让管理员失去唯一的恢复入口（改成启用+重载）。
   */
  async reload(adminAccountId: string): Promise<ContentReloadView> {
    // 重载前的生效集合 = 当前进程快照里的 packs（这是"玩家此刻看到的内容"）
    const before = this.content.getSnapshot().packs.map((pack) => pack.id);

    // reload() 内部会**先重扫挂载目录再建快照**：新增/更新的外部 DLC 一步到位
    const { errors, enabledPackIds, loadErrors } = await this.content.reload();

    // 扫描范围：**当前所有已停用 pack** 的动作全集（而非只算本次新停用的）。
    // 为什么？停用状态是持久化的，重载可能被重复调用（改开关不重载、重载失败重试等），
    // 只算 diff 会漏掉上一轮中断残留；全扫天然幂等，代价是一次 pack 注册（纯内存）。
    const actionIds = this.disabledActionIds();

    const { affectedPlayers, interruptedActions } =
      await this.action.interruptActionsReferencing(actionIds);

    const states = await this.packState.states();
    const packs = this.availablePacks().map((pack) =>
      this.toView(pack, states.get(pack.id) ?? true),
    );

    await this.audit.record({
      adminAccountId,
      action: 'content_pack.reload',
      targetType: 'content_pack',
      detail: {
        before_packs: before,
        after_packs: enabledPackIds,
        // 请求启用集合：当前可用 pack 里未被显式停用的 id（外部 DLC 也在内）
        requested_packs: packs
          .filter((pack) => pack.enabled)
          .map((pack) => pack.id),
        validate_errors: errors.length,
        validate_error_samples: errors.slice(0, 10),
        load_errors: loadErrors.length,
        affected_players: affectedPlayers,
        interrupted_actions: interruptedActions,
      },
    });

    return {
      enabled_packs: enabledPackIds,
      previous_packs: before,
      validate_errors: errors.length,
      load_errors: loadErrors.length,
      load_error_details: loadErrors.slice(0, 20),
      affected_players: affectedPlayers,
      interrupted_actions: interruptedActions,
      packs,
    };
  }

  /**
   * 停用影响面（只读）：某 pack 一旦停用，重载后它的动作/物品将不再注册。
   * 这里数出"仍引用了这些动作的存档数"，供前端在确认停用前提示管理员。
   */
  async impact(id: string): Promise<PackImpactView> {
    const pack = this.directory.find(id);
    if (!pack) throw new NotFoundException(`内容包不存在: ${id}`);

    const actionIds = listPackContent(pack, 'action');
    const itemIds = listPackContent(pack, 'item');
    if (actionIds.length === 0) {
      return {
        affected_saves: 0,
        affected_actions: [],
        sampled_items: itemIds,
      };
    }

    // 动作引用只在 current_action / action_queue 两处，用 JSONB 在 DB 侧判定，
    // 不把存档内容拉回 Node（存档可能很大）。参数化数组避免注入。
    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count
         FROM saves
        WHERE (data -> 'current_action' ->> 'action_id') = ANY($1::text[])
           OR EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(COALESCE(data -> 'action_queue', '[]'::jsonb)) AS q
                 WHERE q ->> 'action_id' = ANY($1::text[])
              )`,
      actionIds,
    );

    return {
      affected_saves: rows[0]?.count ?? 0,
      affected_actions: actionIds,
      sampled_items: itemIds,
    };
  }

  /* ---------------------------------------------------------------- */
  /* 内部工具                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * "当前已停用 pack"注册出来的全部动作 id（幂等中断的扫描范围）。
   *
   * 为什么靠临时注册反查而不是读快照？
   *   快照只含已启用内容，停用包的内容不在里面；这里需要"停用包会带来哪些动作 id"，
   *   唯一权威来源就是让 pack 自己 register 一遍（与 impact() 同一手法，不解析源码）。
   */
  private disabledActionIds(): string[] {
    // 已停用 = 当前可用集合里没进当前快照的包（快照只登记实际注册成功的 pack）
    const activeIds = new Set(
      this.content.getSnapshot().packs.map((pack) => pack.id),
    );
    const ids = new Set<string>();
    for (const pack of this.availablePacks()) {
      if (activeIds.has(pack.id)) continue;
      for (const actionId of listPackContent(pack, 'action')) ids.add(actionId);
    }
    return [...ids];
  }

  /** 当前全部可启停 pack（内置 + 外部 DLC），与 ContentService 读同一份目录 */
  private availablePacks(): readonly ContentPack[] {
    return this.directory.availablePacks();
  }

  /** 组装一行：active 取自当前进程快照的 packs 元信息（注册结果即实际生效值） */
  private toView(pack: ContentPack, enabled: boolean): AdminPackView {
    const active = this.content
      .getSnapshot()
      .packs.some((info) => info.id === pack.id);
    return {
      id: pack.id,
      name: pack.name,
      version: pack.version,
      external: !BUILTIN_PACK_IDS.has(pack.id),
      enabled,
      active,
      restart_required: enabled !== active,
    };
  }
}

/** 内置包 id 集合：仅用于给列表行标注"外部 DLC"，不参与可用集合枚举 */
const BUILTIN_PACK_IDS = new Set(BUILTIN_PACKS.map((pack) => pack.id));

/** 列出某 pack 注册出来的某类别内容 id（靠注册到临时 Registry 反查，不解析源码） */
function listPackContent(pack: ContentPack, kind: 'action' | 'item'): string[] {
  const registry = createRegistry();
  pack.register(registry);
  // action/item 桶的元素都带 id（icon 桶才用 name），按类别收窄联合类型
  return (registry.list(kind) as Array<{ id: string }>).map(
    (content) => content.id,
  );
}
