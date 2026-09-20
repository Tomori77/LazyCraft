import { IsBoolean } from 'class-validator';

/**
 * PATCH /api/admin/content/packs/:id
 *
 * 只接受 boolean：启停是二值状态，客户端不该传字符串 "true"/1 之类的模糊值，
 * 让 class-validator 在入口就挡住，避免 service 里再写兜底分支。
 */
export class UpdatePackStateDto {
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled: boolean;
}
