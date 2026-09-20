// Prisma CLI 需要显式指定数据源 URL；.env 在仓库根目录，CLI 不会自动读取，所以在这里手动加载
// 根目录 .env 是配置的唯一来源（不提交 git）
import path from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 刻意不用 dotenv：dotenv 是 devDependency，生产镜像经 pnpm deploy --prod 后不含它，
// 而容器内执行 prisma migrate deploy 会加载本文件，缺依赖会让迁移直接失败。
// Node 22 自带的 loadEnvFile 已覆盖“本地开发读根 .env”的需求，且不覆盖已有环境变量。
try {
  process.loadEnvFile(path.resolve(__dirname, '../../.env'));
} catch {
  // 生产镜像没有 .env，环境变量由编排注入，忽略即可
}

// task-02 说明：
// 1) 使用独立的 lazycraft_auth 数据库，避免和其他项目共享 public schema（曾报 P3005）
// 2) DATABASE_URL 需要是已解析的完整连接串（postgresql://xxx:yyy@host:port/db）
// 3) 环境变量读取顺序：process.env（shell 导出）优先于 .env
// 这里刻意不在缺失时报错：镜像构建阶段执行 prisma generate 时没有 DATABASE_URL，
// 而 generate 并不需要真实连接串。迁移所需 URL 由容器入口脚本注入并强制校验。
const databaseUrl = process.env.DATABASE_URL ?? '';

export default defineConfig({
  schema: join(__dirname, 'prisma', 'schema.prisma'),
  migrations: {
    path: join(__dirname, 'prisma', 'migrations'),
  },
  datasource: {
    url: databaseUrl,
  },
});