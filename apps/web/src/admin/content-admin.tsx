import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/auth.tsx';
import { useT } from '../i18n/index.ts';
import { useContent } from '../content/content-context.tsx';
import {
  fetchDlcErrors,
  fetchPackImpact,
  fetchPacks,
  reloadPacks,
  updatePackEnabled,
  type AdminPack,
  type ContentReloadResult,
  type DlcErrorReport,
  type PackImpact,
} from './content-api.ts';

/**
 * 管理后台「内容」页签（task-41 / task-42）。
 *
 * 语义：**只启停已编译进来的 pack**（方案 b），不做内容入库。
 * 开关写库后**不自动换内存快照**，需管理员点「应用重载」一次性生效——
 * 这对应后端的显式重载（task-42）：`POST /api/admin/content/reload` 会重建快照
 * 并中断引用已停用内容的玩家动作。因此本页把"待应用"作为一等公民展示：
 *   - 每行用 `restart_required`（后端给的"落盘值 ≠ 当前生效值"）标出待应用状态；
 *   - 切换成功后弹一条"需点应用重载"的提示条，而不是假装已经生效。
 *
 * 停用警告：调 `GET :id/impact` 拿到"仍引用该包动作的存档数"，在确认框里展示，
 * 提醒管理员"应用重载后，这些挂机中的玩家动作会被中断"。
 * 前端**只读**这个统计，不提供、也不触发任何玩家数据修改。
 *
 * task-43：本页同时展示"加载失败的外部 DLC"（`GET /admin/content/dlc-errors`），
 * 让运维放错目录/写坏 manifest 时能在管理页直接看到可诊断原因，而不必翻服务日志。
 */
export function ContentAdminTab() {
  const { t } = useT();
  const { token } = useAuth();
  // 重载成功后刷新内容快照，让管理员自己的游戏视图立即同步（否则要等刷新页面）
  const { refreshContent } = useContent();

  const [packs, setPacks] = useState<AdminPack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 切换成功后的提示（含"需应用重载"）；与 error 分开，避免把成功当失败样式
  const [notice, setNotice] = useState<string | null>(null);
  // 停用确认：待停用的 pack + 只读影响面
  const [confirming, setConfirming] = useState<AdminPack | null>(null);
  const [impact, setImpact] = useState<PackImpact | null>(null);
  // 重载进行中/结果：结果一次展示到位（启用集合、校验错误、影响面、被中断动作、DLC 加载失败）
  const [reloading, setReloading] = useState(false);
  const [reloadResult, setReloadResult] = useState<ContentReloadResult | null>(null);
  // 外部 DLC 加载失败（只读诊断）；与 packs 同时刷新，坏了也不影响本页其它功能
  const [dlcErrors, setDlcErrors] = useState<DlcErrorReport | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setPacks(await fetchPacks(token));
      // 诊断信息单独拉，失败（如旧后端）只留空，不把整页判为加载失败
      try {
        setDlcErrors(await fetchDlcErrors(token));
      } catch {
        setDlcErrors(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.content.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 启用：直接调接口（无破坏性），成功后提示需应用重载 */
  const enable = async (pack: AdminPack) => {
    if (!token) return;
    setError(null);
    setNotice(null);
    setReloadResult(null);
    try {
      await updatePackEnabled(token, pack.id, true);
      setNotice(t('admin.content.toggled_pending'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.content.save_failed'));
    }
  };

  /** 停用：先拉只读影响面再确认（有影响时警告更强） */
  const askDisable = async (pack: AdminPack) => {
    if (!token) return;
    setError(null);
    setNotice(null);
    setImpact(null);
    setConfirming(pack);
    try {
      setImpact(await fetchPackImpact(token, pack.id));
    } catch {
      // 影响面拿不到不影响停用，只是提示降级；静默留空
      setImpact(null);
    }
  };

  const confirmDisable = async () => {
    if (!token || !confirming) return;
    setError(null);
    setReloadResult(null);
    try {
      await updatePackEnabled(token, confirming.id, false);
      setConfirming(null);
      setImpact(null);
      setNotice(t('admin.content.toggled_pending'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.content.save_failed'));
    }
  };

  /** 应用重载：换服务端快照 + 中断引用被停用内容的动作；成功后同步本页与游戏视图 */
  const applyReload = async () => {
    if (!token || reloading) return;
    setReloading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await reloadPacks(token);
      setReloadResult(result);
      setPacks(result.packs);
      // 让管理员自己的玩家视图立即用新内容集合（技能/动作列表已变）
      await refreshContent();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.content.reload_failed'));
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="admin-content">
      <div className="admin-toolbar">
        <span className="admin-readonly">{t('admin.content.reload_hint')}</span>
        <div className="admin-toolbar-actions">
          {/* 应用重载：把落盘开关一次性应用到运行中的内容快照 */}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void applyReload()}
            disabled={reloading}
          >
            {reloading ? t('admin.content.reloading') : t('admin.content.reload')}
          </button>
          <button
            type="button"
            className="btn ghost btn-sm"
            onClick={() => void load()}
            disabled={loading}
          >
            {t('admin.content.refresh')}
          </button>
        </div>
      </div>

      {error && <p className="shop-error">{error}</p>}
      {notice && <p className="admin-content-notice">{notice}</p>}
      {reloadResult && (
        <div className="admin-content-notice">
          <p>{t('admin.content.reload_done')}</p>
          <p>
            {t('admin.content.reload_enabled')}:{' '}
            <span className="admin-mono">
              {reloadResult.enabled_packs.length > 0
                ? reloadResult.enabled_packs.join(', ')
                : t('admin.content.reload_none')}
            </span>
          </p>
          <p>
            {t('admin.content.reload_errors')}: {reloadResult.validate_errors} ·{' '}
            {t('admin.content.reload_affected')}: {reloadResult.affected_players} ·{' '}
            {t('admin.content.reload_load_errors')}: {reloadResult.load_errors}
          </p>
          {reloadResult.interrupted_actions.length > 0 && (
            <p>
              {t('admin.content.reload_interrupted')}:{' '}
              <span className="admin-mono">{reloadResult.interrupted_actions.join(', ')}</span>
            </p>
          )}
        </div>
      )}

      {/* 外部 DLC 加载失败：放目录即可见，错误在这里直接可读，不必翻服务日志 */}
      {dlcErrors && dlcErrors.errors.length > 0 && (
        <section className="admin-dlc-errors">
          <h3>
            {t('admin.content.dlc_errors_title')} ({dlcErrors.errors.length})
          </h3>
          <p className="admin-readonly">
            {t('admin.content.dlc_errors_dir')}: <span className="admin-mono">{dlcErrors.dir}</span>
          </p>
          <ul>
            {dlcErrors.errors.map((item) => (
              <li key={`${item.dir}-${item.stage}`}>
                <span className="admin-content-badge is-pending">{item.stage}</span>
                <span className="admin-mono">{item.dir}</span>
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
          <p className="admin-readonly">{t('admin.content.dlc_errors_hint')}</p>
        </section>
      )}

      <div className="admin-content-list">
        {packs.map((pack) => (
          <article
            key={pack.id}
            className={`admin-content-pack ${
              pack.enabled ? 'is-on' : 'is-off'
            } ${pack.restart_required ? 'is-pending' : ''}`}
          >
            <div className="admin-content-main">
              <div className="admin-content-title">
                <span className="admin-mono">{pack.id}</span>
                <span className="admin-content-name">{pack.name}</span>
                <span className="admin-content-version">v{pack.version}</span>
                {pack.external && (
                  <span className="admin-content-badge is-external">
                    {t('admin.content.external_badge')}
                  </span>
                )}
              </div>
              <div className="admin-content-meta">
                <span
                  className={`admin-content-badge ${pack.enabled ? 'is-on' : 'is-off'}`}
                >
                  {pack.enabled ? t('admin.content.enabled') : t('admin.content.disabled')}
                </span>
                {pack.restart_required && (
                  <span className="admin-content-badge is-pending">
                    {t('admin.content.restart_required')}
                  </span>
                )}
                {!pack.active && (
                  <span className="admin-content-badge is-inactive">
                    {t('admin.content.inactive_now')}
                  </span>
                )}
              </div>
            </div>

            {/* 就地开关：启用直接调、停用先确认（可能影响挂机中的存档） */}
            <button
              type="button"
              className={`btn btn-sm ${pack.enabled ? 'admin-content-danger' : ''}`}
              onClick={() => (pack.enabled ? void askDisable(pack) : void enable(pack))}
            >
              {pack.enabled ? t('admin.content.disable') : t('admin.content.enable')}
            </button>
          </article>
        ))}
        {packs.length === 0 && !loading && (
          <p className="admin-empty">{t('admin.content.empty')}</p>
        )}
      </div>

      {confirming && (
        <DisableConfirm
          pack={confirming}
          impact={impact}
          onCancel={() => {
            setConfirming(null);
            setImpact(null);
          }}
          onConfirm={confirmDisable}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 停用确认（含只读影响面警告）                                          */
/* ------------------------------------------------------------------ */

interface DisableConfirmProps {
  pack: AdminPack;
  impact: PackImpact | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * 停用二次确认。
 *
 * 为什么必须有这一步？
 *   停用 pack 后应用重载，已有存档里引用的动作/物品会"查无此内容"，
 *   正在挂机的玩家动作会被中断。管理动作不可逆地影响玩家体验，
 *   必须在执行前把影响规模摆出来，并明确"不会自动清洗玩家数据"。
 */
function DisableConfirm({ pack, impact, onCancel, onConfirm }: DisableConfirmProps) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  const affected = impact?.affected_saves ?? 0;

  return (
    <div className="admin-content-modal-overlay" role="dialog" aria-modal="true">
      <section className="admin-content-modal">
        <header className="admin-content-modal-head">
          <h3>{t('admin.content.confirm_disable_title')}</h3>
        </header>
        <p className="admin-content-confirm-body">
          {pack.id} · {pack.name} (v{pack.version})
        </p>

        {impact === null ? (
          <p className="admin-content-confirm-hint">{t('admin.content.impact_unknown')}</p>
        ) : affected > 0 ? (
          <p className="admin-content-confirm-warn">
            {t('admin.content.impact_warning').replace('{n}', String(affected))}
          </p>
        ) : (
          <p className="admin-content-confirm-hint">{t('admin.content.impact_none')}</p>
        )}

        {impact && impact.affected_actions.length > 0 && (
          <p className="admin-content-confirm-actions">
            <span>{t('admin.content.affected_actions')}:</span>
            <span className="admin-mono">{impact.affected_actions.join(', ')}</span>
          </p>
        )}

        <p className="admin-content-confirm-hint">{t('admin.content.no_cleanup_hint')}</p>

        <div className="admin-content-modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn admin-content-danger"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? t('admin.content.saving') : t('admin.content.disable')}
          </button>
        </div>
      </section>
    </div>
  );
}
