import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * 管理员守卫（task-24b）
 *
 * 使用顺序：`@UseGuards(JwtAuthGuard, AdminGuard)`——JwtAuthGuard 先跑，
 * 把 JwtStrategy.validate() 的结果（含 role）填进 request.user；AdminGuard 只做角色判定。
 * 单独使用本 Guard 无意义（user 不存在 → 一律 403），所以必须与 JwtAuthGuard 成对出现。
 *
 * 为什么 role 来自 request.user 而不是再查一次 DB？
 *   JwtStrategy 已在每个请求里查过账号（保证 token 未失效即账号仍存在），
 *   这里复用那次查询的结果即可，避免同一请求两次读库。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    if (request.user?.role !== 'admin') {
      throw new ForbiddenException('需要管理员权限');
    }
    return true;
  }
}
