import { LoginForm } from './auth/login-form.tsx';
import { SettingsPanel } from './settings/settings-panel.tsx';
import { useT } from './i18n/index.ts';

function App() {
  const { t } = useT();

  return (
    <main className="app">
      <h1>{t('app.title')}</h1>
      <p>{t('app.subtitle')}</p>
      {/* 语言切换已由设置面板接管（task-05），不再保留 task-04 的临时按钮 */}
      <SettingsPanel />
      <LoginForm />
    </main>
  );
}

export default App;
