import { useMemo, useState } from 'react';
import { SKILLS, ACTIONS, levelFromExp, exp } from '@lazycraft/shared';
import type { SkillAction } from '@lazycraft/shared';
import { useT } from '../i18n/index.ts';
import { useAction } from '../action/action-context.tsx';

/**
 * 左栏：技能列表 + 点击展开动作列表
 *
 * 为什么一个组件同时管技能和动作？
 *   两者强耦合（动作必须依附于选中的技能），分开会让 props 在左栏
 *   组件树里反复透传。放在一个组件内，选择状态天然就是一个局部 useState。
 *
 * 为什么等级用 levelFromExp 直接从经验推，而不是把 level 缓存进存档？
 *   服务器权威 + 单一事实源：等级是经验的派生量，缓存放客户端必然导致
 *   "经验已结算、等级还旧"的不一致窗口。共享包的 levelFromExp 是 O(1)
 *   纯函数，每次渲染直接算，永远一致。
 */

/** 当前等级进度（0..1）：到下一级还差多少 */
function levelProgress(experience: number): number {
  const level = levelFromExp(experience);
  const floor = exp(level);
  const ceil = exp(level + 1);
  if (ceil <= floor) return 1;
  return (experience - floor) / (ceil - floor);
}

interface SkillPanelProps {
  /** 已选中的技能 id；父组件用它在中栏渲染对应动作 */
  selectedSkillId: string | null;
  onSelectSkill: (skillId: string) => void;
}

export function SkillPanel({ selectedSkillId, onSelectSkill }: SkillPanelProps) {
  const { t } = useT();
  const { skillExp, active, pending, start } = useAction();
  const [localError, setLocalError] = useState<string | null>(null);

  /** 当前选中技能的动作列表 */
  const actionsOfSelected: SkillAction[] = useMemo(() => {
    if (!selectedSkillId) return [];
    return ACTIONS.filter((a) => a.skill_id === selectedSkillId);
  }, [selectedSkillId]);

  const selectedLevel = selectedSkillId ? levelFromExp(skillExp[selectedSkillId] ?? 0) : 0;

  const handleStart = async (action: SkillAction) => {
    setLocalError(null);
    try {
      await start(action.skill_id, action.id);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : '操作失败');
    }
  };

  return (
    <div className="skill-panel">
      <h2>{t('nav.skills')}</h2>
      <ul className="skill-list">
        {SKILLS.map((skill) => {
          const expVal = skillExp[skill.id] ?? 0;
          const level = levelFromExp(expVal);
          const progress = levelProgress(expVal);
          const isSelected = skill.id === selectedSkillId;
          return (
            <li key={skill.id}>
              <button
                type="button"
                className={`skill-row${isSelected ? ' is-selected' : ''}`}
                onClick={() => onSelectSkill(skill.id)}
                aria-pressed={isSelected}
              >
                <span className="skill-icon" aria-hidden="true">
                  {/* 无图标资源时回退首字母，与 shared 包 AbstractResource.icon 缺省策略一致 */}
                  {skill.name.charAt(0)}
                </span>
                <span className="skill-info">
                  <span className="skill-name">{t(`skill.${skill.id}.name`)}</span>
                  <span className="skill-meta">
                    <span className="skill-level">
                      {t('skills.level')} {level}
                    </span>
                    <span className="skill-exp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                      <span className="skill-exp-fill" style={{ width: `${progress * 100}%` }} />
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selectedSkillId && (
        <section className="action-list" aria-label={t(`skill.${selectedSkillId}.name`)}>
          <h3>{t(`skill.${selectedSkillId}.name`)}</h3>
          {actionsOfSelected.length === 0 ? (
            <p className="action-empty">{t('actions.empty')}</p>
          ) : (
            <ul>
              {actionsOfSelected.map((action) => {
                const locked = selectedLevel < action.required_level;
                const isActive = active?.action_id === action.id;
                const disabled = pending || locked || (active !== null && !isActive);
                return (
                  <li key={action.id} className={`action-row${isActive ? ' is-active' : ''}`}>
                    <div className="action-info">
                      <div className="action-name">{t(`action.${action.id}.name`)}</div>
                      <div className="action-meta">
                        <span>
                          {t('actions.interval')}: {(action.interval_ms / 1000).toFixed(1)}
                          {t('common.seconds')}
                        </span>
                        {Object.keys(action.output_items).length > 0 && (
                          <span>
                            {t('actions.outputs')}:
                            {Object.entries(action.output_items)
                              .map(([itemId, qty]) => ` ${t(`item.${itemId}.name`)}×${qty}`)
                              .join(', ')}
                          </span>
                        )}
                        {Object.keys(action.input_items).length > 0 && (
                          <span>
                            {t('actions.inputs')}:
                            {Object.entries(action.input_items)
                              .map(([itemId, qty]) => ` ${t(`item.${itemId}.name`)}×${qty}`)
                              .join(', ')}
                          </span>
                        )}
                        <span className={locked ? 'action-locked' : undefined}>
                          {t('actions.required_level')}: {action.required_level}
                          {locked ? ` (${t('actions.locked')})` : ''}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="action-start"
                      disabled={disabled}
                      onClick={() => handleStart(action)}
                    >
                      {isActive ? t('actions.in_progress') : t('actions.start')}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {localError && <p className="action-error">{localError}</p>}
        </section>
      )}
    </div>
  );
}
