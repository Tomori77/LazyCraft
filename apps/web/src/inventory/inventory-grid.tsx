import { useState, type CSSProperties, type DragEvent } from 'react';
import { stackQuality, type CarriedItem, type EquipmentInstance } from '@lazycraft/shared';
import { useT } from '../i18n/index.ts';
import { toQualityClass } from '../lib/quality.ts';
import { Icon } from '../icons/icon.tsx';
import { itemIconName, slotIconName, templateIconName } from '../icons/resolve-icon.ts';

/**
 * 空容器的保底格数：即使没有任何物品也画出这么多格，保证拖放有落点。
 * 为什么不按 capacity 全量画格（背包 100 / 仓库 500）？
 *   每次结算刷新（约每秒）都要重渲染，凭空多出 600 个空 div 是纯浪费；
 *   只画"全部物品 + 一行空格"既让容器可滚动、又不丢任何物品，
 *   真实容量与已用数由外部 used/capacity 文案如实展示。
 */
const MIN_SLOTS = 10;
const FILLER_SLOTS = 5;

/**
 * 背包与仓库共用的物品网格（匠人工坊版）。
 *
 * 每格：图标居中，名字贴格内底边（稀有度颜色），数量在右上角；
 * 品质加由上到下渐变底色，普通不额外染色只描边。
 *
 * 为什么用原生 HTML5 DnD？
 *   项目未引拖拽库，05 §6 明确"保持不加依赖为默认"；dataTransfer
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

/** 装备图标优先按模板映射，未收录再按槽位兜底 */
function equipmentIconName(item: EquipmentInstance): string {
  const byTemplate = templateIconName(item.template_id);
  return byTemplate.startsWith('item.') ? slotIconName(item.slot) : byTemplate;
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
  // 详情浮层用 fixed 定位并收敛到视口内：右栏窄、格子靠底，就地展开会被裁
  const [popoverPos, setPopoverPos] = useState<CSSProperties>({});
  const [dropActive, setDropActive] = useState(false);

  const openPopover = (item: CarriedItem, rect: DOMRect) => {
    setHovered(item);
    setPopoverPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 218)),
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 180)),
    });
  };

  const displayName = (item: CarriedItem): string =>
    item.kind === 'equipment' ? item.display_name : t(`item.${item.item_id}.name`);

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
  const filtered = items.filter((item) => query === '' || displayName(item).toLowerCase().includes(query));

  // 全部物品都进 DOM（不再截断、不再有 +N），后面只补一小截空格供拖放；
  // capacity 用来收口空格数量，但下限永远不截掉真实物品（不丢件优先）
  const slotCount = Math.max(
    filtered.length,
    Math.min(Math.max(filtered.length + FILLER_SLOTS, MIN_SLOTS), Math.max(capacity, 0)),
  );
  const slots: (CarriedItem | null)[] = Array.from(
    { length: slotCount },
    (_, i) => filtered[i] ?? null,
  );

  return (
    <div
      className="inventory-grid-wrapper"
      onDragOver={(e) => {
        // dragover 阶段读不到 dataTransfer 内容，只能一律显示落点；
        // 同容器拖放由 handleDrop 的 from !== containerType 判空（无副作用）
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={handleDrop}
    >
      <div className={`mini-grid ${dropActive ? 'is-drop' : ''}`}>
        {slots.map((item, index) => {
          if (!item) {
            return <div key={`empty-${index}`} className="slot" />;
          }
          const isEquipment = item.kind === 'equipment';
          const qualityClass = isEquipment ? toQualityClass(item.quality) : toQualityClass(stackQuality(item));
          const name = displayName(item);
          return (
            <div
              key={item.uid}
              className={`slot has ${qualityClass}`}
              draggable
              title={name}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ uid: item.uid, from: containerType }));
                e.dataTransfer.effectAllowed = 'move';
                onDragStartItem(item);
              }}
              onDragEnd={onDragEndItem}
              onMouseEnter={(e) => openPopover(item, e.currentTarget.getBoundingClientRect())}
              onMouseLeave={() => setHovered(null)}
            >
              <Icon
                name={isEquipment ? equipmentIconName(item) : itemIconName(item.item_id)}
                size={26}
                fallback={name.charAt(0)}
              />
              {!isEquipment && item.quantity > 1 && <span className="qty">{item.quantity}</span>}
              <span className="it-name">{name}</span>
            </div>
          );
        })}
      </div>

      {hovered && (
        <div className="item-popover" style={popoverPos}>
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
