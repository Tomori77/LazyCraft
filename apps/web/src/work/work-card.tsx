import { useEffect, useRef, type MutableRefObject } from 'react';
import { useT } from '../i18n/index.ts';
import { Icon } from '../icons/icon.tsx';
import { actionIconName } from '../icons/resolve-icon.ts';
import { YieldChips } from './yield-chips.tsx';
import type { SkillAction } from '@lazycraft/shared';

/**
 * 长方形工作卡片：从左到右横排，信息完整（等级/间隔/经验/产出）。
 *
 * P2-8：进度条下沉到"进行中的那张卡片内部"（进行中才显示）。
 *   进度机制仍是 ActionProvider 的 rAF + 服务器时间戳，本组件只做
 *   `progressRef` → DOM 的搬运工，不自行推算 tick。
 */
interface WorkCardProps {
  action: SkillAction;
  skillLevel: number;
  isActive: boolean;
  onStart: () => void;
  onStop: () => void;
  pending: boolean;
  /** 进行中时由父级传入 progressRef，卡片内自绘进度 */
  progressRef?: MutableRefObject<number>;
}

export function WorkCard({
  action,
  skillLevel,
  isActive,
  onStart,
  onStop,
  pending,
  progressRef,
}: WorkCardProps) {
  const { t } = useT();
  const isLocked = skillLevel < action.required_level;
  const intervalSec = (action.interval_ms / 1000).toFixed(1);
  const outputs = Object.entries(action.output_items);

  const barRef = useRef<HTMLDivElement | null>(null);

  // 只有进行中的卡片才跑 rAF；其余卡片 ref 为空，循环体是空操作
  useEffect(() => {
    if (!isActive || !progressRef) return;
    let handle = 0;
    const step = () => {
      if (barRef.current) barRef.current.style.transform = `scaleX(${progressRef.current})`;
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [isActive, progressRef]);

  return (
    <div className={`wcard ${isActive ? 'is-selected' : ''} ${isLocked ? 'is-locked' : ''}`}>
      <div className="wcard-row1">
        <span className="wcard-ico" aria-hidden="true">
          <Icon name={actionIconName(action)} size={16} fallback={t(`action.${action.id}.name`).charAt(0)} />
        </span>
        <div>
          <div className="wcard-name">{t(`action.${action.id}.name`)}</div>
          <div className="wcard-req">
            {t('work.card.level')} {action.required_level}
          </div>
        </div>
      </div>

      <div className="wcard-stats">
        <span className="pill">{intervalSec}s</span>
        <span className="pill">
          {action.exp} {t('work.card.exp')}
        </span>
      </div>

      {outputs.length > 0 && <YieldChips outputs={outputs} />}

      {isActive && (
        <div className="wcard-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100}>
          <div ref={barRef} className="bar" />
        </div>
      )}

      <div className="wcard-foot" onClick={(e) => e.stopPropagation()}>
        {isLocked ? (
          <span className="locked-badge">{t('actions.locked')}</span>
        ) : isActive ? (
          <>
            <span className="wcard-status">
              <span className="pulse" />
              {t('work.in_progress')}
            </span>
            <button type="button" className="btn btn-sm" onClick={onStop} disabled={pending}>
              {t('work.stop')}
            </button>
          </>
        ) : (
          <>
            <span />
            <button type="button" className="btn btn-sm" onClick={onStart} disabled={pending}>
              {t('work.start')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
