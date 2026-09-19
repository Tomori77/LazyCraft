import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
