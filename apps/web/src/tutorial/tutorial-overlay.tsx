import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/index.ts';
import { TUTORIAL_STEPS, useTutorial } from './tutorial-context.tsx';

/**
 * 引导层：高亮目标元素 + 提示气泡
 *
 * 视觉实现：
 *   - 全局半透明遮罩把玩家注意力聚焦到高亮目标；
 *   - 目标元素外圈用 outline 描边 + 脉冲动画；
 *   - 气泡固定出现在目标旁边（位置用 getBoundingClientRect 算）。
 *
 * 为什么用"描边"而不是"挖洞式遮罩"？
 *   挖洞需要 SVG mask 或 box-shadow 0 0 0 9999px 大阴影，实现复杂且
 *   对无障碍不友好（遮罩盖住了其它可交互元素）；描边只是"圈重点"，
 *   其它元素照常可点，符合"引导只是提示不是强制"的设计意图。
 *
 * 为什么数据属性（data-tutorial）而不是 ref 传递？
 *   引导层挂在 GameLayout 顶层，被引导的元素分散在三栏组件里；
 *   穿 ref 需要改写每个面板组件的 props 签名。data-attribute 天然解耦，
 *   组件只要在自己关心的根节点上加 data-tutorial="xxx" 即可。
 */

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function TutorialOverlay() {
  const { t } = useT();
  const { step, total, next, skip } = useTutorial();
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  // 当前步骤的配置
  const stepCfg = step !== null ? TUTORIAL_STEPS[step] : null;

  // 定位目标元素：data-tutorial 属性匹配
  useEffect(() => {
    if (!stepCfg?.target) {
      setTargetRect(null);
      return;
    }
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-tutorial="${stepCfg.target}"]`);
      if (!el) {
        setTargetRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setTargetRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    find();
    // 元素可能因布局变化而移动；resize 监听兜底
    window.addEventListener('resize', find);
    return () => window.removeEventListener('resize', find);
  }, [stepCfg]);

  if (step === null || !stepCfg) return null;

  const handleNext = () => {
    next();
  };

  return (
    <>
      {/* 半透明遮罩：只起聚焦作用，不阻断操作 */}
      <div className="tutorial-overlay" aria-hidden="true" onClick={handleNext} />
      {targetRect && (
        <div
          ref={highlightRef}
          className="tutorial-highlight"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }}
        />
      )}
      <aside
        className={`tutorial-bubble${targetRect ? ' is-anchored' : ''}`}
        role="dialog"
        aria-live="polite"
        aria-label={t(`tutorial.step.${stepCfg.key}.title`)}
        style={
          targetRect
            ? {
                top: targetRect.top + targetRect.height + 12,
                left: targetRect.left,
              }
            : undefined
        }
      >
        <header className="tutorial-head">
          <span className="tutorial-step-indicator">
            {step + 1}/{total}
          </span>
          <button type="button" className="tutorial-skip" onClick={skip}>
            {t('tutorial.skip')}
          </button>
        </header>
        <h3 className="tutorial-title">{t(`tutorial.step.${stepCfg.key}.title`)}</h3>
        <p className="tutorial-text">{t(`tutorial.step.${stepCfg.key}.text`)}</p>
        <div className="tutorial-actions">
          <button type="button" className="tutorial-next" onClick={handleNext}>
            {step + 1 === total ? t('tutorial.finish') : t('tutorial.next')}
          </button>
        </div>
      </aside>
    </>
  );
}
