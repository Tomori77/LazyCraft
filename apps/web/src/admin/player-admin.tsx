import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { EQUIPMENT_TEMPLATES, type CarriedItem, type EquipmentInstance } from '@lazycraft/shared';
import { useAuth } from '../auth/auth.tsx';
import { useContent } from '../content/content-context.tsx';
import { useT } from '../i18n/index.ts';
import { Icon } from '../icons/icon.tsx';
import { itemIconName, resourceIconName, templateIconName } from '../icons/resolve-icon.ts';
import {
  fetchPlayerDetail,
  fetchPlayers,
  grantItems,
  grantResources,
  resetPlayerState,
  updatePlayerBan,
  updatePlayerRole,
  type AdminPlayerDetail,
  type AdminPlayerListItem,
  type AdminPlayerPage,
  type GrantItemsInput,
} from './player-api.ts';

const PAGE_SIZE = 20;
const QUALITY_IDS = ['common', 'uncommon', 'rare', 'epic'] as const;

/**
 * 管理后台「玩家」页签（task-40）。
 *
 * 布局取舍：**左右双栏**（列表 + 详情），两栏各自内部滚动。
 *   1280×720 下管理控制台可用高度约 700px，单栏"列表在上、详情在下"会让
 *   详情快照（技能 5 项 + 资源 + 背包/装备格）被压到不足一屏、必须来回滚；
 *   双栏让"筛选定位玩家"与"看/改这个玩家"互不遮挡，是后台最常用的工作姿势。
 *   两栏都设 min-width:0 + overflow:auto，窄屏也不横向溢出。
 *
 * 服务器权威：所有操作都调后端专用接口，前端不做任何规则复刻；
 * 失败时把后端 message 原样展示（容量不足/引用未注册/资源非法），
 * 成功后就地刷新列表与详情（不本地打补丁）。
 */
export function PlayerAdminTab() {
  const { t } = useT();
  const { token } = useAuth();

  const [data, setData] = useState<AdminPlayerPage | null>(null);
  const [page, setPage] = useState(1);
  // 过滤分"草稿"与"已应用"：敲字只改草稿，回车/点查询才提交，避免每键一次请求
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminPlayerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 详情区操作成功/失败的统一提示（与列表加载错误分开，避免互相覆盖）
  const [notice, setNotice] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const pageData = await fetchPlayers(token, { query: query || undefined, page, limit: PAGE_SIZE });
      setData(pageData);
      // 选中项不在当前页时清空详情，避免"列表换了、详情还是旧玩家"的错位
      if (selected && !pageData.items.some((item) => item.id === selected)) {
        setSelected(null);
        setDetail(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.player.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [token, query, page, selected, t]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openDetail = useCallback(
    async (playerId: string) => {
      if (!token) return;
      setSelected(playerId);
      setDetail(null);
      setNotice(null);
      try {
        setDetail(await fetchPlayerDetail(token, playerId));
      } catch (e) {
        setError(e instanceof Error ? e.message : t('admin.player.detail_failed'));
      }
    },
    [token, t],
  );

  /** 操作成功后的统一收尾：重拉列表 + 重拉详情（服务器权威，不本地打补丁） */
  const afterMutation = useCallback(
    async (playerId: string, message: string) => {
      setNotice(message);
      await loadList();
      if (token && selected === playerId) {
        try {
          setDetail(await fetchPlayerDetail(token, playerId));
        } catch {
          // 详情刷新失败不覆盖成功提示，下一次点行会重拉
        }
      }
    },
    [loadList, token, selected],
  );

  const applySearch = () => {
    setPage(1);
    setQuery(draftQuery.trim());
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="admin-player">
      <section className="admin-player-list">
        <div className="admin-toolbar">
          <div className="admin-filter">
            <input
              type="text"
              placeholder={t('admin.player.search_placeholder')}
              value={draftQuery}
              onChange={(e) => setDraftQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySearch();
              }}
            />
            <button type="button" className="btn ghost btn-sm" onClick={applySearch}>
              {t('admin.player.search')}
            </button>
          </div>
          <span className="admin-readonly">
            {t('admin.player.total')} {data?.total ?? 0}
          </span>
        </div>

        {error && <p className="shop-error">{error}</p>}

        <div className="admin-table-wrap admin-player-table-wrap">
          <table className="admin-table admin-player-table">
            <thead>
              <tr>
                <th>{t('admin.player.col_name')}</th>
                <th>{t('admin.player.col_email')}</th>
                <th>{t('admin.player.col_role')}</th>
                <th>{t('admin.player.col_banned')}</th>
                <th>{t('admin.player.col_created')}</th>
                <th>{t('admin.player.col_summary')}</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((row) => (
                <tr
                  key={row.id}
                  className={`admin-player-row ${row.id === selected ? 'is-active' : ''}`}
                  onClick={() => void openDetail(row.id)}
                >
                  <td>{row.name}</td>
                  <td className="admin-mono">{row.email}</td>
                  <td>
                    <span className={`admin-player-badge ${row.role === 'admin' ? 'is-admin' : ''}`}>
                      {t(`admin.player.role.${row.role}`)}
                    </span>
                  </td>
                  <td>
                    <span className={`admin-player-badge ${row.banned ? 'is-banned' : 'is-ok'}`}>
                      {row.banned ? t('admin.player.banned') : t('admin.player.active')}
                    </span>
                  </td>
                  <td className="admin-time">{formatTime(row.created_at)}</td>
                  <td className="admin-player-summary">{summaryText(t, row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.items.length === 0 && !loading && (
            <p className="admin-empty">{t('admin.player.empty')}</p>
          )}
        </div>

        <div className="admin-foot">
          <button
            type="button"
            className="btn ghost btn-sm"
            disabled={loading}
            onClick={() => void loadList()}
          >
            {t('admin.player.refresh')}
          </button>
          <div className="admin-pager">
            <button
              type="button"
              className="btn ghost btn-sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t('admin.audit.prev')}
            </button>
            <span className="admin-page-num">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="btn ghost btn-sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('admin.audit.next')}
            </button>
          </div>
        </div>
      </section>

      <section className="admin-player-detail">
        {!detail ? (
          <p className="admin-player-hint">{t('admin.player.select_hint')}</p>
        ) : (
          <PlayerDetailPanel
            key={detail.id}
            detail={detail}
            notice={notice}
            onError={setNotice}
            onChanged={(message) => void afterMutation(detail.id, message)}
          />
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 详情 + 操作                                                          */
/* ------------------------------------------------------------------ */

interface PlayerDetailPanelProps {
  detail: AdminPlayerDetail;
  notice: string | null;
  /** 传 null 表示清除提示；传字符串表示展示失败原因 */
  onError: (message: string | null) => void;
  /** 操作成功后由父组件重拉列表/详情；参数是给管理员看的成功文案 */
  onChanged: (message: string) => void;
}

function PlayerDetailPanel({ detail, notice, onError, onChanged }: PlayerDetailPanelProps) {
  const { t } = useT();
  const { token } = useAuth();
  const { content } = useContent();
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'items' | 'resources' | null>(null);

  const run = async (action: () => Promise<unknown>, successKey: string) => {
    if (!token || busy) return;
    setBusy(true);
    onError(null);
    try {
      await action();
      onChanged(t(successKey));
    } catch (e) {
      onError(e instanceof Error ? e.message : t('admin.player.op_failed'));
    } finally {
      setBusy(false);
    }
  };

  const snapshot = detail.snapshot;
  const skillList = content?.skills ?? [];
  const slotList = content?.equipmentSlots ?? [];

  return (
    <div className="admin-player-panel">
      <header className="admin-player-panel-head">
        <div>
          <h3>{detail.name}</h3>
          <span className="admin-mono">{detail.email}</span>
        </div>
        <div className="admin-player-panel-badges">
          <span className={`admin-player-badge ${detail.role === 'admin' ? 'is-admin' : ''}`}>
            {t(`admin.player.role.${detail.role}`)}
          </span>
          <span className={`admin-player-badge ${detail.banned ? 'is-banned' : 'is-ok'}`}>
            {detail.banned ? t('admin.player.banned') : t('admin.player.active')}
          </span>
        </div>
      </header>

      <div className="admin-player-scroll">
        {/* 账号级操作：改角色 / 封禁 / 重置状态 —— 都是"改这个账号"的高频动作 */}
        <div className="admin-player-actions">
          <label className="admin-player-field">
            <span>{t('admin.player.field_role')}</span>
            <select
              value={detail.role}
              disabled={busy}
              onChange={(e) =>
                void run(
                  () => updatePlayerRole(token as string, detail.id, e.target.value as 'player' | 'admin'),
                  'admin.player.role_saved',
                )
              }
            >
              <option value="player">{t('admin.player.role.player')}</option>
              <option value="admin">{t('admin.player.role.admin')}</option>
            </select>
          </label>

          <button
            type="button"
            className={`btn ghost btn-sm ${detail.banned ? '' : 'admin-player-danger'}`}
            disabled={busy}
            onClick={() =>
              void run(
                () => updatePlayerBan(token as string, detail.id, !detail.banned),
                detail.banned ? 'admin.player.unban_saved' : 'admin.player.ban_saved',
              )
            }
          >
            {detail.banned ? t('admin.player.unban') : t('admin.player.ban')}
          </button>

          <button
            type="button"
            className="btn ghost btn-sm"
            disabled={busy}
            onClick={() => setModal('items')}
          >
            {t('admin.player.grant_items')}
          </button>
          <button
            type="button"
            className="btn ghost btn-sm"
            disabled={busy}
            onClick={() => setModal('resources')}
          >
            {t('admin.player.grant_resources')}
          </button>

          <div className="admin-player-reset">
            <span>{t('admin.player.reset')}</span>
            <button
              type="button"
              className="btn ghost btn-sm"
              disabled={busy}
              onClick={() =>
                void run(
                  () => resetPlayerState(token as string, detail.id, 'action'),
                  'admin.player.reset_action_done',
                )
              }
            >
              {t('admin.player.reset_action')}
            </button>
            <button
              type="button"
              className="btn ghost btn-sm"
              disabled={busy}
              onClick={() =>
                void run(
                  () => resetPlayerState(token as string, detail.id, 'combat'),
                  'admin.player.reset_combat_done',
                )
              }
            >
              {t('admin.player.reset_combat')}
            </button>
            <button
              type="button"
              className="btn ghost btn-sm"
              disabled={busy}
              onClick={() =>
                void run(
                  () => resetPlayerState(token as string, detail.id, 'all'),
                  'admin.player.reset_all_done',
                )
              }
            >
              {t('admin.player.reset_all')}
            </button>
          </div>
        </div>

        {notice && <p className="admin-player-notice">{notice}</p>}

        {/* 只读快照 */}
        <div className="admin-player-snapshot">
          <div className="admin-player-block">
            <h4>{t('admin.player.block_overview')}</h4>
            <dl className="admin-player-kv">
              <div>
                <dt>{t('admin.player.level')}</dt>
                <dd>{snapshot.level}</dd>
              </div>
              <div>
                <dt>{t('admin.player.account_id')}</dt>
                <dd className="admin-mono">{detail.account_id}</dd>
              </div>
              <div>
                <dt>{t('admin.player.created')}</dt>
                <dd className="admin-time">{formatTime(detail.created_at)}</dd>
              </div>
              <div>
                <dt>{t('admin.player.carry')}</dt>
                <dd>
                  {snapshot.carry.inventory_used}/{snapshot.carry.inventory_capacity} ·{' '}
                  {snapshot.carry.storage_used}/{snapshot.carry.storage_capacity}
                </dd>
              </div>
            </dl>
          </div>

          <div className="admin-player-block">
            <h4>{t('admin.player.block_resources')}</h4>
            <div className="admin-player-chips">
              {(content?.abstractResources ?? []).map((res) => (
                <span key={res.id} className="admin-player-chip">
                  <Icon name={resourceIconName(res.icon, res.id)} size={14} fallback={res.name.charAt(0)} />
                  {t(`resource.${res.id}.name`)}
                  <b>{snapshot.abstract_resources[res.id] ?? 0}</b>
                </span>
              ))}
            </div>
          </div>

          <div className="admin-player-block">
            <h4>{t('admin.player.block_skills')}</h4>
            <div className="admin-player-skills">
              {skillList.map((skill) => (
                <div key={skill.id} className="admin-player-skill">
                  <Icon name={`skill.${skill.id}`} size={14} fallback={skill.name.charAt(0)} />
                  <span>{t(`skill.${skill.id}.name`)}</span>
                  <b>
                    {t('admin.player.skill_lv')}
                    {snapshot.skills[skill.id]?.level ?? 1}
                  </b>
                  <small>{snapshot.skills[skill.id]?.exp ?? 0} exp</small>
                </div>
              ))}
            </div>
          </div>

          <div className="admin-player-block">
            <h4>
              {t('admin.player.block_equipment')} · {snapshot.carry.inventory_used}/
              {snapshot.carry.inventory_capacity}
            </h4>
            <div className="admin-player-items">
              {snapshot.inventory.length === 0 && (
                <p className="admin-player-hint">{t('admin.player.inventory_empty')}</p>
              )}
              {snapshot.inventory.map((item) => (
                <ItemChip key={item.uid} item={item} />
              ))}
            </div>
          </div>

          <div className="admin-player-block">
            <h4>
              {t('admin.player.block_worn')} · {snapshot.carry.storage_used}/
              {snapshot.carry.storage_capacity}
            </h4>
            <div className="admin-player-slots">
              {slotList.map((slot) => {
                const worn = snapshot.equipment[slot.id] ?? null;
                return (
                  <div key={slot.id} className={`admin-player-slot ${worn ? 'is-on' : ''}`}>
                    <span className="admin-player-slot-name">{t(`slot.${slot.id}`)}</span>
                    <span className="admin-player-slot-item">
                      {worn ? worn.display_name : t('admin.player.slot_empty')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {modal === 'items' && (
        <GrantItemsModal
          playerId={detail.id}
          onClose={() => setModal(null)}
          onDone={(message) => {
            setModal(null);
            onChanged(message);
          }}
          onError={onError}
        />
      )}
      {modal === 'resources' && (
        <GrantResourcesModal
          playerId={detail.id}
          onClose={() => setModal(null)}
          onDone={(message) => {
            setModal(null);
            onChanged(message);
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

/** 背包/仓库里的一件物品：图标 + 名字 + 数量（堆叠）或品质（装备） */
function ItemChip({ item }: { item: CarriedItem }) {
  const { t } = useT();
  const isEquipment = item.kind === 'equipment';
  const iconName = isEquipment
    ? templateIconName((item as EquipmentInstance).template_id)
    : itemIconName(item.item_id);
  return (
    <span className={`admin-player-item ${isEquipment ? 'is-equipment' : ''}`}>
      <Icon name={iconName} size={14} fallback="?" />
      <span className="admin-player-item-name">
        {isEquipment ? item.display_name : t(`item.${item.item_id}.name`)}
      </span>
      {isEquipment ? (
        <b>{t(`quality.name.${item.quality}`)}</b>
      ) : (
        <b>×{item.quantity}</b>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* 发放物品 / 装备表单                                                    */
/* ------------------------------------------------------------------ */

interface GrantModalProps {
  playerId: string;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string | null) => void;
}

function GrantItemsModal({ playerId, onClose, onDone, onError }: GrantModalProps) {
  const { t } = useT();
  const { token } = useAuth();
  const { content } = useContent();
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [templateId, setTemplateId] = useState('');
  const [quality, setQuality] = useState<(typeof QUALITY_IDS)[number]>('common');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const itemOptions = useMemo(
    () => (content?.itemCatalog ?? []).map((item) => ({ id: item.id, label: item.name })),
    [content],
  );
  const templateOptions = useMemo(
    () => Object.values(EQUIPMENT_TEMPLATES).map((tpl) => ({ id: tpl.id, label: tpl.base_name })),
    [],
  );

  const submit = async () => {
    if (!token || busy) return;
    setError(null);

    const payload: GrantItemsInput = {};
    if (itemId) {
      const qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        setError(t('admin.player.err_quantity'));
        return;
      }
      payload.items = [{ item_id: itemId, quantity: qty }];
    }
    if (templateId) {
      payload.equipments = [{ template_id: templateId, quality }];
    }
    if (!payload.items && !payload.equipments) {
      setError(t('admin.player.err_grant_empty'));
      return;
    }

    setBusy(true);
    try {
      await grantItems(token, playerId, payload);
      onDone(t('admin.player.grant_items_done'));
    } catch (e) {
      const message = e instanceof Error ? e.message : t('admin.player.op_failed');
      setError(message);
      onError(message);
      setBusy(false);
    }
  };

  return (
    <ModalShell title={t('admin.player.grant_items')} onClose={onClose} busy={busy}>
      <label className="admin-player-field">
        <span>{t('admin.player.field_item')}</span>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} disabled={busy}>
          <option value="">{t('admin.player.none')}</option>
          {itemOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} ({option.id})
            </option>
          ))}
        </select>
        <small>{t('admin.player.hint_item')}</small>
      </label>

      <label className="admin-player-field">
        <span>{t('admin.player.field_quantity')}</span>
        <input
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          disabled={busy || !itemId}
        />
      </label>

      <label className="admin-player-field">
        <span>{t('admin.player.field_template')}</span>
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={busy}>
          <option value="">{t('admin.player.none')}</option>
          {templateOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} ({option.id})
            </option>
          ))}
        </select>
        <small>{t('admin.player.hint_template')}</small>
      </label>

      <label className="admin-player-field">
        <span>{t('admin.player.field_quality')}</span>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as (typeof QUALITY_IDS)[number])}
          disabled={busy || !templateId}
        >
          {QUALITY_IDS.map((q) => (
            <option key={q} value={q}>
              {t(`quality.name.${q}`)}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="shop-error">{error}</p>}

      <div className="admin-player-modal-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn" onClick={() => void submit()} disabled={busy}>
          {busy ? t('admin.player.saving') : t('admin.player.submit')}
        </button>
      </div>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/* 补抽象资源表单                                                        */
/* ------------------------------------------------------------------ */

function GrantResourcesModal({ playerId, onClose, onDone, onError }: GrantModalProps) {
  const { t } = useT();
  const { token } = useAuth();
  const { content } = useContent();
  // 每个已注册抽象资源一个增量输入（留空 = 不动）
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resources = content?.abstractResources ?? [];

  const submit = async () => {
    if (!token || busy) return;
    setError(null);

    const payload: Record<string, number> = {};
    for (const [id, raw] of Object.entries(deltas)) {
      const trimmed = raw.trim();
      if (trimmed === '') continue;
      const value = Number(trimmed);
      if (!Number.isInteger(value) || value === 0) {
        setError(t('admin.player.err_resource_delta'));
        return;
      }
      payload[id] = value;
    }
    if (Object.keys(payload).length === 0) {
      setError(t('admin.player.err_grant_empty'));
      return;
    }

    setBusy(true);
    try {
      await grantResources(token, playerId, payload);
      onDone(t('admin.player.grant_resources_done'));
    } catch (e) {
      const message = e instanceof Error ? e.message : t('admin.player.op_failed');
      setError(message);
      onError(message);
      setBusy(false);
    }
  };

  return (
    <ModalShell title={t('admin.player.grant_resources')} onClose={onClose} busy={busy}>
      <p className="admin-player-modal-hint">{t('admin.player.hint_resources')}</p>
      {resources.map((res) => (
        <label key={res.id} className="admin-player-field">
          <span>{t(`resource.${res.id}.name`)}</span>
          <input
            type="number"
            value={deltas[res.id] ?? ''}
            placeholder={t('admin.player.placeholder_delta')}
            onChange={(e) => setDeltas((prev) => ({ ...prev, [res.id]: e.target.value }))}
            disabled={busy}
          />
        </label>
      ))}

      {error && <p className="shop-error">{error}</p>}

      <div className="admin-player-modal-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn" onClick={() => void submit()} disabled={busy}>
          {busy ? t('admin.player.saving') : t('admin.player.submit')}
        </button>
      </div>
    </ModalShell>
  );
}

/** 弹层外壳：管理页所有表单共用（遮罩 + 头部 + 关闭） */
function ModalShell({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="admin-player-modal-overlay" role="dialog" aria-modal="true">
      <section className="admin-player-modal">
        <header className="admin-player-modal-head">
          <h3>{title}</h3>
          <button
            type="button"
            className="ov-close"
            onClick={onClose}
            disabled={busy}
            aria-label={t('common.cancel')}
          >
            <Icon name="ui.close" size={14} />
          </button>
        </header>
        <div className="admin-player-form">{children}</div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 工具                                                                 */
/* ------------------------------------------------------------------ */

/** 列表摘要文本：等级 + 金币 + 背包格，一行说清账号状态 */
function summaryText(t: (key: string) => string, row: AdminPlayerListItem): string {
  const s = row.summary;
  const gold = s.abstract_resources.gold ?? 0;
  return `${t('admin.player.level')}${s.level} · ${t('resource.gold.name')} ${gold} · ${s.inventory_used}/${s.inventory_capacity}`;
}

/** 时间戳 → 本地可读时间（服务器落库毫秒，仅做展示格式化） */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}
