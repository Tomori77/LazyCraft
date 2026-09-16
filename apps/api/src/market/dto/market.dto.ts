import { IsInt, IsIn, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

/**
 * POST /api/market/list 的请求体
 *
 * 品质限定四档而不是 free-form 字符串：
 *   品质决定物品的"颜色维度"，多/少字母都会在 history 聚合里产生重复行。
 *   （types.ts 的 Quality 是运行时不可见的 TS 联合类型，DTO 用 @IsIn 校验。）
 */
export class ListItemDto {
  @IsString({ message: 'itemId 必须是字符串' })
  @IsNotEmpty({ message: 'itemId 不能为空' })
  itemId: string;

  @IsInt({ message: 'quantity 必须是整数' })
  @Min(1, { message: 'quantity 必须 ≥ 1' })
  quantity: number;

  /** 单价（gold）。总价 = price * quantity，由后端计算 */
  @IsInt({ message: 'price 必须是整数' })
  @Min(1, { message: 'price 必须 ≥ 1' })
  price: number;

  @IsOptional()
  @IsIn(['common', 'uncommon', 'rare', 'epic'], { message: 'quality 必须是 common/uncommon/rare/epic 之一' })
  quality?: string;
}

/**
 * GET /api/market/listings 的查询参数
 *
 * 分页参数都给了上限封顶：避免恶意客户端传 limit=100000 把 DB 拖死。
 */
export class ListingsQueryDto {
  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsIn(['common', 'uncommon', 'rare', 'epic'])
  quality?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
