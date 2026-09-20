import { IsInt, IsNotEmpty, IsString, Min, IsOptional } from 'class-validator';

/**
 * POST /api/action/start 的请求体
 *
 * skillId / actionId 都由客户端显式传，服务端做双重校验：
 * 除了各自存在外，还要求 action 确实属于该 skill——
 * 防止客户端拿着别的技能的等级来做自己不该做的动作。
 */
export class StartActionDto {
  @IsString({ message: 'skillId 必须是字符串' })
  @IsNotEmpty({ message: 'skillId 不能为空' })
  skillId: string;

  @IsString({ message: 'actionId 必须是字符串' })
  @IsNotEmpty({ message: 'actionId 不能为空' })
  actionId: string;
}

/**
 * POST /api/action/queue 的请求体：入队一项。
 *
 * count 是"工作次数（按圈数）"——与 idle/settle 的 tick 口径一致，N 圈 = N 次产出。
 */
export class EnqueueActionDto {
  @IsString({ message: 'skillId 必须是字符串' })
  @IsNotEmpty({ message: 'skillId 不能为空' })
  skillId: string;

  @IsString({ message: 'actionId 必须是字符串' })
  @IsNotEmpty({ message: 'actionId 不能为空' })
  actionId: string;

  @IsInt({ message: 'count 必须是整数' })
  @Min(1, { message: 'count 至少为 1' })
  count: number;
}

/**
 * PATCH /api/action/queue/:index 的请求体：按需改任一项。
 *
 * 三个字段都可选（至少给一个才有意义）；换工作时重跑技能匹配与等级校验。
 */
export class UpdateQueueItemDto {
  @IsOptional()
  @IsString({ message: 'skillId 必须是字符串' })
  @IsNotEmpty({ message: 'skillId 不能为空' })
  skillId?: string;

  @IsOptional()
  @IsString({ message: 'actionId 必须是字符串' })
  @IsNotEmpty({ message: 'actionId 不能为空' })
  actionId?: string;

  @IsOptional()
  @IsInt({ message: 'count 必须是整数' })
  @Min(1, { message: 'count 至少为 1' })
  count?: number;
}
