import { useEffect } from 'react';
import { useT } from '../i18n/index.ts';
import { useAction } from '../action/action-context.tsx';
import { useQuests } from './quest-context.tsx';
import type { QuestView } from './api.ts';

/**
 * 任务面板：主线 + 日常任务列表（右栏）
 *
 * 为什么把"主线完成后日常列表出现"做成纯渲染而不是前端过滤？
 *   后端 list() 只返回可见的任务（未达前置的不下发），前端只是渲染。
 *   这避免了"前端偷偷看到未解锁任务"的信息泄漏，也保持服务器权威。
 *
 * 为什么结算后主动 refresh？
 *   collect_item 任务的进度从背包现算，玩家收菜后背包数量变化，
 *   前端需要重拉一次列表让进度条跟上——用 useAction().report 当触发器，
 *   因为 stop 成功后 report 一定会有值。
 */

function progressClamp(quest: QuestView): number {
  if (quest.goal_count <= 0) return 1;
  return Math.min(1, quest.progress / quest.goal_count);
}

function rewardPreview(quest: QuestView, t: (k: string) => string): string {
  const parts = Object.entries(quest.reward.items)
    .map(([itemId, qty]) => `${t(`item.${itemId}.name`)}×${qty}`);
  return parts.join(', ');
}

function QuestRow({ quest }: { quest: QuestView }) {
  const { t } = useT();
  const { accept, claim } = useQuests();
  const name = t(`quest.${quest.i18n_key}.name`);
  const description = t(`quest.${quest.i18n_key}.description`);
  const ratio = progressClamp(quest);
  const ready = quest.accepted && !quest.completed && quest.progress >= quest.goal_count;

  return (
    <li className={`quest-row${quest.completed ? ' is-completed' : ''}`}>
      <div className="quest-head">
        <span className="quest-name">{name}</span>
        {quest.completed && <span className="quest-badge-done">{t('quest.done')}</span>}
      </div>
      <p className="quest-desc">{description}</p>
      <div className="quest-progress" role="progressbar" aria-valuemin={0} aria-valuemax={quest.goal_count} aria-valuenow={quest.progress}>
        <div className="quest-progress-fill" style={{ transform: `scaleX(${ratio})` }} />
      </div>
      <div className="quest-meta">
        <span className="quest-progress-text">
          {quest.progress}/{quest.goal_count}
        </span>
        <span className="quest-reward">{t('quest.reward')}: {rewardPreview(quest, t)}</span>
      </div>
      {!quest.accepted && (
        <button type="button" className="quest-btn" onClick={() => void accept(quest.id)}>
          {t('quest.accept')}
        </button>
      )}
      {ready && (
        <button type="button" className="quest-btn quest-btn-claim" onClick={() => void claim(quest.id)}>
          {t('quest.claim')}
        </button>
      )}
      {/* 已领取但未达标时只显示进度，不出按钮——避免可点击但没效果的诱导 */}
    </li>
  );
}

export function QuestPanel() {
  const { t } = useT();
  const { quests, loading, error, refresh } = useQuests();
  const { report, active } = useAction();

  // 结算完成 / 活动停止后，背包变了——重拉任务让进度跟上
  useEffect(() => {
    if (!report && !active) return;
    void refresh();
  }, [report, active, refresh]);

  return (
    <section className="quest-panel" aria-label={t('quest.panel_title')}>
      <header className="quest-header">
        <h2>{t('quest.panel_title')}</h2>
        <button type="button" className="quest-refresh" onClick={() => void refresh()} disabled={loading}>
          {t('common.loading')}
        </button>
      </header>
      {error && <p className="quest-error">{error}</p>}
      {quests.length === 0 && !loading && (
        <p className="quest-empty">{t('quest.empty')}</p>
      )}
      <ul className="quest-list">
        {quests.map((q) => (
          <QuestRow key={q.id} quest={q} />
        ))}
      </ul>
    </section>
  );
}
