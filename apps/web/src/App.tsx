import { SUPPORTED_LANGUAGES, useT } from './i18n/index.ts';

function App() {
  const { t, language, setLanguage } = useT();

  return (
    <main className="app">
      <h1>{t('app.title')}</h1>
      <p>{t('app.subtitle')}</p>
      {/* 临时语言切换按钮：正式的设置面板在 task-05 实现 */}
      <div className="lang-switch">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <button
            key={lang}
            onClick={() => setLanguage(lang)}
            disabled={lang === language}
          >
            {lang === 'zh-CN' ? '中文' : 'English'}
          </button>
        ))}
      </div>
      <p>
        {t('skill.mining.name')} · {t('item.copper_ore.name')} ·{' '}
        {t('demo.missing.key')}
      </p>
    </main>
  );
}

export default App;
