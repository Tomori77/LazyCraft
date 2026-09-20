import { useMemo, useState } from 'react';
import { exp } from '@lazycraft/shared';
import { useT } from '../i18n/index.ts';
import { useContent } from '../content/content-context.tsx';
import { usePlayer } from '../player/player-context.tsx';
import { useAction } from '../action/action-context.tsx';
import { WorkCard } from './work-card.tsx';

/**
 * 中栏工作面板：技能标题 → 动态 tier 页签 → 工作卡片横排。
 *
 * 进度条已下沉到「进行中的卡片内部」（P2-8），本组件只负责把
 * progressRef 透传给卡片；开始/停止按钮也移到卡片页脚，符合原型定稿。
 */
interface WorkPanelProps {
  selectedSkillId: string | null;
}

export function WorkPanel({ selectedSkillId }: WorkPanelProps) {
  const { t } = useT();
  const { content } = useContent();
  const { player } = usePlayer();
  const { active, pending, progressRef, start, stop, stopReason } = useAction();

  const currentSkill = useMemo(
    () => content?.skills?.find((s) => s.id === selectedSkillId) ?? null,
    [content, selectedSkillId],
  );

  const actions = useMemo(() => {
    if (!selectedSkillId || !content?.actions) return [];
    return content.actions.filter((a) => a.skill_id === selectedSkillId);
  }, [content, selectedSkillId]);

  // tier 页签由该技能下 action.tier 的去重升序集合动态生成
  const tiers = useMemo(() => {
    const set = new Set(actions.map((a) => a.tier));
    return Array.from(set).sort((a, b) => a - b);
  }, [actions]);

  // 用户显式选择的 tier；非法/未选时在渲染期兜底到首个合法值，
  // 不用 effect 回写 state（切换技能后旧 tier 自动失效）
  const [selectedTier, setSelectedTier] = useState<number | null>(null);
  const activeTier = selectedTier !== null && tiers.includes(selectedTier) ? selectedTier : tiers[0] ?? null;

  const [localError, setLocalError] = useState<string | null>(null);

  const filteredActions = useMemo(
    () => (activeTier === null ? actions : actions.filter((a) => a.tier === activeTier)),
    [actions, activeTier],
  );

  const skillData = selectedSkillId ? player?.skills?.[selectedSkillId] : null;
  const currentLevel = skillData?.level ?? 1;
  const currentExp = skillData?.exp ?? 0;
  // 当前等级段内的经验进度：exp(level+1) - exp(level) 为分母
  const levelFloor = exp(currentLevel);
  const levelSpan = exp(currentLevel + 1) - levelFloor;
  const xpFraction = levelSpan > 0 ? Math.min(1, Math.max(0, currentExp - levelFloor) / levelSpan) : 0;

  const run = async (fn: () => Promise<void>) => {
    setLocalError(null);
    try {
      await fn();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : t('error.action_failed'));
    }
  };

  if (!selectedSkillId || !currentSkill) {
    return (
      <div className="work-panel-placeholder">
        <p>{t('actions.pick_skill')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="work-head">
        <div className="work-head-top">
          <h2>{t(`skill.${currentSkill.id}.name`)}</h2>
          <span className="lv">
            {t('skills.level')} {currentLevel}
          </span>
        </div>
        <div className="xp-row">
          <div className="xp-track">
            <div className="xp-fill" style={{ width: `${(xpFraction * 100).toFixed(1)}%` }} />
          </div>
          <span className="xp-num">
            {currentExp.toLocaleString()} / {exp(currentLevel + 1).toLocaleString()} {t('skills.exp_progress')}
          </span>
        </div>
      </div>

      {tiers.length > 0 && (
        <div className="tabs" role="tablist">
          {tiers.map((tier) => {
            const isTabActive = tier === activeTier;
            return (
              <button
                key={tier}
                type="button"
                role="tab"
                aria-selected={isTabActive}
                className={`tab ${isTabActive ? 'is-active' : ''}`}
                onClick={() => setSelectedTier(tier)}
              >
                {t(`work.tier.${tier}`)}
              </button>
            );
          })}
        </div>
      )}

      <div className="cards">
        {filteredActions.map((action) => (
          <WorkCard
            key={action.id}
            action={action}
            skillLevel={currentLevel}
            isActive={active?.action_id === action.id}
            onStart={() => void run(() => start(action.skill_id, action.id, action.interval_ms))}
            onStop={() => void run(stop)}
            pending={pending}
            progressRef={progressRef}
          />
        ))}
      </div>

      {stopReason === 'input_exhausted' && (
        <p className="work-panel-error">{t('work.auto_stop.input_exhausted')}</p>
      )}
      {stopReason === 'inventory_full' && (
        <p className="work-panel-error">{t('work.auto_stop.inventory_full')}</p>
      )}
      {localError && <p className="work-panel-error">{localError}</p>}
    </>
  );
}
