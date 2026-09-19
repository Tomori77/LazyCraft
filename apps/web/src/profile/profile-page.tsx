import { useMemo, useState } from 'react';
import { sumEquipmentStats, type EquipmentInstance, type EquipmentSlot } from '@lazycraft/shared';
import { useT } from '../i18n/index.ts';
import { useContent } from '../content/content-context.tsx';
import { usePlayer } from '../player/player-context.tsx';
import { canEquipClient } from '../equipment/equip-rules.ts';
import { EquipmentSlotView } from './equipment-slot.tsx';

/**
 * 个人信息悬浮页：人体图 + 槽位 + 属性汇总。
 *
 * 槽位排布：按 anchor 分四组，组内按 order 排序后赋"组内序号"，
 *   用 --slot-order 交给 CSS 算纵向/横向偏移——同一 anchor 组不会重叠。
 * 拖拽：用 shared.canEquip 包装的 canEquipClient 决定高亮/置灰，落点调 /api/inventory/equip。
 */
interface ProfilePageProps {
  draggedItem: EquipmentInstance | null;
  onClose: () => void;
}

export function ProfilePage({ draggedItem, onClose }: ProfilePageProps) {
  const { t } = useT();
  const { content } = useContent();
  const { player, equipItem, unequipItem } = usePlayer();
  const [actionError, setActionError] = useState<string | null>(null);

  const slotsMeta = useMemo(() => {
    const slots = [...(content?.equipmentSlots ?? [])].sort((a, b) => a.order - b.order);
    // 同一 anchor 的槽位按 order 排列，计算"居中后的相对偏移"（如 3 个槽 → -1/0/1）；
    // CSS 用该偏移乘步长铺开：top/bottom 组横向排列、left/right 组纵向排列，互不遮挡。
    const counts: Record<string, number> = {};
    for (const slot of slots) counts[slot.anchor] = (counts[slot.anchor] ?? 0) + 1;
    const seen: Record<string, number> = {};
    return slots.map((slot) => {
      const index = seen[slot.anchor] ?? 0;
      seen[slot.anchor] = index + 1;
      const offset = index - (counts[slot.anchor] - 1) / 2;
      return { ...slot, offset };
    });
  }, [content]);

  const totalStats = useMemo(
    () => sumEquipmentStats(Object.values(player?.equipment ?? {})),
    [player],
  );

  const playerLevel = player?.level ?? 1;

  // 失败时不调用 refreshPlayer，本地视图原样保留；错误内联展示（不用 alert 打断）
  const handleDrop = async (uid: string, slot: EquipmentSlot) => {
    setActionError(null);
    try {
      await equipItem(uid, slot);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('equip.reason.slot_mismatch'));
    }
  };

  const handleUnequip = async (slot: EquipmentSlot) => {
    setActionError(null);
    try {
      await unequipItem(slot);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('inventory.full'));
    }
  };

  return (
    <div className="profile-page-container">
      <div className="profile-header">
        <div className="profile-header-title">
          <h2>{t('profile.title')}</h2>
          <button type="button" className="btn-close-overlay" onClick={onClose} aria-label={t('common.cancel')}>
            ✕
          </button>
        </div>
        <div className="profile-user-summary">
          <span className="user-name">{player?.name ?? ''}</span>
          <span className="user-level">
            {t('skills.level')} {playerLevel}
          </span>
        </div>

        <div className="profile-resources-detail">
          {Object.entries(player?.abstract_resources ?? {}).map(([resId, value]) => (
            <span key={resId} className="resource-pill">
              {t(`resource.${resId}.name`)}: {value.toLocaleString()}
            </span>
          ))}
        </div>
        {actionError && <p className="profile-error">{actionError}</p>}
      </div>

      <div className="profile-body">
        <div className="body-structure-wrapper">
          <div className="body-silhouette-canvas">
            <svg viewBox="0 0 100 200" className="body-svg" aria-hidden="true">
              <circle cx="50" cy="25" r="15" fill="#374151" />
              <line x1="50" y1="40" x2="50" y2="120" stroke="#374151" strokeWidth="6" />
              <line x1="50" y1="60" x2="15" y2="100" stroke="#374151" strokeWidth="5" />
              <line x1="50" y1="60" x2="85" y2="100" stroke="#374151" strokeWidth="5" />
              <line x1="50" y1="120" x2="30" y2="185" stroke="#374151" strokeWidth="6" />
              <line x1="50" y1="120" x2="70" y2="185" stroke="#374151" strokeWidth="6" />
            </svg>
          </div>

          <div className="body-slots-overlay">
            {slotsMeta.map((slotMeta) => {
              const current = player?.equipment?.[slotMeta.id] ?? null;
              const status = draggedItem ? canEquipClient(draggedItem, slotMeta.id, playerLevel) : null;
              return (
                <EquipmentSlotView
                  key={slotMeta.id}
                  slotMeta={slotMeta}
                  offset={slotMeta.offset}
                  item={current}
                  draggedItem={draggedItem}
                  canEquipStatus={status}
                  onDropItem={handleDrop}
                  onUnequip={handleUnequip}
                />
              );
            })}
          </div>
        </div>

        <div className="profile-stats-sidebar">
          <h3>{t('profile.stats')}</h3>
          <div className="stats-list">
            <div className="stat-row">
              <span className="stat-label">{t('profile.stat.attack')}</span>
              <span className="stat-val">+{totalStats.attack}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">{t('profile.stat.defense')}</span>
              <span className="stat-val">+{totalStats.defense}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">{t('profile.stat.hp')}</span>
              <span className="stat-val">+{totalStats.hp}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
