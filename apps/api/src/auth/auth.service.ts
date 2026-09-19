import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountsService } from './accounts.service.js';
import { RegisterDto, LoginDto } from './dto/auth.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existed = await this.accounts.findByEmail(dto.email);
    // 邮箱重复是业务冲突，必须返回 409 而非数据库抛出的 500
    if (existed) {
      throw new ConflictException('邮箱已被注册');
    }
    // 账号与 player 同名同建在同一事务里完成：用户名冲突时整体回滚，不留孤儿账号
    const account = await this.accounts.createWithPlayer(dto.username, dto.email, dto.password);
    return { account };
  }

  async login(dto: LoginDto) {
    const account = await this.accounts.findByEmail(dto.email);
    if (!account) {
      // 故意不区分"邮箱不存在"和"密码错误"，防止枚举攻击探测注册用户
      throw new UnauthorizedException('邮箱或密码错误');
    }
    const valid = await this.accounts.validatePassword(account, dto.password);
    if (!valid) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    const payload = { sub: account.id, email: account.email };
    return { accessToken: this.jwtService.sign(payload) };
  }
}