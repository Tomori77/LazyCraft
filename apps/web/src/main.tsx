import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HAND_DRAWN_ICONS } from '@lazycraft/icons'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/auth.tsx'
import { I18nProvider } from './i18n/index.ts'
import { IconRegistryProvider } from './icons/icon-context.tsx'
import { SettingsProvider } from './settings/settings-context.tsx'

// Provider 嵌套顺序：I18n 最外层（文案人人要用）→ Auth → Settings（消费前两者）
// IconRegistryProvider 包在最外层：登录/注册屏也要用品牌图标，不能只在游戏内容子树里有 sprite
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <IconRegistryProvider icons={HAND_DRAWN_ICONS}>
        <AuthProvider>
          <SettingsProvider>
            <App />
          </SettingsProvider>
        </AuthProvider>
      </IconRegistryProvider>
    </I18nProvider>
  </StrictMode>,
)
