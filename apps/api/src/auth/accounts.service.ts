// 仅写"为什么"：
// - id/passwordHash 只读是为了避免意外修改，passwordHash 只在创建/登录时通过 service 写入或比较
// - 对外暴露 account，但绝不包含 passwordHash（通过 Omit<> 在类型层面封堵）
import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '../lib/prisma-client/client.js';
import * as bcrypt from 'bcryptjs';
import { roleForEmail } from './admin-emails.js';

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

  async findById(id: string) {
    return this.prisma.account.findUnique({ where: { id } });
  }

  /**
   * 注册：账号与游戏角色（player.name = 用户名）在同一事务内创建。
   *
   * 为什么放在 AccountsService 而不是 AuthService 里直接写事务？
   *   哈希密码、剥离 passwordHash 这些"账号持久化"细节都归本 service；
   *   若在 AuthService 里开事务，就得把 bcrypt 与 SafeAccount 逻辑再复制一份。
   *   用户名唯一性检查与写入放在同一事务，冲突时整体回滚，
   *   不会留下"账号已建、玩家没建"的孤儿账号。
   *
   * 为什么用 P2002 兜底而不是只靠 findUnique 预检？
   *   预检只挡顺序请求；两个并发注册抢同一用户名时，唯一索引才是最终裁判，
   *   捕获 P2002 转成 409，避免把数据库错误泄露成 500。
   */
  async createWithPlayer(
    username: string,
    email: string,
    plaintextPassword: string,
  ): Promise<SafeAccount> {
    const passwordHash = await bcrypt.hash(plaintextPassword, 10);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const nameTaken = await tx.player.findUnique({ where: { name: username } });
        if (nameTaken) {
          throw new ConflictException('用户名已被占用');
        }
        const account = await tx.account.create({
          data: { email, passwordHash, role: roleForEmail(email) },
        });
        await tx.player.create({ data: { accountId: account.id, name: username } });
        return this.stripPassword(account);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // 命中 accounts_email 或 players_name 唯一索引：并发竞态下另一请求已抢占
        const target = String(error.meta?.target ?? '');
        throw new ConflictException(
          target.includes('email') ? '邮箱已被注册' : '用户名已被占用',
        );
      }
      throw error;
    }
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
