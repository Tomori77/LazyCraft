import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vite 默认只读 apps/web 下的 .env，而本项目前端变量（VITE_API_BASE_URL）
  // 与后端共用仓库根目录的那一份 .env；指向根目录后改根 .env 即生效。
  // 安全性：Vite 只把 VITE_ 前缀变量注入客户端，根 .env 里的
  // DATABASE_URL / JWT_SECRET 等不会进入前端产物。
  envDir: resolve(import.meta.dirname, '../..'),
  server: {
    // 本地开发时把 /api 反代到后端 3000，否则相对路径会打到 Vite 自身 5173 而全部 404。
    // 生产环境不需要这段：nginx 在 /api/ 上做同样的反代，前后端同源。
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
