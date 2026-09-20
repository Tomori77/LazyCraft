import { useMemo, useState } from 'react';
import { sumEquipmentStats, type EquipmentInstance, type EquipmentSlot } from '@lazycraft/shared';
import { useT } from '../i18n/index.ts';
import { useContent } from '../content/content-context.tsx';
import { usePlayer } from '../player/player-context.tsx';
import { canEquipClient } from '../equipment/equip-rules.ts';
import { Icon } from '../icons/icon.tsx';
import { resourceIconName } from '../icons/resolve-icon.ts';
import { EquipmentSlotView } from './equipment-slot.tsx';

/**
 * 个人信息悬浮页（匠人工坊定稿布局）：
 *   左 = 资源方片网格（占比大）；右上 = 人体图 + 贴部位的 10 槽位；右下 = 属性。
 *
 * 为什么槽位按"左右两列 + top 百分比"而不是 anchor 四组？
 *   定稿的人体图是竖长画布，10 个部位只有左右两列排布才不会互相遮挡；
 *   anchor 四组是为旧方块布局设计的，会在窄画布上重叠。
 *   部位→列/高度的映射属展示规则，未收录的槽位按左右交替兜底。
 *
 * 无竖向滚动条（P2-4）：整页用 flex/grid 撑满，资源区在极端多资源时才内部滚动
 *   （滚动条隐藏），人体图按可用高度等比缩放，不靠页面滚动。
 */
interface ProfilePageProps {
  draggedItem: EquipmentInstance | null;
  onClose: () => void;
}

/** 定稿槽位排布：左列（头/胸/主手/护腿/靴子）、右列（项链/副手/手套/戒指1/戒指2） */
const SLOT_LAYOUT: Readonly<Record<string, { col: 'left' | 'right'; top: string }>> = {
  head: { col: 'left', top: '11%' },
  chest: { col: 'left', top: '33%' },
  main_hand: { col: 'left', top: '47%' },
  legs: { col: 'left', top: '65%' },
  feet: { col: 'left', top: '89%' },
  neck: { col: 'right', top: '19%' },
  necklace: { col: 'right', top: '19%' },
  off_hand: { col: 'right', top: '40%' },
  hands: { col: 'right', top: '55%' },
  ring1: { col: 'right', top: '70%' },
  ring2: { col: 'right', top: '84%' },
};

export function ProfilePage({ draggedItem, onClose }: ProfilePageProps) {
  const { t } = useT();
  const { content } = useContent();
  const { player, equipItem, unequipItem } = usePlayer();
  const [actionError, setActionError] = useState<string | null>(null);

  const slots = useMemo(() => {
    const ordered = [...(content?.equipmentSlots ?? [])].sort((a, b) => a.order - b.order);
    return ordered.map((slotMeta, index) => {
      const place = SLOT_LAYOUT[slotMeta.id] ?? {
        col: index % 2 === 0 ? ('left' as const) : ('right' as const),
        top: `${Math.min(90, 12 + index * 8)}%`,
      };
      return { ...slotMeta, ...place };
    });
  }, [content]);

  const totalStats = useMemo(
    () => sumEquipmentStats(Object.values(player?.equipment ?? {})),
    [player],
  );

  const resources = useMemo(() => {
    if (!content?.abstractResources) return [];
    const sorted = [...content.abstractResources].sort((a, b) => a.tier - b.tier);
    return sorted.map((res) => ({
      id: res.id,
      icon: res.icon,
      value: player?.abstract_resources?.[res.id] ?? 0,
    }));
  }, [content, player]);

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
    <>
      <div className="ov-head">
        <h2>{t('profile.title')}</h2>
        <button type="button" className="ov-close" onClick={onClose} aria-label={t('common.cancel')}>
          <Icon name="ui.close" size={14} />
        </button>
      </div>

      <div className="overlay-body profile">
        {/* 左：资源明细 */}
        <div className="profile-left">
          <div className="profile-user">
            <div className="avatar" aria-hidden="true">
              {player?.name?.charAt(0) ?? ''}
            </div>
            <div>
              <div className="nm">{player?.name ?? ''}</div>
              <div className="lv">
                {t('skills.level')} {playerLevel}
              </div>
            </div>
          </div>

          <div className="section-label">{t('profile.resources')}</div>
          <div className="profile-res">
            {resources.map((res) => (
              <div key={res.id} className="res-card">
                <span className="ri" aria-hidden="true">
                  <Icon
                    name={resourceIconName(res.icon, res.id)}
                    size={20}
                    fallback={t(`resource.${res.id}.name`).charAt(0)}
                  />
                </span>
                <span className="rn">{t(`resource.${res.id}.name`)}</span>
                <span className="rv">{res.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
          {actionError && <p className="profile-error">{actionError}</p>}
        </div>

        {/* 右：上=人体图+装备，下=属性 */}
        <div className="profile-right">
          <div className="body-pane">
            <div className="body-figure">
              <svg viewBox="0 0 120 260" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                <circle cx="60" cy="28" r="17" fill="#d9c9ad" />
                <rect x="54" y="44" width="12" height="8" fill="#d9c9ad" />
                <rect x="50" y="50" width="20" height="74" rx="6" fill="#d9c9ad" />
                <rect x="26" y="56" width="11" height="66" rx="5" fill="#d9c9ad" />
                <rect x="83" y="56" width="11" height="66" rx="5" fill="#d9c9ad" />
                <rect x="42" y="124" width="13" height="104" rx="6" fill="#d9c9ad" />
                <rect x="65" y="124" width="13" height="104" rx="6" fill="#d9c9ad" />
                <rect x="40" y="228" width="17" height="12" rx="3" fill="#d9c9ad" />
                <rect x="63" y="228" width="17" height="12" rx="3" fill="#d9c9ad" />
              </svg>

              {slots.map((slotMeta) => {
                const current = player?.equipment?.[slotMeta.id] ?? null;
                const status = draggedItem ? canEquipClient(draggedItem, slotMeta.id, playerLevel) : null;
                return (
                  <EquipmentSlotView
                    key={slotMeta.id}
                    slotMeta={slotMeta}
                    col={slotMeta.col}
                    top={slotMeta.top}
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

          <div className="profile-attrs">
            <div>
              <div className="section-label">{t('profile.stats')}</div>
              <div className="stat-row">
                <span>{t('profile.stat.attack')}</span>
                <span className="v">+{totalStats.attack}</span>
              </div>
              <div className="stat-row">
                <span>{t('profile.stat.defense')}</span>
                <span className="v">+{totalStats.defense}</span>
              </div>
              <div className="stat-row">
                <span>{t('profile.stat.hp')}</span>
                <span className="v">+{totalStats.hp}</span>
              </div>
            </div>
            <div>
              <div className="section-label">{t('profile.affixes')}</div>
              <div className="affix-line">
                {Object.values(player?.equipment ?? {})
                  .filter((eq): eq is EquipmentInstance => eq !== null)
                  .map((eq) => eq.display_name)
                  .join(' · ') || t('profile.no_affix')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
