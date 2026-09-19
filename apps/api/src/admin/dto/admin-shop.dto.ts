import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

const KIND_IDS = ['item', 'equipment'] as const;
const QUALITY_IDS = ['common', 'uncommon', 'rare', 'epic'] as const;

/**
 * POST /api/admin/shop/entries：新增条目
 *
 * 引用有效性（item_id 存在于 ITEMS/CorePack、template_id 存在于 EQUIPMENT_TEMPLATES）
 * 是"跨表业务规则"，class-validator 看不到注册表，故在 service 里重跑校验——
 * 否则商店会卖出引擎不认识的物品。
 */
export class CreateShopEntryDto {
  @IsString({ message: 'id 必须是字符串' })
  @IsNotEmpty({ message: 'id 不能为空' })
  id: string;

  @IsIn(KIND_IDS, { message: 'kind 必须是 item/equipment 之一' })
  kind: 'item' | 'equipment';

  @IsOptional()
  @IsString()
  item_id?: string;

  @IsOptional()
  @IsString()
  template_id?: string;

  @IsOptional()
  @IsIn(QUALITY_IDS, { message: 'quality 必须是 common/uncommon/rare/epic 之一' })
  quality?: string;

  @IsInt({ message: 'buy_price 必须是整数' })
  @Min(0, { message: 'buy_price 不能为负' })
  buy_price: number;

  @IsOptional()
  @IsInt({ message: 'sell_price 必须是整数' })
  @Min(0, { message: 'sell_price 不能为负' })
  sell_price?: number;

  @IsOptional()
  @IsInt({ message: 'required_level 必须是整数' })
  @Min(1, { message: 'required_level 至少为 1' })
  required_level?: number;

  @IsOptional()
  @IsInt({ message: 'stock 必须是整数' })
  @Min(-1, { message: 'stock 至少为 -1（-1 = 无限）' })
  stock?: number;

  @IsOptional()
  @IsBoolean({ message: 'listed 必须是布尔值' })
  listed?: boolean;

  @IsOptional()
  @IsInt({ message: 'sort_order 必须是整数' })
  sort_order?: number;
}

/**
 * PATCH /api/admin/shop/entries/:id：部分更新
 *
 * id 不可改（PATCH 路径里已有）；kind 也不可改——改 kind 会让引用字段语义漂移
 * （item 的 item_id 突然要被当作 template_id 解释），要改就删了重建。
 * 所有字段可选，未传的保持原值。
 */
export class UpdateShopEntryDto {
  @IsOptional()
  @IsString()
  item_id?: string;

  @IsOptional()
  @IsString()
  template_id?: string;

  @IsOptional()
  @IsIn(QUALITY_IDS, { message: 'quality 必须是 common/uncommon/rare/epic 之一' })
  quality?: string | null;

  @IsOptional()
  @IsInt({ message: 'buy_price 必须是整数' })
  @Min(0, { message: 'buy_price 不能为负' })
  buy_price?: number;

  @IsOptional()
  @IsInt({ message: 'sell_price 必须是整数' })
  @Min(0, { message: 'sell_price 不能为负' })
  sell_price?: number | null;

  @IsOptional()
  @IsInt({ message: 'required_level 必须是整数' })
  @Min(1, { message: 'required_level 至少为 1' })
  required_level?: number | null;

  @IsOptional()
  @IsInt({ message: 'stock 必须是整数' })
  @Min(-1, { message: 'stock 至少为 -1（-1 = 无限）' })
  stock?: number;

  @IsOptional()
  @IsBoolean({ message: 'listed 必须是布尔值' })
  listed?: boolean;

  @IsOptional()
  @IsInt({ message: 'sort_order 必须是整数' })
  sort_order?: number;
}
