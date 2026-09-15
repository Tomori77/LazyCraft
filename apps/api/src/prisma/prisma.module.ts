// 认证模块的数据库句柄。PrismaClient 在 Prisma 7 通过 @prisma/adapter-pg 直连 PostgreSQL。
// 这里做成 Nest Module 而非全局单例：便于在 e2e 测试里对每个 TestModule 走同一套连接，并通过 beforeAll/afterAll 管理生命周期。
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../lib/prisma-client/client.js';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PrismaClient,
      useFactory: async () => {
        // 测试时 DATABASE_URL 由 vitest 注入；开发模式从 process.env 读取（.env 已加载到全局）
        const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
        const client = new PrismaClient({ adapter });
        await client.$connect();
        // 测试或开发模式下，进程退出时主动断开，避免 Postgres 连接泄漏
        process.on('beforeExit', () => {
          void client.$disconnect();
        });
        return client;
      },
    },
  ],
  exports: [PrismaClient],
})
export class PrismaModule {}
