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
    const account = await this.prisma.account.findUnique({ where: { id: payload.sub } });
    if (!account) {
      throw new UnauthorizedException();
    }
    return { id: payload.sub, ...payload };
  }
}