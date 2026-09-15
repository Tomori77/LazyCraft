import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/auth.tsx'
import { I18nProvider } from './i18n/index.ts'
import { SettingsProvider } from './settings/settings-context.tsx'

// Provider 嵌套顺序：I18n 最外层（文案人人要用）→ Auth → Settings（消费前两者）
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
)
