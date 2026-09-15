import { IsNotEmpty, IsString } from 'class-validator';

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
