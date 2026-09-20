import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient, type ShopEntryRow } from '../lib/prisma-client/client.js';
import { EQUIPMENT_TEMPLATES } from '@lazycraft/shared';
import { ContentService } from '../content/content.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import type { CreateShopEntryDto, UpdateShopEntryDto } from './dto/admin-shop.dto.js';

/** 管理视角的条目视图：含 listed / sort_order / 时间戳（与 C 端裸数组形状区分） */
function toAdminView(row: ShopEntryRow) {
  return {
    id: row.id,
    kind: row.kind,
    item_id: row.itemId,
    template_id: row.templateId,
    quality: row.quality,
    buy_price: row.buyPrice,
    sell_price: row.sellPrice,
    required_level: row.requiredLevel,
    stock: row.stock,
    listed: row.listed,
    sort_order: row.sortOrder,
    created_at: row.createdAt.getTime(),
    updated_at: row.updatedAt.getTime(),
  };
}

/**
 * 商店管理服务（task-24b）
 *
 * 服务器权威：条目引用的物品/模板必须在"引擎认识的内容"里——物品以 Registry
 * 快照为准（避免 ITEMS 常量表与 CorePack 注册结果分叉），模板以 EQUIPMENT_TEMPLATES 为准。
 * 引用不存在时拒绝写入，否则商店会卖出发货阶段才崩的物品。
 */
@Injectable()
export class AdminShopService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly content: ContentService,
    private readonly audit: AdminAuditService,
  ) {}

  /** 列出全部条目（含未上架），管理页需要看到完整价目表 */
  async list() {
    const rows = await this.prisma.shopEntryRow.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toAdminView);
  }

  /** 新增条目：校验 kind 与引用有效性、id 唯一；成功后写审计 */
  async create(adminAccountId: string, dto: CreateShopEntryDto) {
    const { itemId, templateId, quality } = this.resolveRefs(dto.kind, dto);

    let row: ShopEntryRow;
    try {
      row = await this.prisma.shopEntryRow.create({
        data: {
          id: dto.id,
          kind: dto.kind,
          itemId,
          templateId,
          quality,
          buyPrice: dto.buy_price,
          sellPrice: dto.sell_price ?? null,
          requiredLevel: dto.required_level ?? null,
          stock: dto.stock ?? -1,
          listed: dto.listed ?? true,
          sortOrder: dto.sort_order ?? 0,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`商店条目 id 已存在: ${dto.id}`);
      }
      throw error;
    }

    // 审计在主操作成功之后写：记录的是真正落库的条目，失败不阻塞响应
    await this.audit.record({
      adminAccountId,
      action: 'shop_entry.create',
      targetType: 'shop_entry',
      targetId: row.id,
      detail: { created: toAdminView(row) },
    });
    return toAdminView(row);
  }

  /** 修改条目：kind 不可改；传入的引用字段重新做有效性校验；成功后写审计 */
  async update(adminAccountId: string, id: string, dto: UpdateShopEntryDto) {
    const existing = await this.prisma.shopEntryRow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`商店条目不存在: ${id}`);

    const data: Prisma.ShopEntryRowUpdateInput = {};

    if (dto.buy_price !== undefined) data.buyPrice = dto.buy_price;
    if (dto.stock !== undefined) data.stock = dto.stock;
    if (dto.listed !== undefined) data.listed = dto.listed;
    if (dto.sort_order !== undefined) data.sortOrder = dto.sort_order;
    if (dto.sell_price !== undefined) data.sellPrice = dto.sell_price;
    if (dto.required_level !== undefined) data.requiredLevel = dto.required_level;

    if (dto.item_id !== undefined || dto.template_id !== undefined || dto.quality !== undefined) {
      const kind = existing.kind as 'item' | 'equipment';
      const merged = {
        kind,
        item_id: dto.item_id ?? existing.itemId ?? undefined,
        template_id: dto.template_id ?? existing.templateId ?? undefined,
        quality: dto.quality !== undefined ? dto.quality : existing.quality ?? undefined,
      };
      const refs = this.resolveRefs(kind, merged);
      data.itemId = refs.itemId;
      data.templateId = refs.templateId;
      if (dto.quality !== undefined) data.quality = refs.quality;
    }

    const row = await this.prisma.shopEntryRow.update({ where: { id }, data });
    // 审计记"改前 → 改后"：只留变更字段就够复盘，但整行快照更省事且无歧义
    await this.audit.record({
      adminAccountId,
      action: 'shop_entry.update',
      targetType: 'shop_entry',
      targetId: id,
      detail: { before: toAdminView(existing), after: toAdminView(row), patch: dto },
    });
    return toAdminView(row);
  }

  /** 删除条目；不存在转 404；成功后写审计 */
  async remove(adminAccountId: string, id: string) {
    const existing = await this.prisma.shopEntryRow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`商店条目不存在: ${id}`);
    await this.prisma.shopEntryRow.delete({ where: { id } });
    await this.audit.record({
      adminAccountId,
      action: 'shop_entry.delete',
      targetType: 'shop_entry',
      targetId: id,
      detail: { deleted: toAdminView(existing) },
    });
    return { id, deleted: true };
  }

  /* ---------------------------------------------------------------- */
  /* 内部工具                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * 归一化并校验引用字段。
   *
   * kind='item' 必须有合法 item_id（且 template_id 置空）；
   * kind='equipment' 必须有合法 template_id（且 item_id 置空）；
   * quality 缺省 null = 出货默认品质 common。
   */
  private resolveRefs(
    kind: 'item' | 'equipment',
    ref: { item_id?: string; template_id?: string; quality?: string | null },
  ): { itemId: string | null; templateId: string | null; quality: string | null } {
    const quality = ref.quality ?? null;

    if (kind === 'item') {
      if (!ref.item_id) {
        throw new BadRequestException('kind=item 时必须提供 item_id');
      }
      if (!this.knownItemIds().has(ref.item_id)) {
        throw new BadRequestException(`item_id 未注册: ${ref.item_id}`);
      }
      return { itemId: ref.item_id, templateId: null, quality };
    }

    if (!ref.template_id) {
      throw new BadRequestException('kind=equipment 时必须提供 template_id');
    }
    if (!EQUIPMENT_TEMPLATES[ref.template_id]) {
      throw new BadRequestException(`template_id 未注册: ${ref.template_id}`);
    }
    return { itemId: null, templateId: ref.template_id, quality };
  }

  /** 引擎认识的物品全集：以 Registry 快照为准（与 /api/content 同源） */
  private knownItemIds(): Set<string> {
    return new Set(this.content.getSnapshot().itemCatalog.map((item) => item.id));
  }
}
