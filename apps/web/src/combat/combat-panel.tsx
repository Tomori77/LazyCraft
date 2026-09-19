import { useCallback, useEffect, useRef, useState } from 'react';
import { levelFromExp, PLAYER_BASE_HP, PLAYER_HP_PER_LEVEL } from '@lazycraft/shared';
import { useT } from '../i18n/index.ts';
import { apiGet } from '../lib/api.ts';
import { useAuth } from '../auth/auth.tsx';
import { useCombat } from './combat-context.tsx';
import type { CombatLogEntry } from '@lazycraft/shared';

/**
 * 右栏战斗面板（task-18 UI）
 *
 * 布局：无战斗时 = 敌人列表 + 开始按钮；战斗中 = 双血条 + 日志框 + 停止按钮；
 * 战斗结束后 = 总结报告卡片。
 *
 * 为什么攻击动画用 CSS keyframes + ref 触发而不是 React state 切换 class：
 *   玩家攻击每 2.7s 一次、敌人每 3s；动画是高频视觉反馈（~300ms），
 *   用 setState 会让整个面板在 300ms 内重渲染两次。改成在 useEffect 里
 *   对比日志长度增量 → 直接 animationName 写 DOM style，绕过 React 渲染管线。
 *   与 task-11 进度条的 rAF 演出同理：本地动画只负责"演"，决定权永远在服务端。
 */

interface SkillRecord {
  exp?: number;
}
interface SaveDataView {
  skills?: Record<string, SkillRecord>;
}

/** 从存档推导玩家当前生命上限（与后端 playerStats 对齐的最简实现） */
function usePlayerMaxHp(): number {
  const { token } = useAuth();
  const [maxHp, setMaxHp] = useState<number>(PLAYER_BASE_HP + PLAYER_HP_PER_LEVEL);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiGet<{ data: SaveDataView }>('/save', token)
      .then((save) => {
        if (cancelled) return;
        const exp = save.data.skills?.attack?.exp ?? 0;
        const level = levelFromExp(typeof exp === 'number' ? exp : 0);
        setMaxHp(PLAYER_BASE_HP + level * PLAYER_HP_PER_LEVEL);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  return maxHp;
}

/** 日志行的角色文案键 */
function actorKey(actor: 'player' | 'enemy'): string {
  return actor === 'player' ? 'combat.role.player' : 'combat.role.enemy';
}

/** 渲染单条战斗日志：正伤害显示伤害数字，负伤害（吃食物）显示回血 */
function LogLine({ entry }: { entry: CombatLogEntry }) {
  const { t } = useT();
  const actor = t(actorKey(entry.actor));
  if (entry.damage < 0) {
    // 负伤害 = 治疗；后端把吃食物记成 damage = -heal
    return (
      <li className="combat-log-entry is-heal">
        {t('combat.log_heal')
          .replace('{actor}', actor)
          .replace('{amount}', String(-entry.damage))}
      </li>
    );
  }
  return (
    <li className="combat-log-entry">
      {t('combat.log_attack')
        .replace('{actor}', actor)
        .replace('{damage}', String(entry.damage))}
    </li>
  );
}

export function CombatPanel() {
  const { t } = useT();
  const { active, enemy, report, pending, error, finalReport, start, stop, dismissFinal } = useCombat();
  const playerMaxHp = usePlayerMaxHp();

  // 攻击动画触发点：玩家/敌人的血条容器
  const playerBarRef = useRef<HTMLDivElement | null>(null);
  const enemyBarRef = useRef<HTMLDivElement | null>(null);
  // 已播放到哪一条日志：动画只在日志增量时重播，不整列表重放
  const playedLogCountRef = useRef(0);

  /* 战报更新 → 血量变化时给对应容器抖一下（视觉受击反馈） */
  useEffect(() => {
    if (!report) {
      playedLogCountRef.current = 0;
      return;
    }
    const log = report.log;
    const prev = playedLogCountRef.current;
    if (log.length <= prev) return;
    // 播增量：取最后一条新日志的角色，给受击方血条抖一下
    const latest = log[log.length - 1];
    const targetRef = latest.actor === 'player' ? enemyBarRef : playerBarRef;
    const node = targetRef.current;
    if (node) {
      node.classList.remove('is-hit');
      // 强制 reflow 让 class 重挂触发动画
      void node.offsetWidth;
      node.classList.add('is-hit');
    }
    playedLogCountRef.current = log.length;
  }, [report]);

  /* 无战斗：敌人列表 + 开始按钮 */
  const [localError, setLocalError] = useState<string | null>(null);
  const handleStart = useCallback(async () => {
    setLocalError(null);
    try {
      await start('chicken'); // P0 只有鸡可选；后续敌人多了再改成下拉/列表选择
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : '操作失败');
    }
  }, [start]);

  const handleStop = useCallback(async () => {
    setLocalError(null);
    try {
      await stop();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : '操作失败');
    }
  }, [stop]);

  const errorMessage = localError ?? error;

  /* 结算卡片：战斗结束后短暂展示 */
  if (finalReport) {
    const outcome = finalReport.end.kind;
    return (
      <section className="combat-panel combat-result" aria-live="polite">
        <h2>{t('combat.title')}</h2>
        <p className={`combat-outcome combat-outcome-${outcome}`}>
          {outcome === 'victory'
            ? t('combat.outcome_victory')
            : t('combat.outcome_defeat')}
        </p>
        {finalReport.exp_gained > 0 && (
          <p className="combat-exp">
            {t('skill.attack.name')} +{finalReport.exp_gained} XP
          </p>
        )}
        {Object.entries(finalReport.item_drops).length > 0 && (
          <ul className="combat-drops">
            {Object.entries(finalReport.item_drops).map(([itemId, qty]) => (
              <li key={itemId}>
                {t(`item.${itemId}.name`)} ×{qty}
              </li>
            ))}
          </ul>
        )}
        {Object.keys(finalReport.food_consumed).length > 0 && (
          <p className="combat-food">
            {t('combat.food_consumed')}:
            {Object.entries(finalReport.food_consumed)
              .map(([itemId, qty]) => ` ${t(`item.${itemId}.name`)}×${qty}`)
              .join(', ')}
          </p>
        )}
        <button type="button" className="combat-dismiss" onClick={dismissFinal}>
          {t('common.confirm')}
        </button>
      </section>
    );
  }

  /* 战斗中：双血条 + 日志 + 停止 */
  if (active && enemy && report) {
    const playerHpPct = Math.max(0, Math.min(1, report.player_hp / playerMaxHp));
    const enemyHpPct = Math.max(0, Math.min(1, report.enemy_hp / enemy.hp));
    return (
      <section className="combat-panel" aria-live="polite">
        <h2>{t('combat.title')}</h2>

        {/* 玩家血条 */}
        <div ref={playerBarRef} className="combatant combatant-player">
          <div className="combatant-name">{t('combat.role.player')}</div>
          <div className="combatant-bar">
            <div
              className="combatant-fill player-fill"
              style={{ transform: `scaleX(${playerHpPct})` }}
              aria-valuenow={report.player_hp}
              aria-valuemax={playerMaxHp}
              aria-valuemin={0}
              role="progressbar"
            />
          </div>
          <div className="combatant-hp">
            {report.player_hp} / {playerMaxHp}
          </div>
        </div>

        <div className="combat-vs">{t('combat.vs')}</div>

        {/* 敌人血条 */}
        <div ref={enemyBarRef} className="combatant combatant-enemy">
          <div className="combatant-name">{t(`combat.enemy.${enemy.id}.name`)}</div>
          <div className="combatant-bar">
            <div
              className="combatant-fill enemy-fill"
              style={{ transform: `scaleX(${enemyHpPct})` }}
              aria-valuenow={report.enemy_hp}
              aria-valuemax={enemy.hp}
              aria-valuemin={0}
              role="progressbar"
            />
          </div>
          <div className="combatant-hp">
            {report.enemy_hp} / {enemy.hp}
          </div>
        </div>

        {/* 战斗日志：最新在最上，滚动锁定在顶部 */}
        <div className="combat-log-wrapper">
          <h3 className="combat-log-title">{t('combat.log_title')}</h3>
          <ul className="combat-log">
            {report.log.length === 0 ? (
              <li className="combat-log-empty">{t('combat.log_empty')}</li>
            ) : (
              // 倒序渲染：服务器返回按时间正序，UI 最新在最上让玩家先看重点
              [...report.log].reverse().map((entry, idx) => <LogLine key={`${entry.at}-${idx}`} entry={entry} />)
            )}
          </ul>
        </div>

        <button type="button" className="combat-stop" onClick={handleStop} disabled={pending}>
          {t('combat.stop')}
        </button>
        {errorMessage && <p className="combat-error">{errorMessage}</p>}
      </section>
    );
  }

  /* 空闲：敌人列表 */
  return (
    <section className="combat-panel combat-idle">
      <h2>{t('combat.title')}</h2>
      <p className="combat-idle-hint">{t('activity.no_action')}</p>
      <button type="button" className="combat-start" onClick={handleStart} disabled={pending}>
        {t('combat.start')} — {t('combat.enemy.chicken.name')}
      </button>
      {errorMessage && <p className="combat-error">{errorMessage}</p>}
    </section>
  );
}
