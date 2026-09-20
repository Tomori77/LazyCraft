import { useCallback, useEffect, useState } from 'react';
import type { AdminAuditPage } from './api.ts';
import { fetchAuditLogs } from './api.ts';
import { useAuth } from '../auth/auth.tsx';
import { useT } from '../i18n/index.ts';
import { Icon } from '../icons/icon.tsx';

/**
 * 管理后台外壳（task-38）。
 *
 * 容器形态取舍：**全屏独立控制台**，而不是沿用中栏悬浮页。
 *   悬浮页只覆盖中栏（1280×720 下中栏约 620px 宽），放商店表格/玩家列表/审计
 *   这类多列表格会横向溢出或被迫裁字段；管理操作是"高信息密度、成批处理"
 *   的场景，与游戏内"边看右栏边操作"的悬浮页用途不同。故这里用 fixed 全屏层，
 *   右栏/顶部资源条被覆盖——这与"管理后台是独立工作区"的心智一致。
 *
 * 四个页签中「审计」在本任务实现（列表 + 分页 + 按目标过滤），
 * 「商店 / 玩家 / 内容」为占位，由 task-39 / 40 / 41 填充。
 *
 * 权限：入口仅在 `player.role === 'admin'` 时渲染（见 game-layout.tsx）；
 * 即便有人绕过前端，后端 `/api/admin/*` 仍会 403，前端权限只是体验层。
 */
type AdminTab = 'shop' | 'players' | 'content' | 'audit';

const TABS: AdminTab[] = ['shop', 'players', 'content', 'audit'];

interface AdminPanelProps {
  onClose: () => void;
}

export function AdminPanel({ onClose }: AdminPanelProps) {
  const { t } = useT();
  const [tab, setTab] = useState<AdminTab>('shop');

  // Esc 关闭：与其它弹层一致，减少鼠标往返
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="admin-overlay" role="dialog" aria-modal="true" aria-label={t('admin.title')}>
      <section className="admin-console">
        <header className="admin-head">
          <h2>
            <Icon name="ui.admin" size={18} />
            {t('admin.title')}
          </h2>
          <button type="button" className="ov-close" onClick={onClose} aria-label={t('admin.close')}>
            <Icon name="ui.close" size={14} />
          </button>
        </header>

        <nav className="admin-tabs" role="tablist">
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`admin-tab ${tab === key ? 'is-active' : ''}`}
              onClick={() => setTab(key)}
            >
              {t(`admin.tab.${key}`)}
            </button>
          ))}
        </nav>

        <div className="admin-body">
          {tab === 'audit' ? <AuditTab /> : <TabPlaceholder tab={tab} />}
        </div>
      </section>
    </div>
  );
}

/** 未实现页签的占位：明确告诉使用者"内容在后续任务"，不假装可用 */
function TabPlaceholder({ tab }: { tab: AdminTab }) {
  const { t } = useT();
  return (
    <div className="admin-placeholder">
      <p className="admin-placeholder-title">{t(`admin.tab.${tab}`)}</p>
      <p>{t('admin.placeholder')}</p>
    </div>
  );
}

const PAGE_SIZE = 20;

/**
 * 审计页签：只读列表 + 分页 + 按目标过滤。
 *
 * 为什么把"操作者/明细"原样展示为 JSON？
 *   审计明细形状随管理动作而异，前端没有权威 schema 去美化它；
 *   原样展示（截断）比编造字段更诚实，也方便排查时直接看原文。
 */
function AuditTab() {
  const { t } = useT();
  const { token } = useAuth();
  const [data, setData] = useState<AdminAuditPage | null>(null);
  const [page, setPage] = useState(1);
  // 过滤分"草稿"与"已应用"两份：输入框每次按键都改草稿，
  // 只有点「查询」才把草稿提交为已应用过滤——避免每敲一个字发一次请求（task-28 的教训）。
  const [draftType, setDraftType] = useState('');
  const [draftId, setDraftId] = useState('');
  const [filter, setFilter] = useState<{ targetType: string; targetId: string }>({
    targetType: '',
    targetId: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(
        await fetchAuditLogs(token, {
          page,
          limit: PAGE_SIZE,
          targetType: filter.targetType || undefined,
          targetId: filter.targetId || undefined,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.audit.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [token, page, filter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilter = () => {
    setPage(1);
    setFilter({ targetType: draftType.trim(), targetId: draftId.trim() });
  };

  const resetFilter = () => {
    setDraftType('');
    setDraftId('');
    setPage(1);
    setFilter({ targetType: '', targetId: '' });
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="admin-audit">
      <div className="admin-toolbar">
        <div className="admin-filter">
          <input
            type="text"
            placeholder={t('admin.audit.filter_target_type')}
            value={draftType}
            onChange={(e) => setDraftType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilter();
            }}
          />
          <input
            type="text"
            placeholder={t('admin.audit.filter_target_id')}
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilter();
            }}
          />
          <button type="button" className="btn ghost btn-sm" onClick={applyFilter}>
            {t('admin.audit.filter_apply')}
          </button>
          <button type="button" className="btn ghost btn-sm" onClick={resetFilter}>
            {t('admin.audit.filter_reset')}
          </button>
        </div>
        <span className="admin-readonly">{t('admin.audit.readonly_hint')}</span>
      </div>

      {error && <p className="shop-error">{error}</p>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.audit.time')}</th>
              <th>{t('admin.audit.operator')}</th>
              <th>{t('admin.audit.action')}</th>
              <th>{t('admin.audit.target')}</th>
              <th>{t('admin.audit.detail')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((row) => (
              <tr key={row.id}>
                <td className="admin-time">{formatTime(row.created_at)}</td>
                <td className="admin-mono">{shortId(row.admin_account_id)}</td>
                <td className="admin-mono">{row.action}</td>
                <td className="admin-mono">
                  {row.target_type}
                  {row.target_id ? `:${row.target_id}` : ''}
                </td>
                <td className="admin-detail" title={formatDetail(row.detail)}>
                  {formatDetail(row.detail)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && !loading && (
          <p className="admin-empty">{t('admin.audit.empty')}</p>
        )}
      </div>

      <div className="admin-foot">
        <span>
          {t('admin.audit.total')} {data?.total ?? 0}
        </span>
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
    </div>
  );
}

/** 时间戳 → 本地可读时间（审计按服务器时间落库，这里仅做展示格式化） */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

/** 账号 id 只显示前 8 位：审计表里足够区分操作者，又不会撑破列宽 */
function shortId(id: string): string {
  return id.slice(0, 8);
}

/** 明细序列化：截断到 200 字符，避免一条大 JSON 把行高撑爆 */
function formatDetail(detail: unknown): string {
  if (detail === null || detail === undefined) return '-';
  try {
    const text = JSON.stringify(detail);
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  } catch {
    return String(detail);
  }
}
