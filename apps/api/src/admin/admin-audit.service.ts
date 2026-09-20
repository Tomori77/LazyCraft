import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '../lib/prisma-client/client.js';

/** 审计写入参数：所有管理写操作统一走这一个入口 */
export interface AuditRecordInput {
  /** 操作者账号 id（来自 request.user.id，不接受客户端上报） */
  adminAccountId: string;
  /** 动作标识，约定 `<域>.<动词>`，如 shop_entry.update / player.grant_items */
  action: string;
  /** 目标类型，如 shop_entry / player / content_pack */
  targetType: string;
  /** 目标 id；批量/全局操作可省略 */
  targetId?: string;
  /** 明细快照（异构，如变更前后值） */
  detail?: Record<string, unknown>;
}

/** 审计查询条件 */
export interface AuditQuery {
  page?: number;
  limit?: number;
  targetType?: string;
  targetId?: string;
  action?: string;
}

/** 审计列表的稳定上限：防止一次拉爆整张表（审计是人工查读，不需要全量） */
export const AUDIT_MAX_LIMIT = 100;
export const AUDIT_DEFAULT_LIMIT = 20;

/**
 * 管理审计服务（task-38）。
 *
 * 设计取舍：
 *   1. 失败不阻塞主操作：审计是"事后凭证"而不是业务前置条件，
 *      若因审计写失败就回滚一次改价/发货，等于让日志表可用性绑架整个后台。
 *      因此 record() 只 catch + Logger.warn，不向上抛；但"尽力落库"必须做到——
 *      绝不吞掉写入尝试。
 *   2. 调用方在**主操作成功之后**再 record()：这样日志里的 detail 才是
 *      真正生效的结果，也不会留下"操作回滚了、日志却记了一笔"的假记录。
 *   3. adminAccountId 由 controller 从 request.user 注入，service 不信任客户端参数。
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly prisma: PrismaClient) {}

  /** 记录一条审计；失败仅告警，不影响已完成的业务写操作 */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          adminAccountId: input.adminAccountId,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          // Prisma 的 Json 入参类型要求 InputJsonValue；调用方给的是普通可序列化对象
          detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      this.logger.warn(
        `审计写入失败（主操作已完成）：action=${input.action} target=${input.targetType}:${input.targetId ?? '-'} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** 审计列表（分页 + 按目标/动作过滤），最新在前 */
  async list(query: AuditQuery) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(AUDIT_MAX_LIMIT, Math.max(1, query.limit ?? AUDIT_DEFAULT_LIMIT));

    // 只拼接调用方真的传了的过滤条件；空字符串按"未过滤"处理，避免前端把空输入框当筛选
    const where: Prisma.AdminAuditLogWhereInput = {};
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.action) where.action = query.action;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        admin_account_id: row.adminAccountId,
        action: row.action,
        target_type: row.targetType,
        target_id: row.targetId,
        detail: row.detail,
        created_at: row.createdAt.getTime(),
      })),
      page,
      limit,
      total,
    };
  }
}
