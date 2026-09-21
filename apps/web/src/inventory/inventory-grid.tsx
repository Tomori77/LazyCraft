import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  stackQuality,
  type CarriedItem,
  type EquipmentInstance,
  type EquipmentSlot,
  type EquipmentSlotMeta,
} from '@lazycraft/shared';
import { useT } from '../i18n/index.ts';
import { toQualityClass } from '../lib/quality.ts';
import { Icon } from '../icons/icon.tsx';
import { itemIconName, slotIconName, templateIconName } from '../icons/resolve-icon.ts';
import { canEquipClient } from '../equipment/equip-rules.ts';
import { ItemDetail } from './item-detail.tsx';

/**
 * 空容器的保底格数：即使没有任何物品也画出这么多格，保证拖放有落点。
 * 为什么不按 capacity 全量画格（背包 100 / 仓库 500）？
 *   每次结算刷新（约每秒）都要重渲染，凭空多出 600 个空 div 是纯浪费；
 *   只画"全部物品 + 一行空格"既让容器可滚动、又不丢任何物品，
 *   真实容量与已用数由外部 used/capacity 文案如实展示。
 */
const MIN_SLOTS = 10;
const FILLER_SLOTS = 5;

type ContainerType = 'inventory' | 'storage';

/**
 * 背包与仓库共用的物品网格（匠人工坊版）。
 *
 * 每格：图标居中，名字贴格内底边（稀有度颜色），数量在右上角；
 * 品质加由上到下渐变底色，普通不额外染色只描边。
 *
 * 为什么用原生 HTML5 DnD？
 *   项目未引拖拽库，05 §6 明确"保持不加依赖为默认"；dataTransfer
 *   足以在格子与槽位之间传递 uid + 来源容器。
 *
 * 为什么不直接 usePlayer() 而走 props 回调？
 *   本组件同时被背包与仓库两处复用，两处"目标容器"不同（inventory/storage）；
 *   保持它与 Player context 解耦，容器语义只由接线方（game-layout / storage-panel）
 *   决定，组件本身无需知道"我这是哪一格该调用什么"。装备/移动/丢弃都由此回调注入。
 */
interface InventoryGridProps {
  items: CarriedItem[];
  capacity: number;
  containerType: ContainerType;
  searchQuery: string;
  onDragStartItem: (item: CarriedItem) => void;
  onDragEndItem: () => void;
  /** 从另一个容器拖入本容器：落点调用 /api/inventory/move */
  onDropFromOther: (uid: string, from: ContainerType) => void;
  /** 右键菜单「装备」；未注入时该项不可用（游客/只读场景） */
  onEquipItem?: (uid: string, slot: EquipmentSlot) => Promise<unknown> | void;
  /** 右键菜单「移动」：目标容器由调用方按自身语义决定 */
  onMoveItem?: (uid: string, from: ContainerType, to: ContainerType) => Promise<unknown> | void;
  /** 右键菜单「丢弃」；quantity 缺省 = 整格/整件 */
  onDiscardItem?: (uid: string, quantity?: number) => Promise<unknown> | void;
  /** 装备门槛判定用的玩家等级（与服务端同一口径，由调用方从 player 取） */
  playerLevel?: number;
  /** 装备槽位清单（来自 /api/content，DLC 增删槽位时前端不改代码） */
  equipmentSlots?: readonly EquipmentSlotMeta[];
}

/**
 * 右键菜单状态。
 *
 * 为什么坐标存 rect.left / rect.bottom 而不是 clientX/clientY？
 *   鼠标右键多用于"对准某一格"，以格子边缘为锚点比以光标点为锚点更稳定；
 *   视口收敛在渲染时用窗口尺寸算一次，窗口缩放/内容变化都会重新收敛。
 */
interface ContextMenuState {
  item: CarriedItem;
  x: number;
  y: number;
  /** 丢弃数量选择 / 详细信息的子视图；'root' 为四项菜单 */
  view: 'root' | 'discard';
  /** 详细信息是否展开（与 hover 浮层同内容，就地展开） */
  details: boolean;
}

/** 装备图标优先按模板映射，未收录再按槽位兜底 */
function equipmentIconName(item: EquipmentInstance): string {
  const byTemplate = templateIconName(item.template_id);
  return byTemplate.startsWith('item.') ? slotIconName(item.slot) : byTemplate;
}

/** 数量输入收敛到 [1, max]，脏输入（NaN/小数/越界）一律夹紧 */
function clampQuantity(value: string, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(Math.max(max, 1), n));
}

export function InventoryGrid({
  items,
  capacity,
  containerType,
  searchQuery,
  onDragStartItem,
  onDragEndItem,
  onDropFromOther,
  onEquipItem,
  onMoveItem,
  onDiscardItem,
  playerLevel = 1,
  equipmentSlots = [],
}: InventoryGridProps) {
  const { t } = useT();
  const [hovered, setHovered] = useState<CarriedItem | null>(null);
  // 详情浮层用 fixed 定位并收敛到视口内：右栏窄、格子靠底，就地展开会被裁
  const [popoverPos, setPopoverPos] = useState<CSSProperties>({});
  const [dropActive, setDropActive] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // 菜单外点击用捕获阶段的 pointerdown 判断"命中不在菜单内"，不再铺遮罩层：
  // 遮罩会吞掉"右键点另一格"，导致换目标的右键菜单无法直接打开
  const menuRef = useRef<HTMLDivElement | null>(null);

  const openPopover = (item: CarriedItem, rect: DOMRect) => {
    setHovered(item);
    setPopoverPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 218)),
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 180)),
    });
  };

  const openMenu = (item: CarriedItem, e: ReactMouseEvent<HTMLDivElement>) => {
    // 阻止浏览器原生菜单（P5-2）
    e.preventDefault();
    // 右键菜单与 hover 浮层互斥：同一物品上两者叠着看会互相遮挡
    setHovered(null);
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({ item, x: rect.left, y: rect.bottom + 2, view: 'root', details: false });
  };

  /**
   * 菜单关闭：Esc / 页面滚动 / 点击别处。
   *
   * 为什么滚动用 capture 监听 window？
   *   滚动事件不冒泡，只有捕获阶段经过 window 才能收到容器内的滚动；
   *   否则玩家在背包里一滚，菜单会孤零零留在原地。
   */
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    const close = () => setMenu(null);
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    // 捕获阶段：先于格子的点击/右键处理，保证"换目标"时旧菜单已关
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [menu]);

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

  /** 菜单动作统一收口：失败内联展示（runOptimistic 会回拉服务端真相，本地视图不额外改动） */
  const runMenuAction = async (action: () => Promise<unknown> | void) => {
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('inventory.menu.op_failed'));
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

  // 菜单打开期间物品可能被操作改动（数量/是否仍在容器），详情取最新态而非打开时快照
  const menuItem = menu ? items.find((i) => i.uid === menu.item.uid) ?? menu.item : null;
  const others = containerType === 'inventory' ? 'storage' : 'inventory';
  const moveLabel = others === 'storage' ? t('inventory.menu.move_to_storage') : t('inventory.menu.move_to_inventory');

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
                // 拖拽会话一开始，浏览器就不再向原元素派发 mouseleave，
                // 故 onMouseLeave 里的 setHovered(null) 永不触发，浮层会残留（P5-1）；
                // 必须在这里主动关掉 hover 浮层。
                setHovered(null);
                e.dataTransfer.setData('text/plain', JSON.stringify({ uid: item.uid, from: containerType }));
                e.dataTransfer.effectAllowed = 'move';
                onDragStartItem(item);
              }}
              onDragEnd={onDragEndItem}
              onMouseEnter={(e) => openPopover(item, e.currentTarget.getBoundingClientRect())}
              onMouseLeave={() => setHovered(null)}
              onContextMenu={(e) => openMenu(item, e)}
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
          <ItemDetail item={hovered} />
        </div>
      )}

      {actionError && <p className="inventory-action-error">{actionError}</p>}

      {menu && menuItem && (
        <div
          ref={menuRef}
          className="container-menu"
          role="menu"
          style={{
            // 收敛到视口内：右栏贴近屏幕右缘，菜单默认锚在格子左边会溢出
            left: Math.max(8, Math.min(menu.x, window.innerWidth - 196)),
            // 预留"详细信息展开后"的最大高度，避免展开即出屏
            top: Math.max(8, Math.min(menu.y, window.innerHeight - 300)),
          }}
        >
          <div className="container-menu-title">{displayName(menuItem)}</div>

          {/* 丢弃：堆叠物带数量选择（1..quantity），装备恒 1 件（不显示数量 UI） */}
          {menu.view === 'discard' && menuItem.kind === 'stack' ? (
            <DiscardQuantity
              max={menuItem.quantity}
              onCancel={() => setMenu((m) => (m ? { ...m, view: 'root' } : m))}
              onConfirm={(q) => {
                setMenu(null);
                void runMenuAction(() => onDiscardItem?.(menuItem.uid, q));
              }}
            />
          ) : (
            <button
              type="button"
              className="container-menu-item is-danger"
              onClick={() => {
                if (menuItem.kind === 'stack') {
                  setMenu((m) => (m ? { ...m, view: 'discard' } : m));
                  return;
                }
                setMenu(null);
                void runMenuAction(() => onDiscardItem?.(menuItem.uid));
              }}
            >
              {t('inventory.menu.discard')}
            </button>
          )}

          {/* 装备：仅装备可用；槽位可用性一律由 canEquipClient 判定（唯一来源） */}
          {menuItem.kind === 'equipment' ? (
            <EquipOptions
              item={menuItem}
              slots={equipmentSlots}
              playerLevel={playerLevel}
              onPick={(slot) => {
                setMenu(null);
                void runMenuAction(() => onEquipItem?.(menuItem.uid, slot));
              }}
            />
          ) : (
            <button
              type="button"
              className="container-menu-item"
              disabled
              title={t('inventory.menu.not_equipment')}
            >
              {t('inventory.menu.equip')}
            </button>
          )}

          <button
            type="button"
            className="container-menu-item"
            onClick={() => {
              setMenu(null);
              void runMenuAction(() => onMoveItem?.(menuItem.uid, containerType, others));
            }}
          >
            {moveLabel}
          </button>

          <button
            type="button"
            className="container-menu-item"
            onClick={() => setMenu((m) => (m ? { ...m, details: !m.details } : m))}
          >
            {t('inventory.menu.details')}
          </button>

          {menu.details && (
            <div className="container-menu-detail">
              <ItemDetail item={menuItem} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 装备落点选择。
 *
 * 取舍：合法槽位 > 1（戒指两槽）时列出全部合法槽位让玩家选；
 * 唯一合法槽位则只出现一项，点它即执行（省一层无意义的选择）。
 * 一项都不合法时不隐藏原因——用 canEquipClient 的 reasonKey 内联说明
 * （优先用装备模板自带槽位的原因，它才是"想穿哪儿而穿不上"的答案）。
 */
function EquipOptions({
  item,
  slots,
  playerLevel,
  onPick,
}: {
  item: EquipmentInstance;
  slots: readonly EquipmentSlotMeta[];
  playerLevel: number;
  onPick: (slot: EquipmentSlot) => void;
}) {
  const { t } = useT();

  const options = [...slots]
    .sort((a, b) => a.order - b.order)
    .map((meta) => ({ slot: meta.id, check: canEquipClient(item, meta.id, playerLevel) }));

  const usable = options.filter((o) => o.check.ok);

  if (usable.length === 0) {
    const reasonKey =
      options.find((o) => o.slot === item.slot)?.check.reasonKey ?? options[0]?.check.reasonKey;
    return (
      <button
        type="button"
        className="container-menu-item"
        disabled
        title={reasonKey ? t(reasonKey) : undefined}
      >
        {t('inventory.menu.equip')}
        {reasonKey && <span className="container-menu-reason">{t(reasonKey)}</span>}
      </button>
    );
  }

  return (
    <div className="container-menu-group">
      <span className="container-menu-label">{t('inventory.menu.equip')}</span>
      {usable.map((o) => (
        <button
          key={o.slot}
          type="button"
          className="container-menu-item"
          onClick={() => onPick(o.slot)}
        >
          {t(`slot.${o.slot}`)}
        </button>
      ))}
    </div>
  );
}

/** 丢弃数量选择：1..max，含"全部"快捷；装备不进入本子视图 */
function DiscardQuantity({
  max,
  onConfirm,
  onCancel,
}: {
  max: number;
  onConfirm: (quantity: number) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [quantity, setQuantity] = useState(1);

  return (
    <div className="container-menu-qty">
      <div className="qty-line">
        <span>{t('inventory.menu.quantity')}</span>
        <span className="qty-max">/ {max}</span>
      </div>
      <div className="qty-stepper">
        <button
          type="button"
          className="btn ghost btn-sm"
          onClick={() => setQuantity((q) => Math.max(1, q - 1))}
        >
          −
        </button>
        <input
          type="number"
          min={1}
          max={max}
          value={quantity}
          aria-label={t('inventory.menu.quantity')}
          onChange={(e) => setQuantity(clampQuantity(e.target.value, max))}
        />
        <button
          type="button"
          className="btn ghost btn-sm"
          onClick={() => setQuantity((q) => Math.min(max, q + 1))}
        >
          +
        </button>
        <button type="button" className="btn ghost btn-sm" onClick={() => setQuantity(max)}>
          {t('inventory.menu.all')}
        </button>
      </div>
      <div className="qty-actions">
        <button type="button" className="btn ghost btn-sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => onConfirm(quantity)}>
          {t('inventory.menu.confirm')}
        </button>
      </div>
    </div>
  );
}
