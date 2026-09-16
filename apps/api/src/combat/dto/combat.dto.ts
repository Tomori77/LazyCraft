import { IsNotEmpty, IsString } from 'class-validator';

/**
 * POST /api/combat/start 的请求体
 *
 * enemyId 必须由客户端显式传——服务端据此查敌人配置，
 * 不接受"打一个看不见的目标"的隐式约定。
 */
export class StartCombatDto {
  @IsString({ message: 'enemyId 必须是字符串' })
  @IsNotEmpty({ message: 'enemyId 不能为空' })
  enemyId: string;
}
