import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

/** 支持的语言代码 */
export type Language = 'zh-CN' | 'en';

export const SUPPORTED_LANGUAGES: Language[] = ['zh-CN', 'en'];

/** 默认语言，与后端 GET /api/config 返回的 defaultLanguage 保持一致 */
export const DEFAULT_LANGUAGE: Language = 'zh-CN';

type Messages = Record<string, string>;

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// 语言包缓存：Promise 级别缓存，避免 StrictMode 双渲染或语言来回切换时重复请求
const LOCALE_CACHE = new Map<Language, Promise<Messages>>();

function loadMessages(language: Language): Promise<Messages> {
  let cached = LOCALE_CACHE.get(language);
  if (!cached) {
    cached = fetch(`/locales/${language}.json`).then((res) => {
      if (!res.ok) throw new Error(`语言包加载失败: ${language} (${res.status})`);
      return res.json() as Promise<Messages>;
    });
    LOCALE_CACHE.set(language, cached);
  }
  return cached;
}

const STORAGE_KEY = 'lazycraft:language';

function readStoredLanguage(): Language {
  try {
    // 不做语言自动探测（task-04 约定），仅读取用户手动选过的语言
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'zh-CN' || stored === 'en') return stored;
  } catch {
    // localStorage 不可用（隐私模式等）时静默回退到默认语言
  }
  return DEFAULT_LANGUAGE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);
  // 语言包缓存命中时沿用旧 messages，切换语言后短暂显示旧文案，避免闪烁/白屏
  const [messages, setMessages] = useState<Messages | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMessages(language).then((loaded) => {
      if (!cancelled) setMessages(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      // 持久化到 localStorage，task-05 设置面板会直接读写同一个 key
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 存储失败不影响当次切换
    }
  }, []);

  const t = useCallback(
    // 缺 key 时返回 key 本身（验收要求：不白屏、可直接暴露缺失的 key 方便补翻译）
    (key: string) => messages?.[key] ?? key,
    [messages],
  );

  return createElement(I18nContext.Provider, { value: { language, setLanguage, t } }, children);
}

/**
 * 组件内获取翻译的 hook
 *
 * 用法：const { t, language, setLanguage } = useT();
 */
export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT() 必须在 <I18nProvider> 内使用');
  return ctx;
}
