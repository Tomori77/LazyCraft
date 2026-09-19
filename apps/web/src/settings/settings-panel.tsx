import { useState } from 'react';
import { SUPPORTED_LANGUAGES, useT, type Language } from '../i18n/index.ts';
import { useSettings } from './settings-context.tsx';
import type { GraphicsQuality } from './settings.ts';

const QUALITY_OPTIONS: GraphicsQuality[] = ['low', 'medium', 'high'];

/**
 * 设置面板（弹窗形态，挂右上角设置按钮触发）
 *
 * 为什么选弹窗而不是侧栏：task-10 的整体布局还没落地，现在引入
 * 侧栏会提前决定页面结构；弹窗只依赖一个触发按钮，后续搬到任何
 * 布局里都不受影响。
 *
 * 音量滑条即时生效：拖动过程中持续写入（本地持久化很便宜）；
 * 云端同步的频率控制交给 SettingsProvider 的尽力而为策略。
 */
export function SettingsPanel() {
  const { t } = useT();
  const { settings, setVolume, setLanguageSetting, setQuality, setAutoQueue } = useSettings();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="settings-trigger" onClick={() => setOpen(true)}>
        {t('settings.title')}
      </button>
      {open && (
        <div className="settings-overlay" onClick={() => setOpen(false)}>
          {/* 阻止冒泡：点面板内部不关闭 */}
          <section
            className="settings-modal"
            role="dialog"
            aria-label={t('settings.title')}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="settings-header">
              <h2>{t('settings.title')}</h2>
              <button className="settings-close" onClick={() => setOpen(false)} aria-label={t('settings.close')}>
                ×
              </button>
            </header>

            <div className="settings-field">
              <label htmlFor="settings-volume">
                {t('settings.volume')}
                <span className="settings-value">{settings.volume}</span>
              </label>
              <input
                id="settings-volume"
                type="range"
                min={0}
                max={100}
                value={settings.volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
            </div>

            <div className="settings-field">
              <label htmlFor="settings-language">{t('settings.language')}</label>
              <select
                id="settings-language"
                value={settings.language}
                onChange={(e) => setLanguageSetting(e.target.value as Language)}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {t(`settings.language.${lang === 'zh-CN' ? 'zh' : 'en'}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-field">
              <label htmlFor="settings-quality">{t('settings.quality')}</label>
              <select
                id="settings-quality"
                value={settings.quality}
                onChange={(e) => setQuality(e.target.value as GraphicsQuality)}
              >
                {QUALITY_OPTIONS.map((q) => (
                  <option key={q} value={q}>
                    {t(`settings.quality.${q}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-field settings-field-inline">
              <label htmlFor="settings-auto-queue">{t('settings.auto_queue')}</label>
              <input
                id="settings-auto-queue"
                type="checkbox"
                checked={settings.auto_queue}
                onChange={(e) => setAutoQueue(e.target.checked)}
              />
            </div>

          </section>
        </div>
      )}
    </>
  );
}
