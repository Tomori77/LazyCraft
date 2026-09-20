import { Injectable, NotFoundException } from '@nestjs/common';
import { BUILTIN_PACKS, createRegistry, type ContentPack } from '@lazycraft/shared';
import { PrismaClient } from '../lib/prisma-client/client.js';
import { ContentPackStateService } from '../content/content-pack-state.service.js';
import { ContentService } from '../content/content.service.js';
import { AdminAuditService } from './admin-audit.service.js';

/** 管理视角的 pack 行：含启用状态与"是否需要重启生效"提示 */
export interface AdminPackView {
  id: string;
  name: string;
  version: string;
  /** 持久化的启用状态（本次改动后、重启前，可能尚未在当前进程生效） */
  enabled: boolean;
  /** 当前进程快照里是否真的注册了这个包（重启前的"实际生效值"） */
  active: boolean;
  /** true = 开关值与当前进程生效值不一致，需重启后才能一致 */
  restart_required: boolean;
}

/** 停用影响面：只统计"当前动作/队列仍引用该包动作"的存档数，不列举玩家、不改数据 */
export interface PackImpactView {
  affected_saves: number;
  affected_actions: string[];
  sampled_items: string[];
}

/**
 * 内容包（DLC）管理服务（task-41，方案 (b)）。
 *
 * 已定决策：**只做"启停已编译进来的 pack"**，不做内容入库。
 * 因此本服务不新增/不删除 pack，只翻转 `content_pack_state` 里的一行开关；
 * 改动**重启后生效**（ContentService 的快照在启动时建一次，不做热重载）。
 *
 * 停用警告的深度取舍（回复里也会说明）：
 *   只做**只读的轻量引用统计**——用 DB 侧 JSONB 查询数出"有多少份存档的
 *   current_action / action_queue 仍指向该包的动作"，作为"影响规模"提示；
 *   不逐份展开 inventory/storage 做物品级全量扫描，也**绝不修改任何玩家数据**。
 *   管理员据此判断"现在停用会不会让在挂机的玩家卡住"。
 */
@Injectable()
export class AdminContentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly packState: ContentPackStateService,
    private readonly content: ContentService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 列出全部已编译 pack + 启用状态 + 重启提示 */
  async list(): Promise<AdminPackView[]> {
    const states = await this.packState.states();
    return BUILTIN_PACKS.map((pack) => this.toView(pack, states.get(pack.id) ?? true));
  }

  /**
   * 启用 / 停用指定 pack：落库 + 审计，响应明确"重启后生效"。
   *
   * id 必须是内置清单里的 pack，否则 404——管理接口不该能写进一个
   * 永远不会被注册的虚构 id（那只会污染开关表）。
   * 幂等：状态没变时不重复写库、不落审计（审计只记真实变更）。
   */
  async setEnabled(adminAccountId: string, id: string, enabled: boolean): Promise<AdminPackView> {
    const pack = BUILTIN_PACKS.find((candidate) => candidate.id === id);
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
   * 停用影响面（只读）：某 pack 一旦停用，重启后它的动作/物品将不再注册。
   * 这里数出"仍引用了这些动作的存档数"，供前端在确认停用前提示管理员。
   */
  async impact(id: string): Promise<PackImpactView> {
    const pack = BUILTIN_PACKS.find((candidate) => candidate.id === id);
    if (!pack) throw new NotFoundException(`内容包不存在: ${id}`);

    const actionIds = listPackContent(pack, 'action');
    const itemIds = listPackContent(pack, 'item');
    if (actionIds.length === 0) {
      return { affected_saves: 0, affected_actions: [], sampled_items: itemIds };
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

  /** 组装一行：active 取自当前进程快照的 packs 元信息（注册结果即实际生效值） */
  private toView(pack: ContentPack, enabled: boolean): AdminPackView {
    const active = this.content.getSnapshot().packs.some((info) => info.id === pack.id);
    return {
      id: pack.id,
      name: pack.name,
      version: pack.version,
      enabled,
      active,
      restart_required: enabled !== active,
    };
  }
}

/** 列出某 pack 注册出来的某类别内容 id（靠注册到临时 Registry 反查，不解析源码） */
function listPackContent(pack: ContentPack, kind: 'action' | 'item'): string[] {
  const registry = createRegistry();
  pack.register(registry);
  // action/item 桶的元素都带 id（icon 桶才用 name），按类别收窄联合类型
  return (registry.list(kind) as Array<{ id: string }>).map((content) => content.id);
}
