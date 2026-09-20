import { IsArray, IsBoolean, IsIn, IsObject, IsOptional } from 'class-validator';

const ROLE_IDS = ['player', 'admin'] as const;
const RESET_TARGETS = ['action', 'combat', 'all'] as const;
const QUALITY_IDS = ['common', 'uncommon', 'rare', 'epic'] as const;

/**
 * 发物品的条目：引用 + 数量。
 *
 * 为什么这里只做 `@IsArray` 而不做 `@ValidateNested`？
 *   全局 ValidationPipe 没有开 transform，嵌套的普通对象不会变成 DTO 实例，
 *   `@ValidateNested` 在 `whitelist` 下行为不稳定；而"物品是否存在 / 数量是否合法"
 *   本来就是跨表业务规则（要看 Registry 快照），class-validator 看不到注册表，
 *   必然要在 service 里重跑。于是把逐条校验统一收敛到 service，错误信息也集中。
 */
export interface GrantItemEntry {
  item_id?: string;
  quantity?: number;
}

/** 发装备的条目：模板 + 品质（品质缺省 common） */
export interface GrantEquipmentEntry {
  template_id?: string;
  quality?: string;
}

/**
 * POST /api/admin/players/:id/grant-items
 *
 * items 与 equipments 至少给一个，两者可同时给（一次请求只做一次容量校验）。
 */
export class GrantItemsDto {
  @IsOptional()
  @IsArray({ message: 'items 必须是数组' })
  items?: GrantItemEntry[];

  @IsOptional()
  @IsArray({ message: 'equipments 必须是数组' })
  equipments?: GrantEquipmentEntry[];
}

/**
 * POST /api/admin/players/:id/grant-resources
 *
 * `resources` 是"抽象资源 id → 增量"的映射：正数为补发，负数为扣减（修正口径）。
 * 具体 id 是否已注册由 service 对照 Registry 快照校验——抽象资源不占背包格。
 */
export class GrantResourcesDto {
  @IsObject({ message: 'resources 必须是对象' })
  resources: Record<string, number>;
}

/** PATCH /api/admin/players/:id/role */
export class UpdateRoleDto {
  @IsIn(ROLE_IDS, { message: 'role 必须是 player/admin 之一' })
  role: 'player' | 'admin';
}

/** PATCH /api/admin/players/:id/ban */
export class UpdateBanDto {
  @IsBoolean({ message: 'banned 必须是布尔值' })
  banned: boolean;
}

/**
 * POST /api/admin/players/:id/reset-state
 *
 * what='action' 同时清 current_action 与 action_queue：只清 current_action 的话，
 * 下一次 settle-due 会立刻把队首重新拉起，"解卡"变成一次无效操作。
 */
export class ResetStateDto {
  @IsIn(RESET_TARGETS, { message: "what 必须是 action/combat/all 之一" })
  what: 'action' | 'combat' | 'all';
}

/** 品质枚举导出：service 校验装备品质时复用同一份集合 */
export const GRANT_QUALITY_IDS = QUALITY_IDS;
