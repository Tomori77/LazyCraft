import { useState, type DragEvent } from 'react';
import { useT } from '../i18n/index.ts';
import { toQualityClass } from '../lib/quality.ts';
import { Icon } from '../icons/icon.tsx';
import { slotIconName, templateIconName } from '../icons/resolve-icon.ts';
import type { EquipmentInstance, EquipmentSlot, EquipmentSlotMeta } from '@lazycraft/shared';
import type { EquipCheckResult } from '../equipment/equip-rules.ts';

/**
 * 单个装备槽位（拖拽落点），贴人体图左右两列、按 top 百分比定位。
 *
 * 为什么列/高度由父级算好传入？
 *   排布是"人体图布局规则"，随定稿原型变化；槽位组件只管渲染与交互，
 *   不内置任何部位坐标，DLC 增删槽位时这里无需改。
 */
interface EquipmentSlotViewProps {
  slotMeta: EquipmentSlotMeta;
  col: 'left' | 'right';
  top: string;
  item: EquipmentInstance | null;
  draggedItem: EquipmentInstance | null;
  canEquipStatus: EquipCheckResult | null;
  onDropItem: (uid: string, slot: EquipmentSlot) => void;
  onUnequip: (slot: EquipmentSlot) => void;
}

export function EquipmentSlotView({
  slotMeta,
  col,
  top,
  item,
  draggedItem,
  canEquipStatus,
  onDropItem,
  onUnequip,
}: EquipmentSlotViewProps) {
  const { t } = useT();
  const [isOver, setIsOver] = useState(false);

  const slotTitle = t(`slot.${slotMeta.id}`);
  const isDropTargetActive = draggedItem !== null;
  const isAllowed = canEquipStatus?.ok ?? false;

  let stateClass = '';
  if (isDropTargetActive) stateClass = isAllowed ? 'is-drop' : 'is-reject';
  else if (isOver) stateClass = 'is-drop';

  const qualityClass = item ? toQualityClass(item.quality) : '';
  const iconName = item
    ? templateIconName(item.template_id).startsWith('item.')
      ? slotIconName(item.slot)
      : templateIconName(item.template_id)
    : slotIconName(slotMeta.id);

  return (
    <div
      className={`slot-abs col-${col} ${stateClass} ${item ? `has ${qualityClass}` : ''}`}
      style={{ top }}
      title={
        !isAllowed && draggedItem && canEquipStatus?.reasonKey
          ? t(canEquipStatus.reasonKey)
          : item
            ? item.display_name
            : slotTitle
      }
      onDragOver={(e: DragEvent) => {
        if (isAllowed) {
          e.preventDefault();
          setIsOver(true);
        }
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setIsOver(false);
        if (!isAllowed) return;
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw) as { uid?: string };
          if (parsed.uid) onDropItem(parsed.uid, slotMeta.id);
        } catch {
          // 非本应用拖拽负载：忽略，不改变本地视图
        }
      }}
      onContextMenu={(e) => {
        // 右键卸下；空槽无需处理
        e.preventDefault();
        if (item) onUnequip(slotMeta.id);
      }}
    >
      {item ? (
        <div className="equipped">
          <Icon name={iconName} size={20} />
        </div>
      ) : (
        <span className="ic-20" aria-hidden="true">
          <Icon name={slotIconName(slotMeta.id)} size={20} />
        </span>
      )}
      <span className="lbl">{item ? item.display_name : slotTitle}</span>
    </div>
  );
}
