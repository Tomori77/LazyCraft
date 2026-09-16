# syntax=docker/dockerfile:1
# ========================================
# LazyCraft 后端镜像（多阶段构建）
# ========================================
# 设计要点：
#   1. 依赖 @lazycraft/shared（workspace 包），构建上下文必须是 monorepo 根目录
#   2. pnpm 通过 corepack 启用，不用 npm install pnpm 固定安装方式
#   3. pnpm 依赖是符号链接结构，不能直接 COPY node_modules，
#      生产依赖用 pnpm deploy --prod 打包成物理拷贝
#   4. 最终镜像不带 node_modules/.pnpm-store、devDependencies、构建工具，
#      只保留生产运行所需的 dist + node_modules
#   5. 用 node 用户运行，避免容器进程以 root 持有数据库和 JWT 密钥

FROM node:22-alpine AS base
# pnpm 10.x 与仓库 packageManager 一致
RUN corepack enable && corepack prepare pnpm@10.16.1 --activate
WORKDIR /app

# ----------------------------------------
# 阶段 1：安装全部依赖（含 devDependencies）
# ----------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY apps/api/prisma ./apps/api/prisma
# --frozen-lockfile 确保镜像与仓库锁文件一致，避免“本地能跑线上报错”
RUN pnpm install --frozen-lockfile --dangerously-allow-all-builds

# ----------------------------------------
# 阶段 2：编译 shared + api
# ----------------------------------------
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @lazycraft/shared build
RUN pnpm --filter @lazycraft/api build

# ----------------------------------------
# 阶段 3：收集生产依赖 + 产物
# ----------------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
# pnpm deploy 会生成一个仅含生产依赖的干净目录 /app/deploy，
# 解决 pnpm 符号链接无法用 COPY 简单搬迁的问题
RUN pnpm --filter @lazycraft/api deploy --prod --legacy /app/deploy

FROM prod-deps AS artifacts
COPY --from=build /app/apps/api/dist ./deploy/dist
COPY --from=build /app/apps/api/src/lib/prisma-client ./deploy/src/lib/prisma-client
# 迁移文件必须进镜像：容器内执行 npx prisma migrate deploy 时需要
COPY apps/api/prisma ./deploy/prisma

# ----------------------------------------
# 阶段 4：生产运行镜像
# ----------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# 复制 pnpm deploy 打包好的生产依赖与编译产物
COPY --from=artifacts --chown=node:node /app/deploy ./
# prisma CLI 运行时会在 node_modules/.bin 里查找，需保留完整目录结构

USER node
EXPOSE 3000

# 启动命令由 compose 覆盖（迁移 + 启动）；此处给默认启动命令
CMD ["node", "dist/main.js"]
