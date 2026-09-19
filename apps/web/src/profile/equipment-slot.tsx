import { useState, type CSSProperties, type DragEvent } from 'react';
import { useT } from '../i18n/index.ts';
import { toQualityClass } from '../lib/quality.ts';
import type { EquipmentInstance, EquipmentSlot, EquipmentSlotMeta } from '@lazycraft/shared';
import type { EquipCheckResult } from '../equipment/equip-rules.ts';

/**
 * 单个装备槽位（拖拽落点）。
 *
 * 为什么把组内偏移映射成 --slot-offset 自定义属性？
 *   同一 anchor 组内有多个槽位（如 left 组有 main_hand/chest/hands）；
 *   若只贴边不错开就会完全重叠。父级算好居中后的相对偏移（-1/0/1），
 *   CSS 乘步长铺开——槽位数量/顺序随数据变化而自动排布。
 */
interface EquipmentSlotViewProps {
  slotMeta: EquipmentSlotMeta;
  /** 同 anchor 组内的居中相对偏移（-0.5 的倍数），驱动贴边错开 */
  offset: number;
  item: EquipmentInstance | null;
  draggedItem: EquipmentInstance | null;
  canEquipStatus: EquipCheckResult | null;
  onDropItem: (uid: string, slot: EquipmentSlot) => void;
  onUnequip: (slot: EquipmentSlot) => void;
}

export function EquipmentSlotView({
  slotMeta,
  offset,
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
  if (isDropTargetActive) stateClass = isAllowed ? 'slot-can-drop' : 'slot-cannot-drop';
  else if (isOver) stateClass = 'slot-hover';

  const qualityClass = item ? toQualityClass(item.quality) : '';

  return (
    <div
      className={`equip-slot anchor-${slotMeta.anchor} ${stateClass} ${item ? 'is-equipped' : 'is-empty'} ${qualityClass}`}
      style={{ '--slot-offset': offset } as CSSProperties}
      title={
        !isAllowed && draggedItem && canEquipStatus?.reasonKey
          ? t(canEquipStatus.reasonKey)
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
        <div className="slot-equipped-inner">
          <span className="slot-item-icon" aria-hidden="true">
            {item.display_name.charAt(0)}
          </span>
          <span className="slot-item-name">{item.display_name}</span>
        </div>
      ) : (
        <span className="slot-placeholder-label">{slotTitle}</span>
      )}
    </div>
  );
}
