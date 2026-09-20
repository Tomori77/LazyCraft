import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
// 普通 import PrismaClient：Nest 的构造参数注入靠运行时元数据，
// 用 `import type` 会在 emit 后把 token 抹掉，导致 DI 找不到 PrismaClient。
import { Prisma, PrismaClient } from '../lib/prisma-client/client.js';
import {
  DEFAULT_STACK_MAX,
  EQUIPMENT_TEMPLATES,
  ITEMS,
  addToContainer,
  calculatePersonLevel,
  canAddToContainer,
  generateEquipment,
  newUid,
  toEquipmentInstance,
  type CarriedItem,
  type ContainerAdd,
  type Quality,
} from '@lazycraft/shared';
import { ContentService } from '../content/content.service.js';
import { invalidateAccountCache } from '../auth/jwt.strategy.js';
import { migrateSave } from '../save/migrations/index.js';
import {
  CURRENT_SAVE_VERSION,
  DEFAULT_INVENTORY_CAPACITY,
  DEFAULT_STORAGE_CAPACITY,
  createEmptySaveData,
  type SaveDataV3,
  type SaveDataV4,
} from '../save/save-shape.js';
import { buildPlayerAttributes, buildPlayerData, buildSkillLevels } from '../player/player-shape.js';
import { AdminAuditService } from './admin-audit.service.js';
import {
  GRANT_QUALITY_IDS,
  type GrantItemsDto,
  type GrantResourcesDto,
  type ResetStateDto,
} from './dto/admin-player.dto.js';

/** 列表上限：管理页按页浏览，一次最多 100 行，避免被 query 参数拉爆 */
const PLAYER_MAX_LIMIT = 100;
const PLAYER_DEFAULT_LIMIT = 20;

/** 物品 stack_max 解析器：与 inventory/shop 同一口径（未登记按缺省上限） */
function stackMaxOf(itemId: string): number {
  return ITEMS.find((i) => i.id === itemId)?.stack_max ?? DEFAULT_STACK_MAX;
}

function containerOf(data: SaveDataV3, container: 'inventory' | 'storage'): CarriedItem[] {
  const raw = (data as Partial<SaveDataV3>)[container];
  return Array.isArray(raw) ? raw : [];
}

/** 容器容量：字段缺失按默认值兜底，与 inventory.service 同口径 */
function capacityOf(data: SaveDataV3, container: 'inventory' | 'storage'): number {
  const value =
    container === 'inventory'
      ? (data as Partial<SaveDataV3>).inventory_capacity
      : (data as Partial<SaveDataV3>).storage_capacity;
  if (typeof value === 'number') return value;
  return container === 'inventory' ? DEFAULT_INVENTORY_CAPACITY : DEFAULT_STORAGE_CAPACITY;
}

/** 抽象资源读成"数字映射"：非对象/非有限数一律丢弃，脏存档不污染展示 */
function asResourceMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = Math.floor(raw);
  }
  return out;
}

/** 列表页行（原生 SQL 取回；JSONB 切片已由 pg 解析成对象） */
interface PlayerListRow {
  player_id: string;
  player_name: string;
  account_id: string;
  email: string;
  role: string;
  banned: boolean;
  created_at: Date;
  skills: unknown;
  equipment: unknown;
  abstract_resources: unknown;
  inventory_capacity: number | null;
  storage_capacity: number | null;
  inventory_used: number;
  storage_used: number;
}

/** 列表摘要：只给"一眼能判断账号状态"的量，不含任何大字段 */
export interface PlayerSummary {
  level: number;
  abstract_resources: Record<string, number>;
  inventory_used: number;
  inventory_capacity: number;
  storage_used: number;
  storage_capacity: number;
}

/**
 * 玩家管理服务（task-40）。
 *
 * 服务器权威铁律：修改玩家数据一律走"专用发放接口"——服务端校验物品/模板是否存在、
 * 背包容量是否够、抽象资源 id 是否已注册，再以 CAS/事务整份覆写存档；
 * **绝不接受调用方直接提交存档 JSONB**。每个写操作成功后落一条审计。
 *
 * 读路径性能取舍（列表）：
 *   列表**不**把整份 `saves.data` 拉回来——只取 4 个 JSONB 切片
 *   （skills / equipment / abstract_resources 及三处长度/容量），
 *   inventory/storage 的"已用格数"用 `jsonb_array_length` 在数据库里算，
 *   物品明细（可能上百格）连传都不传。skills/equipment 本身很小（技能个位数、
 *   装备最多 10 槽），拉回来是为了让"等级"走与 `/api/player` 完全相同的
 *   buildSkillLevels + calculatePersonLevel + buildPlayerAttributes，不另立口径。
 */
@Injectable()
export class AdminPlayerService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly content: ContentService,
    private readonly audit: AdminAuditService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* 列表 / 详情                                                       */
  /* ---------------------------------------------------------------- */

  /** 分页 + 按玩家名/邮箱模糊搜索；返回摘要视图 */
  async list(query: { query?: string; page?: number; limit?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(PLAYER_MAX_LIMIT, Math.max(1, query.limit ?? PLAYER_DEFAULT_LIMIT));
    const keyword = (query.query ?? '').trim();
    // 空关键词 = 不过滤；有词时走 ILIKE '%词%'（大小写不敏感，中文同样适用）
    const pattern = keyword ? `%${keyword}%` : null;

    const filter = pattern
      ? Prisma.sql`WHERE p.name ILIKE ${pattern} OR a.email ILIKE ${pattern}`
      : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<PlayerListRow[]>`
      SELECT p.id AS player_id, p.name AS player_name, p.created_at AS created_at,
             a.id AS account_id, a.email AS email, a.role AS role, a.banned AS banned,
             s.data -> 'skills' AS skills,
             s.data -> 'equipment' AS equipment,
             s.data -> 'abstract_resources' AS abstract_resources,
             (s.data -> 'inventory_capacity')::int AS inventory_capacity,
             (s.data -> 'storage_capacity')::int AS storage_capacity,
             COALESCE(jsonb_array_length(s.data -> 'inventory'), 0) AS inventory_used,
             COALESCE(jsonb_array_length(s.data -> 'storage'), 0) AS storage_used
      FROM players p
      JOIN accounts a ON a.id = p.account_id
      LEFT JOIN saves s ON s.player_id = p.id
      ${filter}
      ORDER BY p.created_at ASC, p.id ASC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`;

    const counted = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total
      FROM players p
      JOIN accounts a ON a.id = p.account_id
      ${filter}`;

    return {
      items: rows.map((row: PlayerListRow) => ({
        id: row.player_id,
        account_id: row.account_id,
        name: row.player_name,
        email: row.email,
        role: row.role,
        banned: row.banned,
        created_at: row.created_at.getTime(),
        summary: this.summarize(row),
      })),
      page,
      limit,
      total: counted[0]?.total ?? 0,
    };
  }

  /**
   * 详情：账号 + 角色 + 存档只读快照。
   *
   * 快照直接复用 `buildPlayerData`——它与 `/api/player` 是同一份聚合规则
   * （技能等级、属性、槽位补全、容量口径），不在这里另写一份"管理视角的结构"，
   * 否则管理页看到的等级/属性会与玩家自己看到的漂移。
   */
  async detail(playerId: string) {
    const target = await this.findTargetOrThrow(playerId);
    const data = await this.loadSaveData(target.id);
    const snapshot = buildPlayerData(
      target.name,
      this.content.getSnapshot(),
      data,
      target.account.role,
    );
    return {
      id: target.id,
      account_id: target.account.id,
      name: target.name,
      email: target.account.email,
      role: target.account.role,
      banned: target.account.banned,
      created_at: target.createdAt.getTime(),
      snapshot,
    };
  }

  /* ---------------------------------------------------------------- */
  /* 角色 / 封禁                                                       */
  /* ---------------------------------------------------------------- */

  /** 改角色（player/admin）：写库 + 主动失效鉴权缓存，让角色立即生效 */
  async updateRole(adminAccountId: string, playerId: string, role: 'player' | 'admin') {
    const target = await this.findTargetOrThrow(playerId);
    if (target.account.id === adminAccountId && role === 'player') {
      // 自降级会把自己锁在后台外（且无人能再改回来），直接拒绝并说明
      throw new ForbiddenException('不能取消自己的管理员角色');
    }
    const before = target.account.role;
    if (before === role) {
      // 幂等：状态没变就不写库、不落审计（审计只记真实变更）
      return { id: playerId, email: target.account.email, role, changed: false };
    }
    await this.prisma.account.update({ where: { id: target.account.id }, data: { role } });
    // 角色是"每次请求回库读最新值"的（见 jwt.strategy），这里让缓存立刻过期
    invalidateAccountCache(target.account.id);

    await this.audit.record({
      adminAccountId,
      action: 'player.role_update',
      targetType: 'player',
      targetId: playerId,
      detail: { account_id: target.account.id, email: target.account.email, before, after: role },
    });
    return { id: playerId, email: target.account.email, role, changed: true };
  }

  /**
   * 封禁 / 解封。
   *
   * 拦截点（两处，缺一不可）：
   *   1. `AuthService.login`：被封账号登录直接 401 —— 挡"重新登录"；
   *   2. `JwtStrategy.validate`：每次带 token 的请求都复核 banned —— 挡"已签发的旧 token"。
   *      （配合 invalidateAccountCache 立即生效，不等 5s TTL。）
   * 放在 accounts 表是因为这两处都只有 accountId。
   */
  async updateBan(adminAccountId: string, playerId: string, banned: boolean) {
    const target = await this.findTargetOrThrow(playerId);
    if (target.account.id === adminAccountId && banned) {
      // 封自己会当场失去后台访问权，属明显误操作，拒绝
      throw new ForbiddenException('不能封禁自己');
    }
    const before = target.account.banned;
    if (before === banned) {
      return { id: playerId, email: target.account.email, banned, changed: false };
    }
    await this.prisma.account.update({
      where: { id: target.account.id },
      data: { banned },
    });
    invalidateAccountCache(target.account.id);

    await this.audit.record({
      adminAccountId,
      action: banned ? 'player.ban' : 'player.unban',
      targetType: 'player',
      targetId: playerId,
      detail: { account_id: target.account.id, email: target.account.email, before, after: banned },
    });
    return { id: playerId, email: target.account.email, banned, changed: true };
  }

  /* ---------------------------------------------------------------- */
  /* 专用发放 / 修正（全部服务器校验 + 审计）                            */
  /* ---------------------------------------------------------------- */

  /**
   * 发放物品 / 装备。
   *
   * 校验清单：
   *   - items：item_id 必须在 Registry 快照里、quantity 为 ≥1 的整数；
   *   - equipments：template_id 必须在 EQUIPMENT_TEMPLATES 里、quality（若给）合法
   *     且落在模板允许区间内（generateEquipment 的 null 出口 = 区间不符）；
   *   - items 与 equipments 至少一个非空；
   *   - 合计后必须能放进**背包**（canAddToContainer，按格数而非数量），否则 403。
   * 装备走白板生成（affix_pool_ids 为空），与商店出货同策略：管理发放不该开词缀抽奖。
   */
  async grantItems(adminAccountId: string, playerId: string, dto: GrantItemsDto) {
    const target = await this.findTargetOrThrow(playerId);
    const additions = this.buildGrantAdditions(dto);
    await this.ensureSaveRow(target.id);

    const prisma = this.prisma;
    return prisma.$transaction(async (tx) => {
      const save = await this.lockSaveForPlayer(tx, target.id);
      const data = save.data as unknown as SaveDataV3;
      const inventory = containerOf(data, 'inventory');

      if (!canAddToContainer(inventory, additions, capacityOf(data, 'inventory'), stackMaxOf)) {
        throw new ForbiddenException('背包容量不足，无法发放');
      }

      const next: SaveDataV3 = {
        ...data,
        inventory: addToContainer(inventory, additions, undefined, stackMaxOf),
      };
      await tx.save.update({
        where: { id: save.id },
        data: { data: next as unknown as Prisma.InputJsonValue },
      });

      const granted = this.describeAdditions(additions);
      await this.audit.record({
        adminAccountId,
        action: 'player.grant_items',
        targetType: 'player',
        targetId: playerId,
        detail: { account_id: target.account.id, granted },
      });
      return {
        id: playerId,
        granted,
        carry: {
          inventory_used: next.inventory.length,
          inventory_capacity: capacityOf(next, 'inventory'),
        },
      };
    });
  }

  /**
   * 补 / 修正抽象资源。
   *
   * 校验清单：每个 key 必须是已注册的抽象资源 id（Registry 快照），
   * 每个值必须是有限整数；增量后不得为负（宁可明确拒绝，也不静默 clamp）。
   * 抽象资源**不占背包格**，故不做容量校验（总纲铁律 4）。
   */
  async grantResources(adminAccountId: string, playerId: string, dto: GrantResourcesDto) {
    const target = await this.findTargetOrThrow(playerId);
    const entries = this.validateResourceGrant(dto.resources);
    await this.ensureSaveRow(target.id);

    const prisma = this.prisma;
    return prisma.$transaction(async (tx) => {
      const save = await this.lockSaveForPlayer(tx, target.id);
      const data = save.data as unknown as SaveDataV3;
      const before = asResourceMap(data.abstract_resources);
      const after: Record<string, number> = { ...before };
      for (const [id, delta] of entries) {
        const current = before[id] ?? 0;
        const next = current + delta;
        if (next < 0) {
          throw new BadRequestException(`资源 ${id} 修正后为负：当前 ${current}，请求增量 ${delta}`);
        }
        after[id] = next;
      }

      const nextData: SaveDataV3 = { ...data, abstract_resources: after };
      await tx.save.update({
        where: { id: save.id },
        data: { data: nextData as unknown as Prisma.InputJsonValue },
      });

      const changes = entries.map(([id, delta]) => ({
        id,
        delta,
        before: before[id] ?? 0,
        after: after[id],
      }));
      await this.audit.record({
        adminAccountId,
        action: 'player.grant_resources',
        targetType: 'player',
        targetId: playerId,
        detail: { account_id: target.account.id, changes },
      });
      return { id: playerId, changes, resources: after };
    });
  }

  /**
   * 重置卡死状态：清当前动作 / 战斗。
   *
   * what='action' 同时清 `action_queue`：只清 current_action 的话，下次 settle-due
   * 会把队首重新拉起，"解卡"变无效。清状态是幂等的——没卡也会成功，但会落审计。
   */
  async resetState(adminAccountId: string, playerId: string, dto: ResetStateDto) {
    const target = await this.findTargetOrThrow(playerId);
    await this.ensureSaveRow(target.id);

    const prisma = this.prisma;
    return prisma.$transaction(async (tx) => {
      const save = await this.lockSaveForPlayer(tx, target.id);
      const data = save.data as unknown as SaveDataV3 & {
        current_combat?: unknown;
        action_queue?: unknown;
      };

      const cleared = {
        current_action: this.hasAction(data),
        action_queue: this.queueLength(data) > 0,
        current_combat: data.current_combat != null,
      };

      const nextData: Record<string, unknown> = { ...data };
      if (dto.what === 'action' || dto.what === 'all') {
        nextData.current_action = null;
        nextData.action_queue = [];
      }
      if (dto.what === 'combat' || dto.what === 'all') {
        nextData.current_combat = null;
      }

      await tx.save.update({
        where: { id: save.id },
        data: { data: nextData as Prisma.InputJsonValue },
      });

      await this.audit.record({
        adminAccountId,
        action: 'player.reset_state',
        targetType: 'player',
        targetId: playerId,
        detail: { account_id: target.account.id, what: dto.what, cleared },
      });
      return { id: playerId, what: dto.what, cleared };
    });
  }

  /* ---------------------------------------------------------------- */
  /* 内部工具                                                          */
  /* ---------------------------------------------------------------- */

  /** 按 player.id 定位角色 + 账号；不存在转 404 */
  private async findTargetOrThrow(playerId: string) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { account: true },
    });
    if (!player) throw new NotFoundException(`玩家不存在: ${playerId}`);
    return player;
  }

  /**
   * 取目标存档的行锁并读回最新内容（管理视角，按 playerId 精确定位）。
   *
   * 为什么不用共享的 lockSaveForAccount？
   *   它按 accountId 找该账号**最早**的角色——那是"当前登录账号"的口径。
   *   管理接口拿到的是明确的 playerId，必须锁它自己的那一行，否则多角色账号下
   *   会"看着 A 的详情、改到 B 的存档"。语义与 save-tx 一致：不改变内容的 UPDATE
   *   取行锁并把"定位 + 锁定 + 读回"合并成一条语句。
   */
  private async lockSaveForPlayer(
    tx: Prisma.TransactionClient,
    playerId: string,
  ): Promise<{ id: string; data: unknown }> {
    const rows = await tx.$queryRaw<Array<{ id: string; data: unknown }>>`
      UPDATE saves SET version = version
      WHERE player_id = ${playerId}
      RETURNING id, data`;
    const row = rows[0];
    if (!row) throw new NotFoundException('存档不存在，请先让该玩家进入一次游戏');
    return row;
  }

  /**
   * 读某个角色的存档（管理视角，按 playerId 而非 accountId）。
   *
   * 为什么不复用 SaveService.read()？它按 accountId 定位，而管理接口拿到的是
   * playerId，且管理读路径不需要懒创建玩家。迁移语义必须一致——所以这里复用
   * 同一份 migrateSave 并在迁移后回写，保证管理页看到的等级/结构与玩家一致。
   */
  private async loadSaveData(playerId: string): Promise<SaveDataV4> {
    const row = await this.prisma.save.findUnique({ where: { playerId } });
    if (!row) return createEmptySaveData();
    if (row.version > CURRENT_SAVE_VERSION) {
      throw new InternalServerErrorException(
        `存档版本 v${row.version} 超过服务端支持的 v${CURRENT_SAVE_VERSION}`,
      );
    }
    if (row.version < CURRENT_SAVE_VERSION) {
      const migrated = migrateSave(row.version, row.data as unknown as SaveDataV3);
      await this.prisma.save.update({
        where: { playerId },
        data: {
          version: CURRENT_SAVE_VERSION,
          data: migrated as unknown as Prisma.InputJsonValue,
        },
      });
      return migrated as SaveDataV4;
    }
    return row.data as unknown as SaveDataV4;
  }

  /** 写路径兜底：目标角色还没存档时先建一份空档（否则行锁定位会扑空） */
  private async ensureSaveRow(playerId: string): Promise<void> {
    const exists = await this.prisma.save.findUnique({
      where: { playerId },
      select: { id: true },
    });
    if (exists) return;
    await this.prisma.save.create({
      data: {
        playerId,
        version: CURRENT_SAVE_VERSION,
        data: createEmptySaveData() as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** 把列表行的 JSONB 切片聚合成摘要；等级/属性与 /api/player 同一套纯函数 */
  private summarize(row: PlayerListRow): PlayerSummary {
    const snapshot = this.content.getSnapshot();
    const skillIds = snapshot.skills.map((skill) => skill.id);
    const skills = buildSkillLevels(skillIds, row.skills);
    const skillLevelMap: Record<string, number> = {};
    for (const [id, progress] of Object.entries(skills)) skillLevelMap[id] = progress.level;
    const attributes = buildPlayerAttributes(row.skills, row.equipment);

    return {
      level: calculatePersonLevel(skillLevelMap, attributes),
      abstract_resources: asResourceMap(row.abstract_resources),
      inventory_used: row.inventory_used,
      inventory_capacity: row.inventory_capacity ?? DEFAULT_INVENTORY_CAPACITY,
      storage_used: row.storage_used,
      storage_capacity: row.storage_capacity ?? DEFAULT_STORAGE_CAPACITY,
    };
  }

  /**
   * 校验并构造"加入物"列表。
   *
   * 容量只认 ContainerAdd（堆叠增量 / 装备实例），uid 由 addToContainer 落盘时分配；
   * 装备实例已经带 uid（走 toEquipmentInstance），故混装无碍。
   */
  private buildGrantAdditions(dto: GrantItemsDto): ContainerAdd[] {
    const items = dto.items ?? [];
    const equipments = dto.equipments ?? [];
    if (!Array.isArray(items) || !Array.isArray(equipments)) {
      throw new BadRequestException('items/equipments 必须是数组');
    }
    if (items.length === 0 && equipments.length === 0) {
      throw new BadRequestException('items 与 equipments 至少提供一个');
    }

    const knownItems = this.knownItemIds();
    const additions: ContainerAdd[] = [];

    for (const entry of items) {
      const itemId = typeof entry?.item_id === 'string' ? entry.item_id.trim() : '';
      if (!itemId) throw new BadRequestException('items[].item_id 不能为空');
      if (!knownItems.has(itemId)) {
        throw new BadRequestException(`item_id 未注册: ${itemId}`);
      }
      const quantity = entry?.quantity;
      if (!Number.isInteger(quantity) || (quantity as number) < 1) {
        throw new BadRequestException(`物品 ${itemId} 的数量必须是 ≥1 的整数`);
      }
      additions.push({ item_id: itemId, quantity: quantity as number });
    }

    for (const entry of equipments) {
      const templateId = typeof entry?.template_id === 'string' ? entry.template_id.trim() : '';
      if (!templateId) throw new BadRequestException('equipments[].template_id 不能为空');
      if (!EQUIPMENT_TEMPLATES[templateId]) {
        throw new BadRequestException(`template_id 未注册: ${templateId}`);
      }
      const quality = (entry?.quality ?? 'common') as Quality;
      if (!(GRANT_QUALITY_IDS as readonly string[]).includes(quality)) {
        throw new BadRequestException(`品质非法: ${String(entry?.quality)}`);
      }
      const generated = generateEquipment({
        template_id: templateId,
        quality,
        // 管理发放走白板：不给随机词缀，避免用后台当"词缀抽奖机"
        affix_pool_ids: [],
        rng: Math.random,
      });
      if (!generated) {
        throw new BadRequestException(
          `模板 ${templateId} 不支持品质 ${quality}（或模板配置错误）`,
        );
      }
      const instance = toEquipmentInstance(generated, newUid());
      if (!instance) {
        throw new BadRequestException(`模板不存在: ${templateId}`);
      }
      additions.push(instance);
    }

    return additions;
  }

  /** 校验资源增量：id 已注册 + 值为有限整数 + 至少一项 */
  private validateResourceGrant(resources: Record<string, number>): Array<[string, number]> {
    if (!resources || typeof resources !== 'object' || Array.isArray(resources)) {
      throw new BadRequestException('resources 必须是对象');
    }
    const entries = Object.entries(resources);
    if (entries.length === 0) {
      throw new BadRequestException('resources 不能为空');
    }
    const known = new Set(
      this.content.getSnapshot().abstractResources.map((resource) => resource.id),
    );
    for (const [id, value] of entries) {
      if (!known.has(id)) {
        throw new BadRequestException(`抽象资源未注册: ${id}`);
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new BadRequestException(`资源 ${id} 的增量必须是整数`);
      }
    }
    return entries as Array<[string, number]>;
  }

  /** 加入物的可审计描述（uid 由落盘分配，审计不必记） */
  private describeAdditions(additions: ContainerAdd[]) {
    return additions.map((add) =>
      'kind' in add && add.kind === 'equipment'
        ? { kind: 'equipment' as const, template_id: add.template_id, quality: add.quality }
        : {
            kind: 'item' as const,
            item_id: (add as { item_id: string }).item_id,
            quantity: (add as { quantity: number }).quantity,
          },
    );
  }

  /** 引擎认识的物品全集：以 Registry 快照为准（与 /api/content、商店管理同源） */
  private knownItemIds(): Set<string> {
    return new Set(this.content.getSnapshot().itemCatalog.map((item) => item.id));
  }

  private hasAction(data: { current_action?: unknown }): boolean {
    return data.current_action != null;
  }

  private queueLength(data: { action_queue?: unknown }): number {
    return Array.isArray(data.action_queue) ? data.action_queue.length : 0;
  }
}
