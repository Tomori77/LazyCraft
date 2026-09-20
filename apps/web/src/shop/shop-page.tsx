import { useCallback, useEffect, useMemo, useState } from 'react';
import { stackQuality, type CarriedItem, type Quality, type ShopEntry } from '@lazycraft/shared';
import { useAuth } from '../auth/auth.tsx';
import { useT } from '../i18n/index.ts';
import { usePlayer } from '../player/player-context.tsx';
import { apiGet, apiPost } from '../lib/api.ts';
import { Icon } from '../icons/icon.tsx';
import { itemIconName, templateIconName } from '../icons/resolve-icon.ts';

/**
 * 商店悬浮页（购买/出售两种页签，匠人工坊样式）。
 *
 * 数据：`GET /api/shop`（需登录，返回数组，条目含 affordable/unlocked 派生标志）；
 * 买卖：`POST /api/shop/buy|sell`。金币从 `/api/player` 的 abstract_resources 取。
 */
interface ShopListEntry extends ShopEntry {
  affordable: boolean;
  unlocked: boolean;
}

// 商店以金币结算；'gold' 是 shared 与后端 gold.ts 共同使用的键名
const GOLD_KEY = 'gold';

interface ShopPageProps {
  onClose: () => void;
}

export function ShopPage({ onClose }: ShopPageProps) {
  const { t } = useT();
  const { token } = useAuth();
  const { player, refreshPlayer } = usePlayer();
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [entries, setEntries] = useState<ShopListEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const gold = player?.abstract_resources?.[GOLD_KEY] ?? 0;

  const loadShop = useCallback(async () => {
    if (!token) return;
    try {
      setEntries(await apiGet<ShopListEntry[]>('/shop', token));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shop.load_failed'));
    }
  }, [token, t]);

  useEffect(() => {
    void loadShop();
  }, [loadShop]);

  const buy = async (entry: ShopListEntry) => {
    if (!token) return;
    setError(null);
    try {
      await apiPost('/shop/buy', { entry_id: entry.id, quantity: 1 }, token);
      await refreshPlayer();
      await loadShop();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shop.buy_failed'));
    }
  };

  const sell = async (item: CarriedItem) => {
    if (!token) return;
    setError(null);
    try {
      await apiPost('/shop/sell', { uid: item.uid, quantity: 1 }, token);
      await refreshPlayer();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('shop.sell_failed'));
    }
  };

  // 可出售物品 = 背包里能匹配到"有 sell_price 的已上架条目"的那些
  const sellable = useMemo(() => {
    const inventory = player?.inventory ?? [];
    return inventory.filter((item) => sellPriceOf(item, entries) !== null);
  }, [player, entries]);

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
              const disabled = !entry.affordable || !entry.unlocked || soldOut;
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
                  <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => buy(entry)}>
                    {soldOut ? t('shop.sold_out') : !entry.unlocked ? t('shop.locked') : t('shop.buy')}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="shop-grid">
            {sellable.map((item) => (
              <div key={item.uid} className="shop-card">
                <div className="top">
                  <Icon
                    name={item.kind === 'equipment' ? templateIconName(item.template_id) : itemIconName(item.item_id)}
                    size={18}
                    fallback={carriedName(item, t).charAt(0)}
                  />
                  <span className="nm">{carriedName(item, t)}</span>
                </div>
                <div className="pr">
                  {t('inventory.quantity')} {item.kind === 'stack' ? item.quantity : 1}
                  {' · '}
                  {t('shop.price')} <b>{sellPriceOf(item, entries) ?? 0}</b>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => sell(item)}>
                  {t('shop.sell')}
                </button>
              </div>
            ))}
            {sellable.length === 0 && <p className="shop-empty">{t('shop.nothing_sellable')}</p>}
          </div>
        )}
      </div>
    </>
  );
}

/** 条目显示名统一走 item.<id>.name（物品与装备模板都已登记该 key） */
function entryName(entry: ShopEntry, t: (key: string) => string): string {
  const id = entry.kind === 'item' ? entry.item_id : entry.template_id;
  return id ? t(`item.${id}.name`) : entry.id;
}

/** 商店条目图标：物品按 item 映射，装备按模板→槽位兜底 */
function entryIconName(entry: ShopEntry): string {
  if (entry.kind === 'item') return entry.item_id ? itemIconName(entry.item_id) : 'item.ore';
  return entry.template_id ? templateIconName(entry.template_id) : 'slot.main_hand';
}

function carriedName(item: CarriedItem, t: (key: string) => string): string {
  return item.kind === 'equipment' ? item.display_name : t(`item.${item.item_id}.name`);
}

/** 匹配可回收条目的出售单价；找不到返回 null（不可出售） */
function sellPriceOf(item: CarriedItem, entries: ShopEntry[]): number | null {
  const quality: Quality = item.kind === 'equipment' ? item.quality : stackQuality(item);
  const entry = entries.find((e) => {
    // /api/shop 只返回已上架条目，无需再判 listed
    if (e.sell_price === undefined) return false;
    const sameQuality = (e.quality ?? 'common') === quality;
    if (!sameQuality) return false;
    return item.kind === 'equipment'
      ? e.kind === 'equipment' && e.template_id === item.template_id
      : e.kind === 'item' && e.item_id === item.item_id;
  });
  return entry?.sell_price ?? null;
}
