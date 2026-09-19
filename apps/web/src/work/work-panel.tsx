import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n/index.ts';
import { useContent } from '../content/content-context.tsx';
import { usePlayer } from '../player/player-context.tsx';
import { useAction } from '../action/action-context.tsx';
import { WorkCard } from './work-card.tsx';

/**
 * 中栏工作面板：技能标题 → 动态 tier 页签 → 工作卡片横排 → 底部当前工作进度。
 *
 * 进度条沿用现有 ActionProvider 的 rAF + 服务器时间戳机制：
 *   本组件只把 progressRef.current 写到 DOM，不自行推算 tick，也不自行滚动。
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

  // 用户显式选择的 tier；非法/未选时由下方 activeTier 在渲染期兜底到首个合法值，
  // 不用 effect 回写 state（切换技能后旧 tier 自动失效，无需额外同步）
  const [selectedTier, setSelectedTier] = useState<number | null>(null);
  const activeTier = selectedTier !== null && tiers.includes(selectedTier) ? selectedTier : tiers[0] ?? null;

  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const filteredActions = useMemo(
    () => (activeTier === null ? actions : actions.filter((a) => a.tier === activeTier)),
    [actions, activeTier],
  );

  // 选中动作：显式选中优先；否则取当前 tier 第一张；切换技能/分类后自然回退
  const selectedAction = useMemo(
    () =>
      actions.find((a) => a.id === selectedActionId && a.tier === activeTier) ??
      filteredActions[0] ??
      null,
    [actions, selectedActionId, activeTier, filteredActions],
  );

  const skillData = selectedSkillId ? player?.skills?.[selectedSkillId] : null;
  const currentLevel = skillData?.level ?? 1;
  const currentExp = skillData?.exp ?? 0;

  // 进度条：rAF 直接写 DOM，绕过 React 渲染管线（与 activity-panel 同机制）
  const fillRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const step = () => {
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${progressRef.current})`;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [progressRef]);

  const isCurrentActive = active !== null && selectedAction !== null && active.action_id === selectedAction.id;

  const handleStart = async () => {
    if (!selectedAction) return;
    setLocalError(null);
    try {
      await start(selectedAction.skill_id, selectedAction.id);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : '操作失败');
    }
  };

  const handleStop = async () => {
    setLocalError(null);
    try {
      await stop();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : '操作失败');
    }
  };

  if (!selectedSkillId || !currentSkill) {
    return (
      <div className="work-panel-placeholder">
        <p>{t('actions.pick_skill')}</p>
      </div>
    );
  }

  const canStart = !pending && selectedAction !== null && currentLevel >= selectedAction.required_level;

  return (
    <section className="work-panel-container">
      <div className="work-header">
        <div className="work-header-main">
          <h2>{t(`skill.${currentSkill.id}.name`)}</h2>
          <span className="work-header-level">
            {t('skills.level')} {currentLevel}
          </span>
        </div>
        <div className="work-header-xp">
          <span>
            {t('skills.exp_progress')}: {currentExp.toLocaleString()}
          </span>
        </div>
      </div>

      {tiers.length > 0 && (
        <div className="work-tabs" role="tablist">
          {tiers.map((tier) => {
            const isTabActive = tier === activeTier;
            return (
              <button
                key={tier}
                type="button"
                role="tab"
                aria-selected={isTabActive}
                className={`work-tab-btn ${isTabActive ? 'is-active' : ''}`}
                onClick={() => setSelectedTier(tier)}
              >
                {t(`work.tier.${tier}`)}
              </button>
            );
          })}
        </div>
      )}

      <div className="work-cards-grid">
        {filteredActions.map((action) => (
          <WorkCard
            key={action.id}
            action={action}
            skillLevel={currentLevel}
            isSelected={selectedAction?.id === action.id}
            isActive={active?.action_id === action.id}
            onSelect={() => setSelectedActionId(action.id)}
          />
        ))}
      </div>

      {selectedAction && (
        <div className="work-footer-section">
          <div className="work-footer-info">
            <span className="work-footer-name">
              {t('work.current')}: {t(`action.${selectedAction.id}.name`)}
            </span>
            <div className="work-footer-actions">
              {isCurrentActive ? (
                <button type="button" className="btn-stop" onClick={handleStop} disabled={pending}>
                  {t('work.stop')}
                </button>
              ) : (
                <button type="button" className="btn-start" onClick={handleStart} disabled={!canStart}>
                  {t('work.start')}
                </button>
              )}
            </div>
          </div>

          {/* aria-valuenow 不读 progressRef.current：rAF 直接写 DOM，渲染期读 ref 会被 React 判定为错误用法 */}
          <div className="work-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100}>
            <div ref={fillRef} className="work-progress-fill" />
          </div>

          {Object.keys(selectedAction.output_items).length > 0 && (
            <div className="work-preview-drops">
              <span className="preview-label">{t('work.drop_preview')}:</span>
              {Object.entries(selectedAction.output_items).map(([itemId, qty]) => (
                <span key={itemId} className="preview-tag">
                  {t(`item.${itemId}.name`)} ×{qty}
                </span>
              ))}
            </div>
          )}

          {/* 自动停止提示：材料耗尽 / 背包满由 settle-due 判定并回传 */}
          {stopReason === 'input_exhausted' && (
            <p className="work-panel-error">{t('work.auto_stop.input_exhausted')}</p>
          )}
          {stopReason === 'inventory_full' && (
            <p className="work-panel-error">{t('work.auto_stop.inventory_full')}</p>
          )}

          {localError && <p className="work-panel-error">{localError}</p>}
        </div>
      )}
    </section>
  );
}
