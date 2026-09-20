import { useMemo } from 'react';
import { useT } from '../i18n/index.ts';
import { useContent } from '../content/content-context.tsx';
import { usePlayer } from '../player/player-context.tsx';
import { Icon } from '../icons/icon.tsx';
import { skillIconName } from '../icons/resolve-icon.ts';
import type { Skill } from '@lazycraft/shared';

/**
 * 左栏技能导航（匠人工坊版）。
 *
 * 数据驱动：`GET /api/content` 的 skills，按 type 分战斗/非战斗两组，组内按 order 升序；
 * 点击只切换中栏内容，动作列表已移入中栏（work-panel）。
 */
interface SkillNavPanelProps {
  selectedSkillId: string | null;
  onSelectSkill: (skillId: string) => void;
}

export function SkillNavPanel({ selectedSkillId, onSelectSkill }: SkillNavPanelProps) {
  const { t } = useT();
  const { content } = useContent();
  const { player } = usePlayer();

  const { combatSkills, nonCombatSkills } = useMemo(() => {
    const combat: Skill[] = [];
    const nonCombat: Skill[] = [];
    // order 缺省按 id 兜底：数据只出数字，排序规则不写死在 UI 文案里
    const sorted = [...(content?.skills ?? [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
    );
    for (const skill of sorted) {
      (skill.type === 'combat' ? combat : nonCombat).push(skill);
    }
    return { combatSkills: combat, nonCombatSkills: nonCombat };
  }, [content]);

  const renderGroup = (skills: Skill[], titleKey: string) => {
    if (skills.length === 0) return null;
    return (
      <div className="skill-group">
        <div className="group-title">{t(titleKey)}</div>
        <ul className="skill-list">
          {skills.map((skill) => {
            const isSelected = skill.id === selectedSkillId;
            const level = player?.skills?.[skill.id]?.level ?? 1;
            return (
              <li key={skill.id}>
                <button
                  type="button"
                  className={`skill-item ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => onSelectSkill(skill.id)}
                  aria-pressed={isSelected}
                >
                  <span className="skill-ico" aria-hidden="true">
                    <Icon name={skillIconName(skill.id)} size={18} fallback={skill.name.charAt(0)} />
                  </span>
                  <span className="skill-meta">
                    <span className="skill-name">{t(`skill.${skill.id}.name`)}</span>
                    <span className="skill-level">
                      {t('skills.level')} {level}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <>
      <div className="sidebar-head">
        <h2>{t('nav.skills')}</h2>
      </div>
      {renderGroup(combatSkills, 'skill.type.combat')}
      {renderGroup(nonCombatSkills, 'skill.type.non_combat')}
    </>
  );
}
