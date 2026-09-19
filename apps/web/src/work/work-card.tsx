import { useT } from '../i18n/index.ts';
import type { SkillAction } from '@lazycraft/shared';

/**
 * 长方形工作卡片：从左到右横排，信息完整（等级/间隔/经验/产出）。
 *
 * 状态：可做 / 等级不足（置灰）/ 进行中（高亮）。点击卡片 = 选中。
 */
interface WorkCardProps {
  action: SkillAction;
  skillLevel: number;
  isSelected: boolean;
  isActive: boolean;
  onSelect: () => void;
}

export function WorkCard({ action, skillLevel, isSelected, isActive, onSelect }: WorkCardProps) {
  const { t } = useT();
  const isLocked = skillLevel < action.required_level;
  const intervalSec = (action.interval_ms / 1000).toFixed(1);
  const outputs = Object.entries(action.output_items);

  return (
    <div
      className={`work-card ${isSelected ? 'is-selected' : ''} ${isLocked ? 'is-locked' : ''} ${
        isActive ? 'is-active' : ''
      }`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
    >
      <div className="work-card-header">
        <span className="work-card-icon" aria-hidden="true">
          {action.icon || action.name.charAt(0)}
        </span>
        <div className="work-card-titles">
          <span className="work-card-name">{t(`action.${action.id}.name`)}</span>
          <span className="work-card-req">
            {t('work.card.level')}: {action.required_level}
          </span>
        </div>
      </div>

      <div className="work-card-body">
        <div className="work-card-stat">
          {intervalSec}s / {action.exp} {t('work.card.exp')}
        </div>

        {outputs.length > 0 && (
          <div className="work-card-yield">
            <span className="yield-label">{t('work.card.yield')}:</span>
            {outputs.map(([itemId, qty]) => (
              <span key={itemId} className="yield-tag">
                {t(`item.${itemId}.name`)} ×{qty}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="work-card-footer">
        {isLocked ? (
          <span className="badge-locked">{t('actions.locked')}</span>
        ) : isActive ? (
          <span className="badge-active">{t('work.in_progress')}</span>
        ) : null}
      </div>
    </div>
  );
}
