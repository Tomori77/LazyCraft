import { useCallback, useEffect, useMemo, useState } from 'react';
import { EQUIPMENT_TEMPLATES } from '@lazycraft/shared';
import { useAuth } from '../auth/auth.tsx';
import { useContent } from '../content/content-context.tsx';
import { useT } from '../i18n/index.ts';
import { Icon } from '../icons/icon.tsx';
import {
  createShopEntry,
  deleteShopEntry,
  fetchShopEntries,
  updateShopEntry,
  type AdminShopEntry,
  type CreateShopEntryInput,
  type ShopEntryKind,
  type ShopEntryQuality,
  type UpdateShopEntryInput,
} from './shop-api.ts';

/**
 * 管理后台「商店」页签（task-39）。
 *
 * 只读/写 task-24b 已有的 `/api/admin/shop/entries`，不新增后端接口：
 *   列表含未上架条目；新增/编辑/删除全部复用既有 DTO 与引用校验。
 *   引用是否合法（item_id 在 Registry 快照里、template_id 在 EQUIPMENT_TEMPLATES 里）
 *   由后端裁决，前端只负责"从真实内容里出下拉"和"把失败原因展示给管理员"。
 *
 * 引用下拉的数据源说明：
 *   - 物品：`/api/content.itemCatalog`（与后端 knownItemIds() 同一个 Registry 快照来源）；
 *   - 装备模板：`EQUIPMENT_TEMPLATES`（shared 常量，后端校验用的也是它）。
 *     模板没有进 `/api/content` 快照（ContentSnapshot 只有 item 类），若前端也硬编码一份
 *     模板清单就会与引擎分叉，故直接复用 shared 的同一份常量，而不是手填 id。
 *
 * 表格布局取舍：**横向滚动**（不裁列）。
 *   条目有 11 列（id/kind/引用/品质/买价/回收价/门槛/库存/上架/排序/操作），
 *   在 1280 预算下收缩列宽会让 id、引用、价格挤成省略号，管理员排查时反而要悬停才看清。
 *   改成 `overflow:auto` + `min-width` 的横滚后，列宽保持可读，纵向滚动复用 task-38 的
 *   `.admin-table-wrap` 模式（表头 sticky），整页在 1280×720 / 1920×1080 都不溢出。
 */
export function ShopAdminTab() {
  const { t } = useT();
  const { token } = useAuth();
  const { content } = useContent();

  const [entries, setEntries] = useState<AdminShopEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 三个互斥的浮层：新增表单 / 编辑表单 / 删除确认（同一时刻只开一个）
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminShopEntry | null>(null);
  const [removing, setRemoving] = useState<AdminShopEntry | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setEntries(await fetchShopEntries(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.shop.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // 下拉选项：物品来自内容快照，装备模板来自 shared 常量（见文件头说明）
  const itemOptions = useMemo(
    () =>
      (content?.itemCatalog ?? []).map((item) => ({
        id: item.id,
        label: displayName(t, item.id, item.name),
      })),
    [content, t],
  );
  const templateOptions = useMemo(
    () =>
      Object.values(EQUIPMENT_TEMPLATES).map((tpl) => ({
        id: tpl.id,
        label: displayName(t, tpl.id, tpl.base_name),
      })),
    [t],
  );

  /** 表单提交后的统一收尾：关浮层 + 重拉列表（服务器权威，不本地打补丁） */
  const afterMutation = async () => {
    setCreating(false);
    setEditing(null);
    await load();
  };

  return (
    <div className="admin-shop">
      <div className="admin-toolbar">
        <div className="admin-shop-headline">
          <button type="button" className="btn btn-sm" onClick={() => setCreating(true)}>
            {t('admin.shop.add')}
          </button>
          <span className="admin-readonly">
            {t('admin.shop.total')} {entries.length}
          </span>
        </div>
        <button type="button" className="btn ghost btn-sm" onClick={() => void load()} disabled={loading}>
          {t('admin.shop.refresh')}
        </button>
      </div>

      {error && <p className="shop-error">{error}</p>}

      <div className="admin-table-wrap admin-shop-table-wrap">
        <table className="admin-table admin-shop-table">
          <thead>
            <tr>
              <th>{t('admin.shop.col_id')}</th>
              <th>{t('admin.shop.col_kind')}</th>
              <th>{t('admin.shop.col_ref')}</th>
              <th>{t('admin.shop.col_quality')}</th>
              <th className="admin-shop-num">{t('admin.shop.col_buy')}</th>
              <th className="admin-shop-num">{t('admin.shop.col_sell')}</th>
              <th className="admin-shop-num">{t('admin.shop.col_level')}</th>
              <th className="admin-shop-num">{t('admin.shop.col_stock')}</th>
              <th>{t('admin.shop.col_listed')}</th>
              <th className="admin-shop-num">{t('admin.shop.col_sort')}</th>
              <th>{t('admin.shop.col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className={entry.listed ? '' : 'admin-shop-row-off'}>
                <td className="admin-mono">{entry.id}</td>
                <td>{t(`admin.shop.kind.${entry.kind}`)}</td>
                <td className="admin-shop-ref">
                  <span className="admin-mono">{entry.item_id ?? entry.template_id ?? '-'}</span>
                  <span className="admin-shop-ref-name">
                    {refLabel(t, entry.item_id ?? entry.template_id)}
                  </span>
                </td>
                <td>{entry.quality ? t(`quality.name.${entry.quality}`) : '-'}</td>
                <td className="admin-shop-num">{entry.buy_price}</td>
                <td className="admin-shop-num">
                  {entry.sell_price === null ? (
                    <span className="admin-shop-badge is-off">{t('admin.shop.not_recyclable')}</span>
                  ) : (
                    <>
                      {entry.sell_price}
                      <span className="admin-shop-badge is-rec">{t('admin.shop.recyclable')}</span>
                    </>
                  )}
                </td>
                <td className="admin-shop-num">{entry.required_level ?? '-'}</td>
                <td className="admin-shop-num">
                  {entry.stock < 0 ? t('admin.shop.unlimited') : entry.stock}
                </td>
                <td>
                  <span className={`admin-shop-badge ${entry.listed ? 'is-on' : 'is-off'}`}>
                    {entry.listed ? t('admin.shop.listed') : t('admin.shop.unlisted')}
                  </span>
                </td>
                <td className="admin-shop-num">{entry.sort_order}</td>
                <td>
                  <div className="admin-shop-actions">
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      onClick={() => setEditing(entry)}
                    >
                      {t('admin.shop.edit')}
                    </button>
                    {/* 上下架是最高频操作，给一个就地开关，省去每次开表单 */}
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      onClick={() => void toggleListed(entry, !entry.listed, token, setError, load, t)}
                    >
                      {entry.listed ? t('admin.shop.unlist') : t('admin.shop.list')}
                    </button>
                    <button
                      type="button"
                      className="btn ghost btn-sm admin-shop-danger"
                      onClick={() => setRemoving(entry)}
                    >
                      {t('admin.shop.delete')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && !loading && <p className="admin-empty">{t('admin.shop.empty')}</p>}
      </div>

      {creating && (
        <EntryFormModal
          mode="create"
          itemOptions={itemOptions}
          templateOptions={templateOptions}
          onClose={() => setCreating(false)}
          onSubmit={async (patch) => {
            if (!token) return;
            await createShopEntry(token, patch as CreateShopEntryInput);
            await afterMutation();
          }}
        />
      )}

      {editing && (
        <EntryFormModal
          mode="edit"
          entry={editing}
          itemOptions={itemOptions}
          templateOptions={templateOptions}
          onClose={() => setEditing(null)}
          onSubmit={async (patch) => {
            if (!token) return;
            await updateShopEntry(token, editing.id, patch as UpdateShopEntryInput);
            await afterMutation();
          }}
        />
      )}

      {removing && (
        <ConfirmModal
          title={t('admin.shop.confirm_delete_title')}
          body={`${removing.id} · ${refLabel(t, removing.item_id ?? removing.template_id)}`}
          confirmLabel={t('admin.shop.delete')}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            if (!token) return;
            await deleteShopEntry(token, removing.id);
            setRemoving(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

/** 就地上下架：失败只弹错误、不关页，让管理员看到后端给的 403/400 原因 */
async function toggleListed(
  entry: AdminShopEntry,
  listed: boolean,
  token: string | null,
  setError: (message: string | null) => void,
  reload: () => Promise<void>,
  t: (key: string) => string,
) {
  if (!token) return;
  setError(null);
  try {
    await updateShopEntry(token, entry.id, { listed });
    await reload();
  } catch (e) {
    setError(e instanceof Error ? e.message : t('admin.shop.save_failed'));
  }
}

/* ------------------------------------------------------------------ */
/* 新增 / 编辑表单                                                       */
/* ------------------------------------------------------------------ */

interface RefOption {
  id: string;
  label: string;
}

interface EntryFormModalProps {
  mode: 'create' | 'edit';
  entry?: AdminShopEntry;
  itemOptions: RefOption[];
  templateOptions: RefOption[];
  onClose: () => void;
  /** 提交成功后由父组件收尾；失败必须抛出，供本组件展示服务端 message */
  onSubmit: (patch: CreateShopEntryInput | UpdateShopEntryInput) => Promise<void>;
}

/**
 * 新增 / 编辑共用一个表单组件。
 *
 * 两态的差异集中在三处：create 需要填 id/kind/引用，edit 这三样只读展示；
 * 其余价格/库存/门槛/排序字段完全一致——拆成两个组件会让校验与样式再抄一遍。
 */
function EntryFormModal({
  mode,
  entry,
  itemOptions,
  templateOptions,
  onClose,
  onSubmit,
}: EntryFormModalProps) {
  const { t } = useT();
  const isCreate = mode === 'create';

  const [kind, setKind] = useState<ShopEntryKind>(entry?.kind ?? 'item');
  const [id, setId] = useState('');
  const [refId, setRefId] = useState(entry?.item_id ?? entry?.template_id ?? '');
  const [quality, setQuality] = useState<ShopEntryQuality | ''>(entry?.quality ?? '');
  const [buyPrice, setBuyPrice] = useState(entry ? String(entry.buy_price) : '');
  const [sellPrice, setSellPrice] = useState(
    entry?.sell_price === null || entry?.sell_price === undefined ? '' : String(entry.sell_price),
  );
  const [requiredLevel, setRequiredLevel] = useState(
    entry?.required_level === null || entry?.required_level === undefined
      ? ''
      : String(entry.required_level),
  );
  // 新增默认无限库存（-1）：多数基础货不该被库存卡死，有限库存是少数派
  const [stock, setStock] = useState(isCreate ? '-1' : String(entry?.stock ?? -1));
  const [sortOrder, setSortOrder] = useState(entry ? String(entry.sort_order) : '0');
  const [listed, setListed] = useState(entry?.listed ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = kind === 'item' ? itemOptions : templateOptions;

  // kind 切换后旧引用不再适用，清空以免提交出跨类型的 ref
  const onKindChange = (next: ShopEntryKind) => {
    setKind(next);
    setRefId('');
    if (next === 'item') setQuality('');
  };

  const submit = async () => {
    if (busy) return;
    setError(null);

    const buy = parseIntField(buyPrice);
    if (buy === null || Number.isNaN(buy) || buy < 0) {
      setError(t('admin.shop.err_buy_price'));
      return;
    }
    const sell = parseIntField(sellPrice);
    if (Number.isNaN(sell as number) || (sell !== null && sell < 0)) {
      setError(t('admin.shop.err_sell_price'));
      return;
    }
    const level = parseIntField(requiredLevel);
    if (Number.isNaN(level as number) || (level !== null && level < 1)) {
      setError(t('admin.shop.err_level'));
      return;
    }
    const stockValue = parseIntField(stock);
    if (Number.isNaN(stockValue as number) || (stockValue !== null && stockValue < -1)) {
      setError(t('admin.shop.err_stock'));
      return;
    }
    const sort = parseIntField(sortOrder);
    if (Number.isNaN(sort as number)) {
      setError(t('admin.shop.err_sort'));
      return;
    }

    if (isCreate) {
      if (!id.trim()) {
        setError(t('admin.shop.err_id_required'));
        return;
      }
      if (!refId) {
        setError(t('admin.shop.err_ref_required'));
        return;
      }
      const input: CreateShopEntryInput = {
        id: id.trim(),
        kind,
        buy_price: buy,
        listed,
      };
      if (kind === 'item') input.item_id = refId;
      else input.template_id = refId;
      if (kind === 'equipment' && quality) input.quality = quality;
      if (sell !== null) input.sell_price = sell;
      if (level !== null) input.required_level = level;
      if (stockValue !== null) input.stock = stockValue;
      if (sort !== null) input.sort_order = sort;

      setBusy(true);
      try {
        await onSubmit(input);
      } catch (e) {
        setError(e instanceof Error ? e.message : t('admin.shop.save_failed'));
        setBusy(false);
      }
      return;
    }

    // 编辑：只送被改动的字段；清空回收价/门槛必须显式送 null（省略 = 不改）
    const patch: UpdateShopEntryInput = {};
    if (buy !== entry?.buy_price) patch.buy_price = buy;
    if (sell !== (entry?.sell_price ?? null)) patch.sell_price = sell;
    if (level !== (entry?.required_level ?? null)) patch.required_level = level;
    if (stockValue !== null && stockValue !== entry?.stock) patch.stock = stockValue;
    if (sort !== null && sort !== entry?.sort_order) patch.sort_order = sort;
    if (listed !== entry?.listed) patch.listed = listed;

    setBusy(true);
    try {
      await onSubmit(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.shop.save_failed'));
      setBusy(false);
    }
  };

  return (
    <div className="admin-shop-modal-overlay" role="dialog" aria-modal="true">
      <section className="admin-shop-modal">
        <header className="admin-shop-modal-head">
          <h3>{isCreate ? t('admin.shop.create_title') : t('admin.shop.edit_title')}</h3>
          <button type="button" className="ov-close" onClick={onClose} aria-label={t('common.cancel')}>
            <Icon name="ui.close" size={14} />
          </button>
        </header>

        <div className="admin-shop-form">
          {isCreate ? (
            <>
              <label className="admin-shop-field">
                <span>{t('admin.shop.field_id')}</span>
                <input value={id} onChange={(e) => setId(e.target.value)} placeholder="shop_xxx" />
                <small>{t('admin.shop.hint_id')}</small>
              </label>

              <label className="admin-shop-field">
                <span>{t('admin.shop.field_kind')}</span>
                <select
                  value={kind}
                  onChange={(e) => onKindChange(e.target.value as ShopEntryKind)}
                >
                  <option value="item">{t('admin.shop.kind.item')}</option>
                  <option value="equipment">{t('admin.shop.kind.equipment')}</option>
                </select>
              </label>

              <label className="admin-shop-field admin-shop-field-wide">
                <span>{t('admin.shop.field_ref')}</span>
                <select value={refId} onChange={(e) => setRefId(e.target.value)}>
                  <option value="">{t('admin.shop.ref_placeholder')}</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} ({option.id})
                    </option>
                  ))}
                </select>
                <small>
                  {kind === 'item'
                    ? t('admin.shop.hint_ref_item')
                    : t('admin.shop.hint_ref_equipment')}
                </small>
              </label>

              {kind === 'equipment' && (
                <label className="admin-shop-field">
                  <span>{t('admin.shop.field_quality')}</span>
                  <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value as ShopEntryQuality | '')}
                  >
                    <option value="">{t('admin.shop.quality_default')}</option>
                    {QUALITY_IDS.map((q) => (
                      <option key={q} value={q}>
                        {t(`quality.name.${q}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          ) : (
            <div className="admin-shop-static">
              <span className="admin-mono">{entry?.id}</span>
              <span>{t(`admin.shop.kind.${entry?.kind}`)}</span>
              <span className="admin-mono">{entry?.item_id ?? entry?.template_id}</span>
            </div>
          )}

          <label className="admin-shop-field">
            <span>{t('admin.shop.field_buy')}</span>
            <input
              type="number"
              min={0}
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
            />
          </label>

          <label className="admin-shop-field">
            <span>{t('admin.shop.field_sell')}</span>
            <input
              type="number"
              min={0}
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              placeholder={t('admin.shop.placeholder_empty')}
            />
            <small>{t('admin.shop.hint_sell')}</small>
          </label>

          <label className="admin-shop-field">
            <span>{t('admin.shop.field_level')}</span>
            <input
              type="number"
              min={1}
              value={requiredLevel}
              onChange={(e) => setRequiredLevel(e.target.value)}
              placeholder={t('admin.shop.placeholder_empty')}
            />
            <small>{t('admin.shop.hint_level')}</small>
          </label>

          <label className="admin-shop-field">
            <span>{t('admin.shop.field_stock')}</span>
            <input type="number" min={-1} value={stock} onChange={(e) => setStock(e.target.value)} />
            <small>{t('admin.shop.hint_stock')}</small>
          </label>

          <label className="admin-shop-field">
            <span>{t('admin.shop.field_sort')}</span>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </label>

          <label className="admin-shop-field admin-shop-check">
            <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
            <span>{t('admin.shop.field_listed')}</span>
          </label>
        </div>

        {error && <p className="shop-error">{error}</p>}

        <div className="admin-shop-modal-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn" onClick={() => void submit()} disabled={busy}>
            {busy ? t('admin.shop.saving') : t('admin.shop.save')}
          </button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 删除二次确认                                                          */
/* ------------------------------------------------------------------ */

interface ConfirmModalProps {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

function ConfirmModal({ title, body, confirmLabel, onCancel, onConfirm }: ConfirmModalProps) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.shop.delete_failed'));
      setBusy(false);
    }
  };

  return (
    <div className="admin-shop-modal-overlay" role="dialog" aria-modal="true">
      <section className="admin-shop-modal admin-shop-confirm">
        <header className="admin-shop-modal-head">
          <h3>{title}</h3>
        </header>
        <p className="admin-shop-confirm-body">{body}</p>
        <p className="admin-shop-confirm-warn">{t('admin.shop.confirm_delete_hint')}</p>
        {error && <p className="shop-error">{error}</p>}
        <div className="admin-shop-modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn admin-shop-danger" onClick={() => void confirm()} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 工具                                                                 */
/* ------------------------------------------------------------------ */

const QUALITY_IDS: ShopEntryQuality[] = ['common', 'uncommon', 'rare', 'epic'];

/** 数字输入 → 整数；空串返回 null（= 该字段"不设置"），非法返回 NaN */
function parseIntField(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isInteger(value) ? value : Number.NaN;
}

/** i18n 名缺 key 时回退到内容自带的 name，避免界面出现 `item.foo.name` */
function displayName(t: (key: string) => string, id: string, fallback: string): string {
  const key = `item.${id}.name`;
  const value = t(key);
  return value === key ? fallback : value;
}

/** 条目引用 id → 展示名（物品与模板都登记了 item.<id>.name） */
function refLabel(t: (key: string) => string, refId: string | null): string {
  if (!refId) return '-';
  return displayName(t, refId, refId);
}
