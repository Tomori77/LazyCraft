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

/** POST /api/shop/sell 的请求体；装备 quantity 只能为 1 */
export class SellDto {
  @IsString({ message: 'uid 必须是字符串' })
  @IsNotEmpty({ message: 'uid 不能为空' })
  uid: string;

  @IsInt({ message: 'quantity 必须是整数' })
  @Min(1, { message: 'quantity 必须 ≥ 1' })
  quantity: number;
}
