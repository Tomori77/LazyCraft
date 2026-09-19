import { useState, type DragEvent } from 'react';
import { useT } from '../i18n/index.ts';
import { toQualityClass } from '../lib/quality.ts';
import { stackQuality, type CarriedItem, type EquipmentInstance } from '@lazycraft/shared';

/**
 * 背包与仓库共用的物品网格。
 *
 * - 装备实例：品质描边、可拖拽（拖到装备槽穿戴，或拖到另一容器移动）；
 * - 堆叠物：显示数量、同样可拖拽移动；
 * - 悬停显示详情。
 *
 * 为什么用原生 HTML5 DnD？
 *   项目未引拖拽库，05 §6 明确"保持不加依赖为默认"；DnD 的 dataTransfer
 *   足以在格子与槽位之间传递 uid + 来源容器。
 */
interface InventoryGridProps {
  items: CarriedItem[];
  capacity: number;
  containerType: 'inventory' | 'storage';
  searchQuery: string;
  onDragStartItem: (item: CarriedItem) => void;
  onDragEndItem: () => void;
  /** 从另一个容器拖入本容器：落点调用 /api/inventory/move */
  onDropFromOther: (uid: string, from: 'inventory' | 'storage') => void;
}

export function InventoryGrid({
  items,
  capacity,
  containerType,
  searchQuery,
  onDragStartItem,
  onDragEndItem,
  onDropFromOther,
}: InventoryGridProps) {
  const { t } = useT();
  const [hovered, setHovered] = useState<CarriedItem | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropActive(false);
    try {
      const parsed = JSON.parse(e.dataTransfer.getData('text/plain')) as {
        uid?: string;
        from?: string;
      };
      if (parsed.uid && (parsed.from === 'inventory' || parsed.from === 'storage') && parsed.from !== containerType) {
        onDropFromOther(parsed.uid, parsed.from);
      }
    } catch {
      // 非本应用拖拽负载（外部文本等）：忽略，不改变容器
    }
  };

  const query = searchQuery.trim().toLowerCase();
  const filtered = items.filter((item) => {
    const name = item.kind === 'equipment' ? item.display_name : t(`item.${item.item_id}.name`);
    return query === '' || name.toLowerCase().includes(query);
  });

  // 空格子补齐到容量，保持网格形状稳定
  const slots: (CarriedItem | null)[] = Array.from({ length: capacity }, (_, i) => filtered[i] ?? null);

  return (
    <div
      className={`inventory-grid-wrapper ${dropActive ? 'is-drop-target' : ''}`}
      onDragOver={(e) => {
        // dragover 阶段读不到 dataTransfer 内容，只能一律显示落点；
        // 同容器拖放由 handleDrop 的 from !== containerType 判空（无副作用）
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={handleDrop}
    >
      <div className="inventory-grid">
        {slots.map((item, index) => {
          if (!item) {
            return <div key={`empty-${index}`} className="grid-slot is-empty" />;
          }
          const isEquipment = item.kind === 'equipment';
          const qualityClass = isEquipment ? toQualityClass(item.quality) : toQualityClass(stackQuality(item));
          return (
            <div
              key={item.uid}
              className={`grid-slot has-item ${qualityClass}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ uid: item.uid, from: containerType }));
                e.dataTransfer.effectAllowed = 'move';
                onDragStartItem(item);
              }}
              onDragEnd={onDragEndItem}
              onMouseEnter={() => setHovered(item)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="slot-icon" aria-hidden="true">
                {isEquipment ? item.display_name.charAt(0) : t(`item.${item.item_id}.name`).charAt(0)}
              </span>
              {!isEquipment && <span className="slot-quantity">{item.quantity}</span>}
            </div>
          );
        })}
      </div>

      {hovered && (
        <div className="item-popover">
          {hovered.kind === 'equipment' ? (
            <EquipmentPopover item={hovered} />
          ) : (
            <div>
              <div className="popover-name">{t(`item.${hovered.item_id}.name`)}</div>
              <div className="popover-meta">
                {t('inventory.quantity')}: {hovered.quantity}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 装备详情：名称按品质着色 + 槽位 + 门槛 + 属性快照 */
function EquipmentPopover({ item }: { item: EquipmentInstance }) {
  const { t } = useT();
  return (
    <div>
      <div className={`popover-name ${toQualityClass(item.quality)}`}>{item.display_name}</div>
      <div className="popover-meta">
        <span>{t(`slot.${item.slot}`)}</span> | <span>{t('work.card.level')}: {item.required_level}</span>
      </div>
      <div className="popover-stats">
        {item.final_stats.attack !== 0 && (
          <div>
            {t('profile.stat.attack')} {item.final_stats.attack > 0 ? '+' : ''}
            {item.final_stats.attack}
          </div>
        )}
        {item.final_stats.defense !== 0 && (
          <div>
            {t('profile.stat.defense')} {item.final_stats.defense > 0 ? '+' : ''}
            {item.final_stats.defense}
          </div>
        )}
        {item.final_stats.hp !== 0 && (
          <div>
            {t('profile.stat.hp')} {item.final_stats.hp > 0 ? '+' : ''}
            {item.final_stats.hp}
          </div>
        )}
      </div>
    </div>
  );
}
