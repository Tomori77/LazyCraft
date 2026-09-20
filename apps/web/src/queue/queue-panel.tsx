import { useCallback, useEffect, useMemo, useState } from 'react';
import { QUEUE_MAX_SLOTS, QUEUE_UNLOCKED_SLOTS, type ActionQueueItem } from '@lazycraft/shared';
import { useAuth } from '../auth/auth.tsx';
import { useT } from '../i18n/index.ts';
import { useContent } from '../content/content-context.tsx';
import { useAction } from '../action/action-context.tsx';
import { Icon } from '../icons/icon.tsx';
import { actionIconName, skillIconName } from '../icons/resolve-icon.ts';
import {
  fetchQueue,
  enqueueAction,
  updateQueueItem,
  removeQueueItem,
  clearActionQueue,
  type QueueSlots,
} from '../action/api.ts';

/**
 * 动作队列悬浮页（task-36，P4-7）。
 *
 * 语义（《06 §十》用户拍板）：
 *   - 每项 = 技能 → 对应工作 + 工作次数（按圈数，N 圈 = N 次产出）；
 *   - 完成后该项从队列移除，继续下一项，直到队列为空（不从头循环）；
 *   - 共 10 槽，本体仅开放前 3 槽，其余待 DLC 解锁。
 *
 * 服务器权威：本组件只提交意图（技能/工作/圈数），推进与结算全在服务端；
 * 操作后按响应刷新列表，不自行推演队列状态。
 */

interface QueuePanelProps {
  onClose: () => void;
}

/** 编辑器状态：区分"新增一行"与"编辑已有一行" */
type EditorState =
  | { mode: 'add' }
  | { mode: 'edit'; index: number; item: ActionQueueItem };

export function QueuePanel({ onClose }: QueuePanelProps) {
  const { t } = useT();
  const { token } = useAuth();
  const { content } = useContent();
  const { refreshQueue, settleNonce } = useAction();

  const [items, setItems] = useState<ActionQueueItem[]>([]);
  const [slots, setSlots] = useState<QueueSlots>({
    max: QUEUE_MAX_SLOTS,
    unlocked: QUEUE_UNLOCKED_SLOTS,
  });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetchQueue(token);
      setItems(res.action_queue);
      setSlots(res.queue_slots);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('queue.load_failed'));
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // 逐圈结算会推进队列：结算后自动刷新，玩家能看到当前进度（当前正在跑的是哪项）
  useEffect(() => {
    if (settleNonce === 0) return;
    void load();
  }, [settleNonce, load]);

  const skills = useMemo(() => content?.skills ?? [], [content]);
  const actions = useMemo(() => content?.actions ?? [], [content]);

  const actionName = (id: string) => t(`action.${id}.name`);
  const skillName = (id: string) => t(`skill.${id}.name`);

  const findAction = (id: string) => actions.find((a) => a.id === id) ?? null;

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      // 操作后立即按权威数据刷新本列表；refreshQueue 额外负责"空闲时踢一脚起跑队首"
      await load();
      await refreshQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('queue.op_failed'));
    } finally {
      setBusy(false);
    }
  };

  const submitEditor = async (skillId: string, actionId: string, count: number) => {
    if (!token) return;
    await run(async () => {
      if (editor?.mode === 'edit') {
        await updateQueueItem(token, editor.index, { skillId, actionId, count });
      } else {
        await enqueueAction(token, skillId, actionId, count);
      }
      setEditor(null);
    });
  };

  const removeItem = (index: number) =>
    run(async () => {
      if (token) await removeQueueItem(token, index);
    });

  const clearAll = () =>
    run(async () => {
      if (token) await clearActionQueue(token);
    });

  // 渲染 10 行槽位：前 unlocked 行可用，其余显示未解锁
  const rows = Array.from({ length: slots.max }, (_, index) => index);
  const used = items.length;

  return (
    <>
      <div className="ov-head">
        <h2>
          {t('queue.title')}
          <span className="ov-sub">
            {t('queue.slots')} {used} / {slots.unlocked}
            {slots.max > slots.unlocked ? ` (${t('queue.total_slots')} ${slots.max})` : ''}
          </span>
        </h2>
        <button type="button" className="ov-close" onClick={onClose} aria-label={t('common.cancel')}>
          <Icon name="ui.close" size={14} />
        </button>
      </div>

      <div className="overlay-body queue">
        {error && <p className="queue-error">{error}</p>}

        <div className="queue-list">
          {rows.map((index) => {
            const item = items[index];
            const unlocked = index < slots.unlocked;
            const running = false; // 是否正在跑由父级 overlay 之外的活动状态决定，此处不渲染高亮
            void running;

            if (!unlocked) {
              return (
                <div key={index} className="queue-row is-locked">
                  <span className="queue-index">{index + 1}</span>
                  <span className="queue-lock">{t('queue.locked')}</span>
                </div>
              );
            }

            if (!item) {
              // 空槽：给出"新增"入口（仅第一个空槽显示，避免多个重复按钮）
              const isFirstEmpty = index === used;
              return (
                <div key={index} className="queue-row is-empty">
                  <span className="queue-index">{index + 1}</span>
                  {isFirstEmpty && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => setEditor({ mode: 'add' })}
                    >
                      {t('queue.add')}
                    </button>
                  )}
                </div>
              );
            }

            const action = findAction(item.action_id);
            return (
              <div key={index} className="queue-row">
                <span className="queue-index">{index + 1}</span>
                <span className="queue-ico" aria-hidden="true">
                  <Icon
                    name={action ? actionIconName(action) : skillIconName(item.skill_id)}
                    size={16}
                    fallback={actionName(item.action_id).charAt(0)}
                  />
                </span>
                <span className="queue-name">
                  <b>{actionName(item.action_id)}</b>
                  <small>{skillName(item.skill_id)}</small>
                </span>
                <span className="queue-count">
                  {item.count} {t('queue.times')}
                </span>
                <span className="queue-ops">
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    disabled={busy}
                    onClick={() => setEditor({ mode: 'edit', index, item })}
                  >
                    {t('queue.edit')}
                  </button>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    disabled={busy}
                    onClick={() => void removeItem(index)}
                  >
                    {t('queue.remove')}
                  </button>
                </span>
              </div>
            );
          })}
        </div>

        {used > 0 && (
          <div className="queue-foot">
            <button type="button" className="btn ghost" disabled={busy} onClick={clearAll}>
              {t('queue.clear')}
            </button>
          </div>
        )}
      </div>

      {editor && (
        <QueueEditor
          skills={skills.map((s) => ({ id: s.id, name: skillName(s.id) }))}
          actionsBySkill={(skillId) =>
            actions
              .filter((a) => a.skill_id === skillId)
              .map((a) => ({ id: a.id, name: actionName(a.id), required_level: a.required_level }))
          }
          initial={
            editor.mode === 'edit'
              ? {
                  skillId: editor.item.skill_id,
                  actionId: editor.item.action_id,
                  count: editor.item.count,
                }
              : undefined
          }
          busy={busy}
          onSubmit={submitEditor}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 技能 → 工作选择 + 圈数编辑弹窗                                        */
/* ------------------------------------------------------------------ */

interface SkillOption {
  id: string;
  name: string;
}

interface ActionOption {
  id: string;
  name: string;
  required_level: number;
}

interface QueueEditorProps {
  skills: SkillOption[];
  actionsBySkill: (skillId: string) => ActionOption[];
  initial?: { skillId: string; actionId: string; count: number };
  busy: boolean;
  onSubmit: (skillId: string, actionId: string, count: number) => Promise<void>;
  onClose: () => void;
}

/**
 * 每项 = 选「技能 → 对应工作」+ 圈数。
 * 非战斗技能优先（队列用于挂机生产）；动作列表按该技能动态过滤。
 */
function QueueEditor({ skills, actionsBySkill, initial, busy, onSubmit, onClose }: QueueEditorProps) {
  const { t } = useT();
  const nonCombat = skills;
  const [skillId, setSkillId] = useState(initial?.skillId ?? nonCombat[0]?.id ?? '');
  const options = actionsBySkill(skillId);
  const [actionId, setActionId] = useState(initial?.actionId ?? options[0]?.id ?? '');
  const [count, setCount] = useState(initial?.count ?? 10);

  // 切换技能后，若当前工作不属于新技能则自动落到首个可选工作
  useEffect(() => {
    if (!options.some((a) => a.id === actionId)) {
      setActionId(options[0]?.id ?? '');
    }
  }, [options, actionId]);

  const clamp = (n: number) => Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));

  const confirm = async () => {
    if (!skillId || !actionId || count < 1) return;
    await onSubmit(skillId, actionId, count);
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <section
        className="settings-modal qty-modal"
        role="dialog"
        aria-label={t('queue.editor_title')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-header">
          <h2>{t('queue.editor_title')}</h2>
          <button className="settings-close" onClick={onClose} aria-label={t('common.cancel')}>
            ×
          </button>
        </header>

        <div className="settings-field">
          <label htmlFor="queue-skill">{t('queue.skill')}</label>
          <select id="queue-skill" value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            {nonCombat.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-field">
          <label htmlFor="queue-action">{t('queue.action')}</label>
          <select id="queue-action" value={actionId} onChange={(e) => setActionId(e.target.value)}>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({t('queue.req_level')} {a.required_level})
              </option>
            ))}
          </select>
        </div>

        <div className="settings-field">
          <label htmlFor="queue-count">{t('queue.count')}</label>
          <div className="qty-stepper">
            <button type="button" className="btn ghost btn-sm" onClick={() => setCount((c) => Math.max(1, c - 1))}>
              −
            </button>
            <input
              id="queue-count"
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(clamp(Number(e.target.value)))}
            />
            <button type="button" className="btn ghost btn-sm" onClick={() => setCount((c) => c + 1)}>
              +
            </button>
          </div>
        </div>

        <div className="qty-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn" onClick={confirm} disabled={busy || !actionId}>
            {t('common.confirm')}
          </button>
        </div>
      </section>
    </div>
  );
}
