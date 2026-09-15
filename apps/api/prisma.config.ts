// Prisma CLI 需要显式指定数据源 URL；.env 在仓库根目录，CLI 不会自动读取，所以在这里手动加载
// 根目录 .env 是配置的唯一来源（不提交 git）
import path from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 从 monorepo 根目录加载 .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// task-02 说明：
// 1) 使用独立的 lazycraft_auth 数据库，避免和其他项目共享 public schema（曾报 P3005）
// 2) DATABASE_URL 需要是已解析的完整连接串（postgresql://xxx:yyy@host:port/db）
// 3) 环境变量读取顺序：process.env（shell 导出）优先于 .env
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL: set it in shell env or in .env at repo root');
}

export default defineConfig({
  schema: join(__dirname, 'prisma', 'schema.prisma'),
  migrations: {
    path: join(__dirname, 'prisma', 'migrations'),
  },
  datasource: {
    url: databaseUrl,
  },
});