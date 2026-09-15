import { useEffect, useRef, useState } from 'react';
import { ACTIONS, StopReason } from '@lazycraft/shared';
import type { SettleReport, ItemDelta } from '@lazycraft/shared';
import { useT } from '../i18n/index.ts';
import { useAction } from '../action/action-context.tsx';

/**
 * 中栏：当前活动演出层（进度条 + 停止按钮 + 结算报告）
 *
 * 为什么用 rAF 直接改 DOM style 而不是 setState + React 渲染？
 *   60fps 的 React 重渲染会拖慢整页；进度条视觉变化完全可以在
 *   ref + style.transform 层面完成。React 只负责容器存在性渲染，
 *   每帧的"填充率"由本组件自己的 rAF 循环直接写到 DOM，绕过
 *   虚拟 DOM，性能开销接近原生。
 *
 * 为什么进度条"满了就立即调 sync 而不是自己滚动到下一圈"？
 *   本地动画是演出，演出到 tick 边界就该向编剧（服务器）确认剧情。
 *   前端自己滚动 = 前端自己决定"现在是第几 tick"，这违反服务器权威。
 *   让 syncActive() 拉回最新的 next_tick_at，动画自然进入下一圈。
 */

/** 把 SettlementReport.stop_reason 映射到 i18n key */
function reasonKey(reason: StopReason): string {
  switch (reason) {
    case StopReason.NoTicks:
      return 'settle.reason.no_ticks';
    case StopReason.DurationCap:
      return 'settle.reason.duration_cap';
    case StopReason.InputExhausted:
      return 'settle.reason.input_exhausted';
    case StopReason.InventoryFull:
      return 'settle.reason.inventory_full';
  }
}

function ItemDeltaList({ items }: { items: ItemDelta[] }) {
  const { t } = useT();
  return (
    <ul className="settle-items">
      {items.map((d) => (
        <li key={d.item_id}>
          {t(`item.${d.item_id}.name`)} ×{d.amount}
        </li>
      ))}
    </ul>
  );
}

function SettleCard({ report }: { report: SettleReport }) {
  const { t } = useT();
  const hasGained = report.gained.length > 0;
  const hasConsumed = report.consumed.length > 0;
  const expEntries = Object.entries(report.exp_gained);

  return (
    <article className="settle-card" aria-live="polite">
      <header className="settle-header">
        <h3>{t('settle.title')}</h3>
      </header>
      <dl className="settle-meta">
        <div>
          <dt>{t('settle.ticks')}</dt>
          <dd>{report.ticks}</dd>
        </div>
        <div>
          <dt>{t('settle.duration')}</dt>
          <dd>
            {report.effective_seconds}
            {t('common.seconds')}
          </dd>
        </div>
        <div>
          <dt aria-label="stop reason">{/* 屏幕阅读器可读列名 */}</dt>
          <dd className="settle-reason">{t(reasonKey(report.stop_reason))}</dd>
        </div>
      </dl>
      {expEntries.length > 0 && (
        <p className="settle-exp">
          {t('settle.exp_gained')}: {expEntries.map(([skillId, amt]) => `${t(`skill.${skillId}.name`)} +${amt}`).join(', ')}
        </p>
      )}
      {hasGained && (
        <section className="settle-section">
          <h4>{t('settle.gained')}</h4>
          <ItemDeltaList items={report.gained} />
        </section>
      )}
      {hasConsumed && (
        <section className="settle-section">
          <h4>{t('settle.consumed')}</h4>
          <ItemDeltaList items={report.consumed} />
        </section>
      )}
      {!hasGained && !hasConsumed && expEntries.length === 0 && <p className="settle-empty">{t('settle.no_changes')}</p>}
    </article>
  );
}

export function ActivityPanel() {
  const { t } = useT();
  const { active, nextTickAt, intervalMs, report, pending, error, progressRef, stop, dismissReport } = useAction();

  /**
   * 进度条填充节点的 DOM ref：rAF 每帧直接写 transform: scaleX(...)，
   * 不通过 React，避免 60fps 的虚拟 DOM diff 开销。
   */
  const fillRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // 当前动作配置：进度条上方的名称、产出预览都从这里取
  const actionConfig = active ? ACTIONS.find((a) => a.id === active.action_id) : null;

  // rAF 循环：把 progressRef.current 写到 DOM；active 变化时重挂
  useEffect(() => {
    if (!active) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (fillRef.current) fillRef.current.style.transform = 'scaleX(0)';
      return;
    }
    const step = () => {
      if (fillRef.current) {
        // scaleX 而不用 width：transform 不触发布局，合成器层就能完成动画
        fillRef.current.style.transform = `scaleX(${progressRef.current})`;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [active, progressRef]);

  // 停止按钮错误需要本地保留显示（context 的 error 会在下次 start 时被清）
  const [localError, setLocalError] = useState<string | null>(null);
  const handleStop = async () => {
    setLocalError(null);
    try {
      await stop();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : '操作失败');
    }
  };

  const showReport = report !== null && active === null;
  const errorMessage = localError ?? error;

  return (
    <div className="activity-panel">
      {active && actionConfig ? (
        <section className="activity-card" aria-live="polite">
          <header className="activity-header">
            <h2>{t(`action.${actionConfig.id}.name`)}</h2>
            <span className="activity-skill">{t(`skill.${actionConfig.skill_id}.name`)}</span>
          </header>
          {/* 进度条：rAF 直接写 fill 的 transform；这里只渲染容器 */}
          <div
            className="activity-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressRef.current * 100)}
            aria-label={t('activity.progress')}
            data-tutorial="progress"
          >
            <div ref={fillRef} className="activity-progress-fill" />
          </div>
          <div className="activity-meta">
            {nextTickAt !== null && intervalMs !== null && (
              <span className="activity-interval">
                {t('actions.interval')}: {(intervalMs / 1000).toFixed(1)}
                {t('common.seconds')}
              </span>
            )}
            {Object.keys(actionConfig.output_items).length > 0 && (
              <span className="activity-outputs">
                {t('actions.outputs')}:
                {Object.entries(actionConfig.output_items)
                  .map(([itemId, qty]) => ` ${t(`item.${itemId}.name`)}×${qty}`)
                  .join(', ')}
              </span>
            )}
          </div>
          <div className="activity-controls">
            <button
              type="button"
              className="activity-stop"
              onClick={handleStop}
              disabled={pending}
              /* 教程"收菜"步骤锚点 */
              data-tutorial="harvest"
            >
              {t('activity.stop_and_settle')}
            </button>
          </div>
          {errorMessage && <p className="activity-error">{errorMessage}</p>}
        </section>
      ) : (
        <section className="activity-card activity-card-idle">
          <header className="activity-header">
            <h2>{t('activity.idle')}</h2>
          </header>
          <p className="activity-empty">{t('activity.no_action')}</p>
        </section>
      )}

      {showReport && (
        <div className="settle-wrapper">
          <SettleCard report={report} />
          <button type="button" className="settle-dismiss" onClick={dismissReport}>
            {t('common.confirm')}
          </button>
        </div>
      )}

    </div>
  );
}
