import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/auth.tsx';
import { useT } from '../i18n/index.ts';
import { readSave, syncSettingsToCloud } from '../save/api.ts';
import {
  SETTINGS_STORAGE_KEY,
  readLocalSettings,
  settingsFromSaveData,
  type GraphicsQuality,
  type PlayerSettings,
} from './settings.ts';
import type { Language } from '../i18n/index.ts';

/**
 * 设置上下文（本任务核心）
 *
 * 持久化策略（游客可玩 + 云端权威）：
 *   - 未登录：每次变更立即写 localStorage（lazycraft:settings），重开浏览器仍在。
 *   - 登录瞬间：拉取云端存档，用其中的 settings 覆盖本地（验收标准 2）。
 *   - 登录后变更：先写 localStorage（断网也不丢），再尽力同步云端。
 *
 * 与 i18n 的协作：
 *   language 真正生效的存储是 task-04 的 lazycraft:language，由 I18nProvider 读写。
 *   本模块把 language 记录进 settings 结构只是为了云端同步；
 *   应用语言时仍调用 setLanguage()，避免两个模块各自维护一份"当前语言"。
 */
interface SettingsContextValue {
  settings: PlayerSettings;
  setVolume: (volume: number) => void;
  setLanguageSetting: (language: Language) => void;
  setQuality: (quality: GraphicsQuality) => void;
  setAutoQueue: (enabled: boolean) => void;
  /** 登录后正在从云端拉取设置（短暂，期间面板显示正常值，无需 loading 态） */
  syncing: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const { setLanguage } = useT();
  const [settings, setSettings] = useState<PlayerSettings>(readLocalSettings);
  const [syncing, setSyncing] = useState(false);
  // 防止登录拉取的慢响应盖掉用户在等待期间做的本地修改
  const lastLocalChangeAtRef = useRef(0);

  // 每次变更：本地立即持久化（游客模式的唯一保障，也是断网兜底）
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 隐私模式写不进去时，内存态仍生效
    }
  }, [settings]);

  // 尽力而为把一份 settings 推到云端；失败静默（本地已持久化，玩家不受影响）
  const pushToCloud = useCallback(
    (next: PlayerSettings) => {
      if (!token) return;
      void syncSettingsToCloud(token, next).catch(() => undefined);
    },
    [token],
  );

  const applyPatch = useCallback(
    (patch: Partial<PlayerSettings>) => {
      lastLocalChangeAtRef.current = Date.now();
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        // 用 next 同步而不是闭包里的旧 settings，避免快速连续修改只上传最后一帧之外的状态
        pushToCloud(next);
        return next;
      });
    },
    [pushToCloud],
  );

  // 登录边界：云端权威，用存档里的 settings 覆盖本地
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    // 记录拉取开始时刻：游客期/拉取完成前的本地修改时间戳都早于此值，
    // 只有"拉取进行中"发生的新修改才会阻止云端覆盖（避免慢响应盖掉刚改的值）
    const fetchStartedAt = Date.now();
    setSyncing(true);
    readSave(token)
      .then((save) => {
        if (cancelled) return;
        if (lastLocalChangeAtRef.current > fetchStartedAt) return;
        const remote = settingsFromSaveData(save.data);
        setSettings(remote);
        // 语言的实际生效入口在 i18n 模块，必须同步过去
        setLanguage(remote.language);
      })
      .catch(() => {
        // 拉取失败（断网/服务挂了）时保留本地设置，玩家不受影响；
        // 之后任何一次本地修改都会通过 applyPatch → pushToCloud 把本地最新值推上云端
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => {
      cancelled = true;
    };
    // setLanguage / pushToCloud 都是稳定引用；真正触发条件是 token 从 null → 有值
  }, [token, setLanguage, pushToCloud]);

  const setVolume = useCallback((volume: number) => applyPatch({ volume }), [applyPatch]);

  const setLanguageSetting = useCallback(
    (language: Language) => {
      // 先让 i18n 立即生效（写 lazycraft:language + 换语言包），再记录进设置结构同步云端
      setLanguage(language);
      applyPatch({ language });
    },
    [applyPatch, setLanguage],
  );

  const setQuality = useCallback((quality: GraphicsQuality) => applyPatch({ quality }), [applyPatch]);

  const setAutoQueue = useCallback((enabled: boolean) => applyPatch({ auto_queue: enabled }), [applyPatch]);

  return createElement(
    SettingsContext.Provider,
    { value: { settings, setVolume, setLanguageSetting, setQuality, setAutoQueue, syncing } },
    children,
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings() 必须在 <SettingsProvider> 内使用');
  return ctx;
}
