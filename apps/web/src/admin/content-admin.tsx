import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/auth.tsx';
import { useT } from '../i18n/index.ts';
import {
  fetchPackImpact,
  fetchPacks,
  updatePackEnabled,
  type AdminPack,
  type PackImpact,
} from './content-api.ts';

/**
 * 管理后台「内容」页签（task-41）。
 *
 * 语义：**只启停已编译进来的 pack**（方案 b），不做内容入库。
 * 开关写库后**重启 API 才生效**——这是后端已定决策（快照进程内只建一次，
 * 不做热重载）。因此本页把"重启后生效"作为一等公民展示：
 *   - 每行用 `restart_required`（后端给的"落盘值 ≠ 当前进程生效值"）标出待重启状态；
 *   - 切换成功后弹一条"需重启"的提示条，而不是假装已经生效。
 *
 * 停用警告：调 `GET :id/impact` 拿到"仍引用该包动作的存档数"，在确认框里展示，
 * 提醒管理员"现在停用、重启后，这些挂机中的玩家会因动作缺失而停止"。
 * 前端**只读**这个统计，不提供、也不触发任何玩家数据修改。
 */
export function ContentAdminTab() {
  const { t } = useT();
  const { token } = useAuth();

  const [packs, setPacks] = useState<AdminPack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 切换成功后的提示（含"重启后生效"）；与 error 分开，避免把成功当失败样式
  const [notice, setNotice] = useState<string | null>(null);
  // 停用确认：待停用的 pack + 只读影响面
  const [confirming, setConfirming] = useState<AdminPack | null>(null);
  const [impact, setImpact] = useState<PackImpact | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setPacks(await fetchPacks(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.content.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 启用：直接调接口（无破坏性），成功后提示重启 */
  const enable = async (pack: AdminPack) => {
    if (!token) return;
    setError(null);
    setNotice(null);
    try {
      await updatePackEnabled(token, pack.id, true);
      setNotice(t('admin.content.toggled_restart'));
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
    try {
      await updatePackEnabled(token, confirming.id, false);
      setConfirming(null);
      setImpact(null);
      setNotice(t('admin.content.toggled_restart'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.content.save_failed'));
    }
  };

  return (
    <div className="admin-content">
      <div className="admin-toolbar">
        <span className="admin-readonly">{t('admin.content.restart_hint')}</span>
        <button
          type="button"
          className="btn ghost btn-sm"
          onClick={() => void load()}
          disabled={loading}
        >
          {t('admin.content.refresh')}
        </button>
      </div>

      {error && <p className="shop-error">{error}</p>}
      {notice && <p className="admin-content-notice">{notice}</p>}

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
 *   停用 pack 后重启，已有存档里引用的动作/物品会"查无此内容"，
 *   正在挂机的玩家会因此停下。管理动作不可逆地影响玩家体验，
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
