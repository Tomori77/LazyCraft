import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // 为什么串行跑文件？
    //   所有 e2e 共用远程测试库的同一份全局状态：
    //   1) `content_pack_state` 是进程内内容快照的输入——某个 spec 停用 core 并 reload 后，
    //      并行 spec 的 app.init() 可能正好读到"空内容"，动作查不到、next_tick_at 变 null；
    //   2) 内容重载会按设计**全库**中断引用被停用内容的存档（task-42 的正当语义），
    //      这会改到并行 spec 正在跑的 current_action，让它们的 stop 变成 409。
    //   这两点无法在测试侧规避（不是实现缺陷），只能让文件串行执行避免互相污染。
    fileParallelism: false,
    // 为什么把默认 5s 抬到 30s：
    //   e2e 直接访问远程 PG（.env 里 DATABASE_URL 指向云主机），单次 register+login+
    //   初始化存档要走多轮外网往返；market 模块的用例一个测试就要注册 3-4 个账号，
    //   5s 预算必然不够，超时会被误报成"业务失败"。
    //   给 30s 不是放宽正确性，只是承认网络层下限；
    //   业务本身的毫秒级断言由 service 单测覆盖，e2e 只关心"走通 + 状态对"。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
