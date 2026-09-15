// 仅写"为什么"：
// - id/passwordHash 只读是为了避免意外修改，passwordHash 只在创建/登录时通过 service 写入或比较
// - 对外暴露 account，但绝不包含 passwordHash（通过 Omit<> 在类型层面封堵）
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '../lib/prisma-client/client.js';
import * as bcrypt from 'bcryptjs';

export type SafeAccount = Omit<
  import('../lib/prisma-client/client.js').Account,
  'passwordHash'
>;

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaClient) {}

  // 注册前唯一性检查在 service 层做，因为 Prisma 的唯一约束异常错误码 P2002 对客户端太晦涩
  async findByEmail(email: string) {
    return this.prisma.account.findUnique({ where: { email } });
  }

  // 创建账号时密码先做 bcrypt，避免上层任何代码持有明文密码
  async create(email: string, plaintextPassword: string): Promise<SafeAccount> {
    const passwordHash = await bcrypt.hash(plaintextPassword, 10);
    const account = await this.prisma.account.create({
      data: { email, passwordHash },
    });
    return this.stripPassword(account);
  }

  async validatePassword(
    account: { passwordHash: string },
    plaintextPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(plaintextPassword, account.passwordHash);
  }

  private stripPassword(account: import('../lib/prisma-client/client.js').Account): SafeAccount {
    // 显式剔除密码哈希，防止 Nest 默认序列化把它带出接口
    const { passwordHash: _ignored, ...safe } = account;
    return safe;
  }
}