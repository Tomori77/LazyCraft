import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

/** POST /api/shop/buy 的请求体 */
export class BuyDto {
  @IsString({ message: 'entry_id 必须是字符串' })
  @IsNotEmpty({ message: 'entry_id 不能为空' })
  entry_id: string;

  @IsInt({ message: 'quantity 必须是整数' })
  @Min(1, { message: 'quantity 必须 ≥ 1' })
  quantity: number;
}

/**
 * POST /api/shop/sell 的请求体（task-33 契约变更）。
 *
 * 为什么不再收 `uid`？
 *   出售改为固定可回收清单后，服务端按 `entry_id` 的引用聚合背包持有量；
 *   客户端不再需要（也不应）指定背包里的具体格子。装备不可堆叠，
 *   但数量校验由服务端按条目口径统一做（见 ShopService.sell）。
 */
export class SellDto {
  @IsString({ message: 'entry_id 必须是字符串' })
  @IsNotEmpty({ message: 'entry_id 不能为空' })
  entry_id: string;

  @IsInt({ message: 'quantity 必须是整数' })
  @Min(1, { message: 'quantity 必须 ≥ 1' })
  quantity: number;
}
