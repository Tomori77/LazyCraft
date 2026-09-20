import { useCallback, useEffect, useState } from 'react';
import type { RecyclableEntry, ShopEntry } from '@lazycraft/shared';
import { useAuth } from '../auth/auth.tsx';
import { useT } from '../i18n/index.ts';
import { usePlayer } from '../player/player-context.tsx';
import { apiGet, apiPost } from '../lib/api.ts';
import { Icon } from '../icons/icon.tsx';
import { itemIconName, templateIconName } from '../icons/resolve-icon.ts';

/**
 * 商店悬浮页（购买/出售两种页签，匠人工坊样式）。
 *
 * task-33 契约：
 *   - `GET /api/shop` → `{ entries, recyclables }`（分区下发，不再是裸数组）；
 *   - `POST /api/shop/buy` → `{ entry_id, quantity }`；
 *   - `POST /api/shop/sell` → `{ entry_id, quantity }`，条目来自**固定回收清单**，
 *     不再上报背包 uid（与背包解耦）。
 * 买/卖都走"选数量 → 二次确认"弹窗，金币从 `/api/player.abstract_resources` 取。
 */
interface ShopListEntry extends ShopEntry {
  affordable: boolean;
  unlocked: boolean;
}

/** 回收清单条目：后端补了 held（按 (item_id|template_id, 品质) 聚合的持有量） */
type RecyclableShopEntry = RecyclableEntry & { held: number };

interface ShopPayload {
  entries: ShopListEntry[];
  recyclables: RecyclableShopEntry[];
}

// 商店以金币结算；'gold' 是 shared 与后端 gold.ts 共同使用的键名
const GOLD_KEY = 'gold';

interface ShopPageProps {
  onClose: () => void;
}

/** 数量弹窗的用途：买或卖，决定文案与上限口径 */
type Pending =
  | { mode: 'buy'; entry: ShopListEntry }
  | { mode: 'sell'; entry: RecyclableShopEntry };

export function ShopPage({ onClose }: ShopPageProps) {
  const { t } = useT();
  const { token } = useAuth();
  const { player, refreshPlayer } = usePlayer();
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [entries, setEntries] = useState<ShopListEntry[]>([]);
  const [recyclables, setRecyclables] = useState<RecyclableShopEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const gold = player?.abstract_resources?.[GOLD_KEY] ?? 0;

  const loadShop = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiGet<ShopPayload>('/shop', token);
      setEntries(data.entries);
      setRecyclables(data.recyclables);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shop.load_failed'));
    }
  }, [token, t]);

  useEffect(() => {
    void loadShop();
  }, [loadShop]);

  /** 二次确认后真正提交；失败把弹窗留住并提示，便于玩家改数量重试 */
  const submit = async (quantity: number) => {
    if (!token || !pending) return;
    setError(null);
    try {
      const path = pending.mode === 'buy' ? '/shop/buy' : '/shop/sell';
      await apiPost(path, { entry_id: entryIdOf(pending.entry), quantity }, token);
      await refreshPlayer();
      await loadShop();
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t(`shop.${pending.mode === 'buy' ? 'buy' : 'sell'}_failed`));
    }
  };

  return (
    <>
      <div className="ov-head">
        <h2>
          {t('shop.title')}
          <span className="ov-sub">
            {t(`resource.${GOLD_KEY}.name`)} {gold.toLocaleString()}
          </span>
        </h2>
        <button type="button" className="ov-close" onClick={onClose} aria-label={t('common.cancel')}>
          <Icon name="ui.close" size={14} />
        </button>
      </div>

      <div className="overlay-body shop">
        <div className="shop-tabs">
          {(['buy', 'sell'] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`tab ${tab === key ? 'is-active' : ''}`}
              onClick={() => setTab(key)}
            >
              {t(`shop.${key}`)}
            </button>
          ))}
        </div>

        {error && <p className="shop-error">{error}</p>}

        {tab === 'buy' ? (
          <div className="shop-grid">
            {entries.map((entry) => {
              const soldOut = entry.stock === 0;
              const maxBuy = maxAffordable(gold, entry);
              const disabled = !entry.affordable || !entry.unlocked || soldOut || maxBuy < 1;
              return (
                <div key={entry.id} className="shop-card">
                  <div className="top">
                    <Icon name={entryIconName(entry)} size={18} fallback={entryName(entry, t).charAt(0)} />
                    <span className="nm">{entryName(entry, t)}</span>
                  </div>
                  <div className="pr">
                    {t('shop.price')} <b>{entry.buy_price}</b>
                    {' · '}
                    {entry.stock < 0 ? t('shop.unlimited') : `${t('shop.stock')} ${entry.stock}`}
                  </div>
                  {!entry.unlocked && (
                    <div className="pr">
                      {t('shop.requires_level')} {entry.required_level}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={disabled}
                    onClick={() => setPending({ mode: 'buy', entry })}
                  >
                    {soldOut ? t('shop.sold_out') : !entry.unlocked ? t('shop.locked') : t('shop.buy')}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="shop-grid">
            {recyclables.map((entry) => {
              const disabled = entry.held < 1;
              return (
                <div key={entry.entry_id} className="shop-card">
                  <div className="top">
                    <Icon
                      name={recyclableIconName(entry)}
                      size={18}
                      fallback={recyclableName(entry, t).charAt(0)}
                    />
                    <span className="nm">{recyclableName(entry, t)}</span>
                  </div>
                  <div className="pr">
                    {t('shop.sell_price')} <b>{entry.sell_price}</b>
                    {' · '}
                    {t('shop.held')} {entry.held}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={disabled}
                    onClick={() => setPending({ mode: 'sell', entry })}
                  >
                    {disabled ? t('shop.not_held') : t('shop.sell')}
                  </button>
                </div>
              );
            })}
            {recyclables.length === 0 && <p className="shop-empty">{t('shop.no_recyclables')}</p>}
          </div>
        )}
      </div>

      {pending && (
        <QuantityDialog
          pending={pending}
          gold={gold}
          onSubmit={submit}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 数量选择 + 二次确认弹窗                                              */
/* ------------------------------------------------------------------ */

interface QuantityDialogProps {
  pending: Pending;
  gold: number;
  onSubmit: (quantity: number) => Promise<void>;
  onClose: () => void;
}

/**
 * 数量选择弹窗。
 *
 * 上限口径（服务器仍是权威，这里只做预校验，避免用户提交必然被拒的数量）：
 *   - 买：`min(库存, 买得起的数量)`；无限库存不参与 min。
 *   - 卖：回收清单条目的 `held`。
 * "最大/全部"按钮直接把数量顶到上限，配合 +/- 与手动输入覆盖各种玩法。
 */
function QuantityDialog({ pending, gold, onSubmit, onClose }: QuantityDialogProps) {
  const { t } = useT();
  const isBuy = pending.mode === 'buy';
  const entry = pending.entry;
  const unitPrice = isBuy ? (entry as ShopListEntry).buy_price : (entry as RecyclableShopEntry).sell_price;
  const max = isBuy ? maxAffordable(gold, entry as ShopListEntry) : (entry as RecyclableShopEntry).held;

  const [quantity, setQuantity] = useState(max >= 1 ? 1 : 0);
  const [busy, setBusy] = useState(false);

  const clamp = (n: number) => Math.max(0, Math.min(max, Math.floor(Number.isFinite(n) ? n : 0)));
  const subtotal = unitPrice * quantity;

  const confirm = async () => {
    if (busy || quantity < 1) return;
    setBusy(true);
    try {
      await onSubmit(quantity);
    } finally {
      setBusy(false);
    }
  };

  const name = isBuy ? entryName(entry as ShopListEntry, t) : recyclableName(entry as RecyclableShopEntry, t);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <section
        className="settings-modal qty-modal"
        role="dialog"
        aria-label={t('shop.choose_quantity')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-header">
          <h2>{name}</h2>
          <button className="settings-close" onClick={onClose} aria-label={t('common.cancel')}>
            ×
          </button>
        </header>

        <div className="qty-line">
          <span>{isBuy ? t('shop.price') : t('shop.sell_price')}</span>
          <b>{unitPrice}</b>
        </div>
        <div className="qty-line">
          <span>{t('shop.choose_quantity')}</span>
          <span className="qty-max">
            {isBuy ? t('shop.max') : t('shop.all')} {max}
          </span>
        </div>

        <div className="qty-stepper">
          <button type="button" className="btn ghost btn-sm" onClick={() => setQuantity((q) => clamp(q - 1))}>
            −
          </button>
          <input
            type="number"
            min={0}
            max={max}
            value={quantity}
            onChange={(e) => setQuantity(clamp(Number(e.target.value)))}
            aria-label={t('shop.choose_quantity')}
          />
          <button type="button" className="btn ghost btn-sm" onClick={() => setQuantity((q) => clamp(q + 1))}>
            +
          </button>
          <button type="button" className="btn ghost btn-sm" onClick={() => setQuantity(clamp(max))}>
            {isBuy ? t('shop.max') : t('shop.all')}
          </button>
        </div>

        <div className="qty-line qty-total">
          <span>{t('shop.subtotal')}</span>
          <b>{subtotal}</b>
        </div>

        <div className="qty-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn" onClick={confirm} disabled={busy || quantity < 1}>
            {isBuy ? t('shop.confirm_buy') : t('shop.confirm_sell')}
          </button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 派生工具                                                             */
/* ------------------------------------------------------------------ */

/** 可回收条目的稳定 id（买/卖接口统一用 entry_id） */
function entryIdOf(entry: ShopListEntry | RecyclableShopEntry): string {
  return 'entry_id' in entry ? entry.entry_id : entry.id;
}

/** 买得起且不超库存的最大数量；无限库存只看金币 */
function maxAffordable(gold: number, entry: ShopListEntry): number {
  if (entry.buy_price <= 0) return entry.stock < 0 ? 999 : entry.stock;
  const byGold = Math.floor(gold / entry.buy_price);
  const byStock = entry.stock < 0 ? byGold : Math.min(entry.stock, byGold);
  return Math.max(0, byStock);
}

/** 条目显示名统一走 item.<id>.name（物品与装备模板都已登记该 key） */
function entryName(entry: ShopEntry, t: (key: string) => string): string {
  const id = entry.kind === 'item' ? entry.item_id : entry.template_id;
  return id ? t(`item.${id}.name`) : entry.id;
}

/** 回收清单条目的显示名（形状不同，单独取引用 id） */
function recyclableName(entry: RecyclableShopEntry, t: (key: string) => string): string {
  const id = entry.kind === 'item' ? entry.item_id : entry.template_id;
  return id ? t(`item.${id}.name`) : entry.entry_id;
}

/** 商店条目图标：物品按 item 映射，装备按模板→槽位兜底 */
function entryIconName(entry: ShopEntry): string {
  if (entry.kind === 'item') return entry.item_id ? itemIconName(entry.item_id) : 'item.ore';
  return entry.template_id ? templateIconName(entry.template_id) : 'slot.main_hand';
}

function recyclableIconName(entry: RecyclableShopEntry): string {
  return entryIconName({ ...entry, id: entry.entry_id, buy_price: 0, stock: -1 });
}
