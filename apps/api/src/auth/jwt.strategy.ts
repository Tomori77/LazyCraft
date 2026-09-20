import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { PrismaClient } from '../lib/prisma-client/client.js';

export interface JwtPayload {
  sub: string; // 账号 id
  email: string;
}

interface ValidatedUser extends JwtPayload {
  id: string;
  role: string;
}

/** 账号有效性缓存条目 */
interface AccountCacheEntry {
  role: string;
  /** 是否被封禁（task-40）：随 role 一同缓存，避免每请求多查一列 */
  banned: boolean;
  /** 过期时刻（毫秒）；到点后必须回库复核，避免账号被删/降权后 token 仍有效 */
  expiresAt: number;
}

/**
 * token 校验缓存时长（毫秒）。
 *
 * 为什么需要缓存？
 *   远程数据库单次往返约 80ms，而每个受保护请求都要在这里查一次账号；
 *   不缓存时"点一个按钮"的延迟里有近 80ms 纯属重复校验同一张不变的表。
 * 为什么是 5 秒而不是永久？
 *   服务器权威要求"账号被删/被降为普通用户"能及时生效。5s 是
 *   "每请求一次往返"与"撤销生效延迟"之间的折中：撤销最多晚 5s，
 *   而正常游玩期间的连续操作不再为同一账号反复回库。
 *   注意缓存的是"账号是否存在 + 当前 role"，不是 token 本身；
 *   每次请求仍逐字节校验 JWT 签名与过期时间。
 */
const ACCOUNT_CACHE_TTL_MS = 5_000;

/** 进程内账号校验缓存：key = 账号 id；单实例部署，无需跨进程失效机制 */
const accountCache = new Map<string, AccountCacheEntry>();

/**
 * 主动失效某账号的校验缓存（task-40）。
 *
 * 为什么需要它？
 *   封禁/改角色后若只等 5s TTL 自然过期，管理员点完"封禁"到该账号 token 失效
 *   之间有最长 5 秒窗口；管理操作要求"立即生效"更符合直觉。这里由 admin 服务
 *   在写库成功后调用，把撤销延迟压到 0。
 */
export function invalidateAccountCache(accountId: string): void {
  accountCache.delete(accountId);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaClient) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET ?? 'lazycraft-dev-secret',
    });
  }

  // 解码后的 payload 必须能在数据库里找到对应账号，否则 token 视为无效
  async validate(payload: JwtPayload): Promise<ValidatedUser> {
    const now = Date.now();
    const cached = accountCache.get(payload.sub);
    if (cached && cached.expiresAt > now) {
      // 封禁在"鉴权层"再拦一次：登录被拒只挡新 token，
      // 已签发的旧 token 必须在这里失效，否则封禁形同虚设
      this.assertNotBanned(cached.banned);
      // role 故意不写进 JWT payload：角色可能被后台变更/撤销，
      // 因此缓存只保留极短 TTL（见上），到点后回库读最新值
      return { id: payload.sub, ...payload, role: cached.role };
    }

    const account = await this.prisma.account.findUnique({
      where: { id: payload.sub },
      select: { role: true, banned: true },
    });
    if (!account) {
      // 账号已不存在：顺手清掉可能残留的缓存
      accountCache.delete(payload.sub);
      throw new UnauthorizedException();
    }
    this.assertNotBanned(account.banned);
    accountCache.set(payload.sub, {
      role: account.role,
      banned: account.banned,
      expiresAt: now + ACCOUNT_CACHE_TTL_MS,
    });
    return { id: payload.sub, ...payload, role: account.role };
  }

  /** 封禁账号的 token 一律 401（不是 403）：身份被服务器否定，前端应回到登录页 */
  private assertNotBanned(banned: boolean): void {
    if (banned) {
      throw new UnauthorizedException('账号已被封禁');
    }
  }
}
