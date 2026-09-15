# LazyCraft

Web 端放置挂机游戏框架（参考《梅尔沃放置》）。框架期只做「基础功能齐全 + 内容量最小」，所有游戏规则集中在 `packages/shared`，前端用它做预览、后端用它做结算。

详细设计与任务拆分见 `docs/`。

## 环境要求

- Node.js >= 22
- pnpm >= 10

## 常用命令

在仓库根目录执行（所有命令都会按 workspace 依赖顺序自动分发到子包）：

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装全部子包依赖 |
| `pnpm dev` | 先构建 `shared`，再并行启动 web(5173) + api(3000) + shared 监听编译 |
| `pnpm build` | 按拓扑顺序构建 `shared` → `api` / `web` |
| `pnpm lint` | 对所有子包执行 oxlint |
| `pnpm test` | 对所有子包执行 Vitest（api 含单元测试） |

单包操作示例：`pnpm --filter @lazycraft/api test:e2e`。

`pnpm dev` 之后访问：

- 前端：http://localhost:5173
- 后端：http://localhost:3000

## 目录结构

```
LazyCraft/
├── apps/
│   ├── web/          # @lazycraft/web  React + TypeScript + Vite
│   └── api/          # @lazycraft/api  NestJS
├── packages/
│   └── shared/       # @lazycraft/shared  前后端共享：类型 + 核心游戏逻辑
├── docs/             # 项目文档（不提交 git）
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

## 子包说明

### `@lazycraft/shared`

前后端唯一的游戏规则来源（经验公式、收益计算、离线结算、内容配置表）。用 tsc 编译到 `dist/`，`package.json` 通过 `exports` 暴露：

```json
"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
```

因此它必须先构建出 `dist/`，使用方才能解析到。根 `dev` 脚本已内置这一步（先 `build` 再并行 `dev`），`shared` 自身的 `dev` 是 `tsc --watch`，改动源码会实时重新产出 `dist/`，**无需手动构建**。

使用方式：在任意子包中直接 `import { GAME_VERSION } from '@lazycraft/shared'`（依赖已在子包 `package.json` 中声明为 `workspace:*`）。

> 注意：`shared` 以 Node ESM（`module: nodenext`）输出，包内相对导入必须带 `.js` 后缀。

### `@lazycraft/web`

React 19 + Vite 8 前端。`tsconfig.app.json` / `tsconfig.node.json` 继承根 `tsconfig.base.json`。Vite 走 bundler 解析，可直接消费 `shared` 的 ESM 产物。

### `@lazycraft/api`

NestJS 12 后端，默认监听 3000（可用 `PORT` 环境变量覆盖）。`tsconfig.json` 继承根 `tsconfig.base.json`，模块体系为 `nodenext`（ESM），包内相对导入同样需要 `.js` 后缀。
