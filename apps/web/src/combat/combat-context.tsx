import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/auth.tsx';
import { fetchCurrentCombat, startCombat as requestStart, stopCombat as requestStop } from './api.ts';
import type { CombatReport, Enemy } from '@lazycraft/shared';

/**
 * 战斗状态管理（task-18 前端的中枢）
 *
 * 为什么用独立 Provider 而不是塞进 ActionContext：
 *   战斗与挂机是两个互斥的活动（服务器权威约束），
 *   状态切片完全不同（战斗有 log / player_hp / enemy_hp 三个流式字段，
 *   挂机只有 progress）。合并会让 useAction 被迫多挂几个消费方不关心的字段。
 *   独立 CombatProvider 让右栏战斗面板的渲染开销与挂机进度动画完全解耦。
 *
 * 为什么轮询 2s 而不是 WebSocket：
 *   P0 战斗日志是"最终一致性"——服务器随时可能结算（玩家死亡/胜利），
 *   2s 轮询把"延迟感"压在可接受范围，又不引入 WebSocket 连接管理的复杂度。
 *   后续真要实时打击感，再切 SSE / BroadcastChannel 也不迟。
 */

/** 轮询间隔（毫秒）：足够让玩家看到血量跳动，又不给服务器加压 */
const POLL_INTERVAL_MS = 2_000;

interface CombatContextValue {
  /** 当前战斗；null = 未在战斗中 */
  active: { enemy_id: string; started_at: number } | null;
  /** 敌人详情（战斗中才有） */
  enemy: Enemy | null;
  /** 截至上一次次轮询的战报 */
  report: CombatReport | null;
  /** 操作进行中标志（防双击） */
  pending: boolean;
  /** 最近一次错误消息 */
  error: string | null;
  /** 战斗结算后的总结报告（stop 后短暂展示） */
  finalReport: CombatReport | null;
  /** 开始战斗；enemyId 由右栏列表点选 */
  start: (enemyId: string) => Promise<void>;
  /** 停止并结算 */
  stop: () => Promise<void>;
  /** 关闭总结报告卡片 */
  dismissFinal: () => void;
}

const CombatContext = createContext<CombatContextValue | null>(null);

export function useCombat(): CombatContextValue {
  const ctx = useContext(CombatContext);
  if (!ctx) throw new Error('useCombat() 必须在 <CombatProvider> 内使用');
  return ctx;
}

export function CombatProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();

  const [active, setActive] = useState<{ enemy_id: string; started_at: number } | null>(null);
  const [enemy, setEnemy] = useState<Enemy | null>(null);
  const [report, setReport] = useState<CombatReport | null>(null);
  const [finalReport, setFinalReport] = useState<CombatReport | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);

  /* -------- 内部：同步 current_combat（不触碰结算卡片） -------- */
  const syncCombat = useCallback(async () => {
    if (!token) return;
    const cur = await fetchCurrentCombat(token);
    if (cur.current_combat && cur.enemy && cur.report) {
      setActive(cur.current_combat);
      setEnemy(cur.enemy ?? null);
      setReport(cur.report);
      // 服务器判定已结束（胜/负）时，前端立刻拉一次"结算快照"并停止轮询
      if (cur.report.end.kind !== 'fighting') {
        setFinalReport(cur.report);
        setActive(null);
        setEnemy(null);
        setReport(null);
      }
    } else {
      setActive(null);
      setEnemy(null);
      setReport(null);
    }
  }, [token]);

  /* -------- 登录 / 退登：拉取或清空 -------- */
  useEffect(() => {
    if (!token) {
      setActive(null);
      setEnemy(null);
      setReport(null);
      setFinalReport(null);
      setError(null);
      return;
    }
    syncCombat().catch(() => undefined);
  }, [token, syncCombat]);

  /* -------- 2s 轮询：战斗中才启动 -------- */
  useEffect(() => {
    if (!active || !token) {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    pollTimerRef.current = window.setInterval(() => {
      syncCombat().catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [active, token, syncCombat]);

  /* -------- 对外：开始战斗 -------- */
  const start = useCallback(
    async (enemyId: string) => {
      if (!token) return;
      setPending(true);
      setError(null);
      try {
        const res = await requestStart(token, enemyId);
        if (res.current_combat && res.enemy) {
          setActive(res.current_combat);
          setEnemy(res.enemy);
          // 开打后立刻同步一次战报（避免 2s 黑屏）
          await syncCombat();
        }
        // 开始新战斗前清掉上一份结算卡片，避免"上一次战败报告"盖在新界面上
        setFinalReport(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作失败');
        throw e;
      } finally {
        setPending(false);
      }
    },
    [token, syncCombat],
  );

  /* -------- 对外：停止战斗 -------- */
  const stop = useCallback(async () => {
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      const res = await requestStop(token);
      setFinalReport(res.report);
      setActive(null);
      setEnemy(null);
      setReport(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
      throw e;
    } finally {
      setPending(false);
    }
  }, [token]);

  const dismissFinal = useCallback(() => {
    setFinalReport(null);
  }, []);

  const value: CombatContextValue = {
    active,
    enemy,
    report,
    pending,
    error,
    finalReport,
    start,
    stop,
    dismissFinal,
  };

  return createElement(CombatContext.Provider, { value }, children);
}
