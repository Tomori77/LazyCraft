import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * 新手引导（Tutorial）状态
 *
 * 持久化策略：
 *   - localStorage 存"是否已看完"：key = lazycraft:tutorial_done
 *   - 看完 / 跳过都会写入 true；设置里"重新观看"时清回 false 再 setStep(0)
 *
 * 为什么不直接复用 settings 存这个状态？
 *   引导状态是"本地 UI 偏好"而不是"玩家设置"——它不需要云端同步，
 *   也不该出现在设置面板里被玩家误触。localStorage 独立 key 即可。
 */

const STORAGE_KEY = 'lazycraft:tutorial_done';

function readDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

interface TutorialContextValue {
  /** 当前引导步骤索引；null = 不在引导中 */
  step: number | null;
  /** 总步数 */
  total: number;
  next: () => void;
  skip: () => void;
  /** 用于"设置面板 → 重新观看"：清除完成标记并从第 0 步开始 */
  restart: () => void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<number | null>(() => (readDone() ? null : 0));

  const markDone = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // 写不进去时只靠内存态（隐私模式）
    }
  }, []);

  const next = useCallback(() => {
    setStep((prev) => {
      if (prev === null) return prev;
      // 教程共 5 步（索引 0..4；TUTORIAL_STEPS 里维护），走完 next 时收尾
      // 这里的上界与 useTutorial 暴露的 total 保持一致
      return prev + 1 >= TUTORIAL_TOTAL ? (markDone(), null) : prev + 1;
    });
  }, [markDone]);

  const skip = useCallback(() => {
    markDone();
    setStep(null);
  }, [markDone]);

  const restart = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 忽略
    }
    setStep(0);
  }, []);

  const value: TutorialContextValue = useMemo(
    () => ({ step, total: TUTORIAL_TOTAL, next, skip, restart }),
    [step, next, skip, restart],
  );

  return createElement(TutorialContext.Provider, { value }, children);
}

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorial() 必须在 <TutorialProvider> 内使用');
  return ctx;
}

/* ------------------------------------------------------------------ */
/* 步骤定义（常量，与 UI 组件解耦）                                     */
/* ------------------------------------------------------------------ */

/**
 * 每一步的"目标元素"。用 data-tutorial 属性在目标 DOM 上标记，
 * 引导层据此 querySelector 拿位置画高亮。
 */
export interface TutorialStep {
  /** 步骤 i18n key 后缀：tutorial.step.<key>.text / .title */
  key: 'welcome' | 'skills' | 'start' | 'progress' | 'harvest';
  /** data-tutorial 属性值；null 表示不关联具体元素（只看文本） */
  target: string | null;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { key: 'welcome', target: null },
  { key: 'skills', target: 'skills' },
  { key: 'start', target: 'start' },
  { key: 'progress', target: 'progress' },
  { key: 'harvest', target: 'harvest' },
];

export const TUTORIAL_TOTAL = TUTORIAL_STEPS.length;
