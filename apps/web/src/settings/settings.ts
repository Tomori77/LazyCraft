import type { Language } from '../i18n/index.ts';

/** 画质档位：当前仅作为偏好记录，渲染端在 task-10 布局/UI 阶段消费 */
export type GraphicsQuality = 'low' | 'medium' | 'high';

/**
 * 玩家设置结构（与云端存档 data.settings 字段一一对应）
 *
 * 命名用蛇形（auto_queue）而不是驼峰，与存档契约 task-03 的
 * "存档即文档"原则保持一致：写进 JSONB 后不需要命名转换。
 */
export interface PlayerSettings {
  /** 主音量 0~100 */
  volume: number;
  /** 界面语言，与 i18n 模块的 Language 类型一致 */
  language: Language;
  /** 画质档位 */
  quality: GraphicsQuality;
  /** 动作完成后是否自动排队下一个 */
  auto_queue: boolean;
}

/** 默认值与 i18n 的 DEFAULT_LANGUAGE 对齐，保证游客模式与首次登录行为一致 */
export const DEFAULT_SETTINGS: PlayerSettings = {
  volume: 80,
  language: 'zh-CN',
  quality: 'medium',
  auto_queue: false,
};

// 与存档共用同一 localStorage key 风格（task-04 已用 lazycraft:language）
export const SETTINGS_STORAGE_KEY = 'lazycraft:settings';

const QUALITIES: GraphicsQuality[] = ['low', 'medium', 'high'];

/**
 * 逐字段校验后合并进默认值。
 *
 * 为什么不能直接 JSON.parse 就信？
 *   localStorage 可被用户手动改、云端存档可能被旧版本客户端写过不完整的
 *   settings——把不受信数据当 PlayerSettings 用会让设置面板显示非法值。
 *   字段缺失/非法时回退默认值，保证下游永远拿到合法结构。
 */
export function normalizeSettings(raw: unknown): PlayerSettings {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    volume:
      typeof source.volume === 'number' && Number.isFinite(source.volume)
        ? Math.min(100, Math.max(0, Math.round(source.volume)))
        : DEFAULT_SETTINGS.volume,
    language:
      source.language === 'zh-CN' || source.language === 'en'
        ? source.language
        : DEFAULT_SETTINGS.language,
    quality: QUALITIES.includes(source.quality as GraphicsQuality)
      ? (source.quality as GraphicsQuality)
      : DEFAULT_SETTINGS.quality,
    auto_queue: typeof source.auto_queue === 'boolean' ? source.auto_queue : DEFAULT_SETTINGS.auto_queue,
  };
}

export function readLocalSettings(): PlayerSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) return normalizeSettings(JSON.parse(stored));
  } catch {
    // localStorage 不可用或内容损坏时静默回退默认值
  }
  return DEFAULT_SETTINGS;
}

/**
 * 从云端存档 data.settings 提取设置。
 *
 * 云端 settings 可能是 `{}`（从未同步过），normalizeSettings 会整体回退默认值，
 * 因此这里不做"字段缺失则用本地值补齐"的合并——任务约定云端权威。
 */
export function settingsFromSaveData(data: { settings?: Record<string, unknown> }): PlayerSettings {
  return normalizeSettings(data.settings);
}
