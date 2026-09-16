import { useCallback, useEffect, useMemo, useState } from 'react';
import { ITEMS } from '@lazycraft/shared';
import type { Item, Quality } from '@lazycraft/shared';
import { useT } from '../i18n/index.ts';
import { useAuth } from '../auth/auth.tsx';
import { useAction } from '../action/action-context.tsx';
import {
  browseListings,
  buyListing,
  cancelListing,
  fetchHistory,
  fetchMyListings,
  listItem,
  type HistoryRow,
  type Listing,
} from './api.ts';

/**
 * 市场面板（task-15）
 *
 * 设计决策：
 *  - 为什么折叠而不是常驻展开：挂单数据时效性弱（玩家手动刷新才需要最新），
 *    常驻展开会挤占右栏背包视觉；点开再拉，与 task-16 leaderboard 同一约定。
 *  - 为什么不轮询：市场刷新频率受"其他玩家挂单/成交"驱动，前端按任意周期轮询
 *    都必然过频或不够；手动"刷新"按钮是玩家预期内的操作，节省服务器压力。
 *  - 为什么浏览/我的挂单分两个 Tab 而不是混排：两种语义下"操作"不同（浏览=买、
 *    我的=撤），混排会让同一行出现两个互斥按钮，混淆心智模型。
 */

/** 后端约定：挂单固定手续费（与 MARKET_LISTING_FEE 对齐） */
const LISTING_FEE_HINT = 5;

/** 把 quality 转成 i18n key（'common' → 'market.quality.common'） */
function qualityKey(q: Quality): string {
  return `market.quality.${q}`;
}

/** 从物品注册表筛选出可交易物品（tradeable=true），挂在挂单表单的下拉里 */
const TRADEABLE_ITEMS: Item[] = ITEMS.filter((i) => i.tradeable);

/** 根据当前背包汇总推断某物品玩家拥有数量；挂单表单据此禁用"超过拥有量"的输入 */
function ownedQuantity(inventoryTotals: Record<string, number>, itemId: string): number {
  return inventoryTotals[itemId] ?? 0;
}

/* ------------------------------------------------------------------ */
/* 挂单表单                                                            */
/* ------------------------------------------------------------------ */

interface ListFormProps {
  token: string;
  onListed: () => void;
}

function ListForm({ token, onListed }: ListFormProps) {
  const { t } = useT();
  const { inventoryTotals, refreshSave } = useAction();
  const [itemId, setItemId] = useState<string>(TRADEABLE_ITEMS[0]?.id ?? '');
  const [quantityInput, setQuantityInput] = useState('1');
  const [priceInput, setPriceInput] = useState('1');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owned = ownedQuantity(inventoryTotals, itemId);
  const quantity = Math.max(1, Math.floor(Number(quantityInput) || 0));
  const price = Math.max(1, Math.floor(Number(priceInput) || 0));
  const total = quantity * price;
  // 挂单费 5 gold 是"卖家额外支出"：不在 total 里
  const canSubmit = quantity >= 1 && quantity <= owned && price >= 1 && !pending;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await listItem(token, { itemId, quantity, price });
      // 挂单成功后必须让 ActionProvider 重拉背包/金币，否则右栏数字是过期快照
      await refreshSave();
      onListed();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('market.error.generic'));
    } finally {
      setPending(false);
    }
  }, [canSubmit, token, itemId, quantity, price, refreshSave, onListed, t]);

  return (
    <div className="market-form">
      <h3 className="market-form-title">{t('market.form.title')}</h3>
      <div className="market-form-grid">
        <label className="market-field">
          <span className="market-label">{t('market.form.item')}</span>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            {TRADEABLE_ITEMS.map((it) => (
              <option key={it.id} value={it.id}>
                {t(`item.${it.id}.name`)}
              </option>
            ))}
          </select>
          <span className="market-hint">
            {t('market.form.owned').replace('{n}', String(owned))}
          </span>
        </label>

        <label className="market-field">
          <span className="market-label">{t('market.form.quantity')}</span>
          <input
            type="number"
            min={1}
            max={Math.max(1, owned)}
            value={quantityInput}
            onChange={(e) => setQuantityInput(e.target.value)}
            inputMode="numeric"
          />
        </label>

        <label className="market-field">
          <span className="market-label">{t('market.form.price')}</span>
          <input
            type="number"
            min={1}
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            inputMode="numeric"
          />
        </label>
      </div>

      <p className="market-summary">
        {t('market.form.total').replace('{n}', String(total))}
        {' · '}
        {t('market.form.fee_hint').replace('{n}', String(LISTING_FEE_HINT))}
      </p>

      {error && <p className="market-error">{error}</p>}
      <button
        type="button"
        className="market-btn market-btn-primary"
        onClick={() => void submit()}
        disabled={!canSubmit}
      >
        {t('market.form.submit')}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 挂单列表（浏览）                                                     */
/* ------------------------------------------------------------------ */

interface ListingRowProps {
  listing: Listing;
  token: string;
  /** 当前买家的"自己"标识——用于禁用"买自己的单"按钮 */
  mySellerName: string | null;
  onBought: () => void;
}

function ListingRow({ listing, token, mySellerName, onBought }: ListingRowProps) {
  const { t } = useT();
  const { refreshSave } = useAction();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMine = mySellerName !== null && listing.seller_name === mySellerName;

  const buy = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      await buyListing(token, listing.id);
      await refreshSave();
      onBought();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('market.error.generic'));
    } finally {
      setPending(false);
    }
  }, [token, listing.id, refreshSave, onBought, t]);

  return (
    <li className="market-row">
      <div className="market-row-main">
        <span className="market-item-name">{t(`item.${listing.item_id}.name`)}</span>
        <span className={`market-quality is-${listing.quality}`}>{t(qualityKey(listing.quality))}</span>
      </div>
      <div className="market-row-meta">
        <span>
          {t('market.col.quantity')}: {listing.quantity}
        </span>
        <span>
          {t('market.col.unit_price')}: {listing.unit_price}
        </span>
        <span>
          {t('market.col.total_price')}: {listing.total_price}
        </span>
        <span>
          {t('market.col.seller')}: {listing.seller_name ?? '-'}
        </span>
      </div>
      {error && <p className="market-error">{error}</p>}
      <button
        type="button"
        className="market-btn market-btn-buy"
        disabled={pending || isMine}
        title={isMine ? t('market.buy_disabled_mine') : undefined}
        onClick={() => void buy()}
      >
        {t('market.buy')}
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* 我的挂单列表                                                         */
/* ------------------------------------------------------------------ */

interface MyListingRowProps {
  listing: Listing;
  token: string;
  onCancelled: () => void;
}

function MyListingRow({ listing, token, onCancelled }: MyListingRowProps) {
  const { t } = useT();
  const { refreshSave } = useAction();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // expires_at 是 epoch 毫秒；过期单在"我的挂单"里仍要展示让玩家能收回物品
  const expired = listing.expires_at <= Date.now();

  const cancel = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      await cancelListing(token, listing.id);
      await refreshSave();
      onCancelled();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('market.error.generic'));
    } finally {
      setPending(false);
    }
  }, [token, listing.id, refreshSave, onCancelled, t]);

  return (
    <li className={`market-row${expired ? ' is-expired' : ''}`}>
      <div className="market-row-main">
        <span className="market-item-name">{t(`item.${listing.item_id}.name`)}</span>
        <span className={`market-quality is-${listing.quality}`}>{t(qualityKey(listing.quality))}</span>
        {expired && <span className="market-expired-tag">{t('market.expired')}</span>}
      </div>
      <div className="market-row-meta">
        <span>
          {t('market.col.quantity')}: {listing.quantity}
        </span>
        <span>
          {t('market.col.unit_price')}: {listing.unit_price}
        </span>
        <span>
          {t('market.col.total_price')}: {listing.total_price}
        </span>
      </div>
      {error && <p className="market-error">{error}</p>}
      <button
        type="button"
        className="market-btn market-btn-cancel"
        disabled={pending}
        onClick={() => void cancel()}
      >
        {t('market.cancel')}
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* 历史曲线（简化版：直接列出最近 30 天文本行，避免引入图表库）              */
/* ------------------------------------------------------------------ */

interface HistoryViewProps {
  token: string;
  itemId: string;
  quality?: Quality;
}

function HistoryView({ token, itemId, quality }: HistoryViewProps) {
  const { t } = useT();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchHistory(token, itemId, quality)
      .then((r) => {
        if (!cancelled) setRows(r.history);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('market.error.generic'));
      });
    return () => {
      cancelled = true;
    };
  }, [token, itemId, quality, t]);

  if (error) return <p className="market-error">{error}</p>;
  if (!rows) return <p className="market-status">{t('common.loading')}</p>;
  if (rows.length === 0) return <p className="market-status">{t('market.history.empty')}</p>;

  return (
    <ul className="market-history">
      {rows.map((r) => (
        <li key={`${r.date}:${r.quality}`}>
          <span>{r.date}</span>
          <span>
            {t('market.history.avg').replace('{n}', String(r.avg_price))}
          </span>
          <span>
            {t('market.history.vol').replace('{n}', String(r.volume))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* 主面板                                                              */
/* ------------------------------------------------------------------ */

export function MarketPanel() {
  const { t } = useT();
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'browse' | 'mine' | 'history'>('browse');
  const [filterItemId, setFilterItemId] = useState<string>('');
  const [filterQuality, setFilterQuality] = useState<Quality | ''>('');
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [myListings, setMyListings] = useState<Listing[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 让"卖家名"出现在我的行上时禁用"购买"按钮：从 myListings 任意一行取
  const mySellerName = useMemo(() => myListings?.[0]?.seller_name ?? null, [myListings]);

  const refreshBrowse = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await browseListings(token, {
        itemId: filterItemId || undefined,
        quality: (filterQuality || undefined) as Quality | undefined,
      });
      setListings(res.listings);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('market.error.generic'));
    } finally {
      setLoading(false);
    }
  }, [token, filterItemId, filterQuality, t]);

  const refreshMine = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMyListings(token);
      setMyListings(res.listings);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('market.error.generic'));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  // 展开 + Tab 切换时才拉对应数据；折叠状态下不发任何请求
  useEffect(() => {
    if (!open || !token) return;
    if (tab === 'browse') void refreshBrowse();
    if (tab === 'mine') void refreshMine();
  }, [open, tab, token, refreshBrowse, refreshMine]);

  if (!token) return null;

  return (
    <div className="market-panel">
      <button
        type="button"
        className="market-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {t('market.title')}
      </button>

      {open && (
        <div className="market-body">
          <div className="market-tabs">
            <button
              type="button"
              className={`market-tab${tab === 'browse' ? ' is-active' : ''}`}
              onClick={() => setTab('browse')}
            >
              {t('market.tab.browse')}
            </button>
            <button
              type="button"
              className={`market-tab${tab === 'mine' ? ' is-active' : ''}`}
              onClick={() => setTab('mine')}
            >
              {t('market.tab.mine')}
            </button>
            <button
              type="button"
              className={`market-tab${tab === 'history' ? ' is-active' : ''}`}
              onClick={() => setTab('history')}
            >
              {t('market.tab.history')}
            </button>
          </div>

          {tab === 'browse' && (
            <>
              <div className="market-filters">
                <select
                  value={filterItemId}
                  onChange={(e) => setFilterItemId(e.target.value)}
                  aria-label={t('market.filter.item')}
                >
                  <option value="">{t('market.filter.all_items')}</option>
                  {TRADEABLE_ITEMS.map((it) => (
                    <option key={it.id} value={it.id}>
                      {t(`item.${it.id}.name`)}
                    </option>
                  ))}
                </select>
                <select
                  value={filterQuality}
                  onChange={(e) => setFilterQuality(e.target.value as Quality | '')}
                  aria-label={t('market.filter.quality')}
                >
                  <option value="">{t('market.filter.all_qualities')}</option>
                  {(['common', 'uncommon', 'rare', 'epic'] as Quality[]).map((q) => (
                    <option key={q} value={q}>
                      {t(qualityKey(q))}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="market-btn"
                  onClick={() => void refreshBrowse()}
                  disabled={loading}
                >
                  {t('market.refresh')}
                </button>
              </div>

              {loading && <p className="market-status">{t('common.loading')}</p>}
              {error && <p className="market-error">{error}</p>}
              {listings && listings.length === 0 && (
                <p className="market-status">{t('market.empty')}</p>
              )}
              {listings && listings.length > 0 && (
                <ul className="market-list">
                  {listings.map((l) => (
                    <ListingRow
                      key={l.id}
                      listing={l}
                      token={token}
                      mySellerName={mySellerName}
                      onBought={() => void refreshBrowse()}
                    />
                  ))}
                </ul>
              )}

              <ListForm token={token} onListed={() => void refreshBrowse()} />
            </>
          )}

          {tab === 'mine' && (
            <>
              <button
                type="button"
                className="market-btn"
                onClick={() => void refreshMine()}
                disabled={loading}
              >
                {t('market.refresh')}
              </button>
              {loading && <p className="market-status">{t('common.loading')}</p>}
              {error && <p className="market-error">{error}</p>}
              {myListings && myListings.length === 0 && (
                <p className="market-status">{t('market.mine_empty')}</p>
              )}
              {myListings && myListings.length > 0 && (
                <ul className="market-list">
                  {myListings.map((l) => (
                    <MyListingRow
                      key={l.id}
                      listing={l}
                      token={token}
                      onCancelled={() => void refreshMine()}
                    />
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'history' && (
            <>
              <div className="market-filters">
                <select
                  value={filterItemId || (TRADEABLE_ITEMS[0]?.id ?? '')}
                  onChange={(e) => setFilterItemId(e.target.value)}
                  aria-label={t('market.filter.item')}
                >
                  {TRADEABLE_ITEMS.map((it) => (
                    <option key={it.id} value={it.id}>
                      {t(`item.${it.id}.name`)}
                    </option>
                  ))}
                </select>
              </div>
              <HistoryView
                token={token}
                itemId={filterItemId || (TRADEABLE_ITEMS[0]?.id ?? '')}
                quality={(filterQuality || undefined) as Quality | undefined}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
