import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
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
