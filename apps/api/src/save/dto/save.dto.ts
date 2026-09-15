import { IsInt, IsNotEmpty, IsObject, Min } from 'class-validator';

/**
 * POST /api/save 的请求体
 *
 * 为什么 version 必须由客户端显式传？
 *   乐观并发控制：服务端拿 version 跟 DB 里的版本对比，防止玩家在两个标签页里
 *   同时写入互相覆盖（服务器权威——后到的请求如果不是基于最新版本，会被拒绝而不是合并）。
 */
export class WriteSaveDto {
  @IsInt({ message: 'version 必须是整数' })
  @Min(1, { message: 'version 最小为 1' })
  version: number;

  @IsObject({ message: 'data 必须是对象' })
  @IsNotEmpty({ message: 'data 不能为空' })
  data: Record<string, unknown>;
}
