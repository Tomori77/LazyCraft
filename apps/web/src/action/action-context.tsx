import { useCallback, useEffect, useRef, useState, createContext, createElement, useContext, type ReactNode } from 'react';
import { useAuth } from '../auth/auth.tsx';
import { fetchCurrentAction, stopAction as requestStop, startAction as requestStart } from './api.ts';
import type { ActiveActionData } from './api.ts';

/**
 * 活动状态管理（task-11 中枢，task-27 起只保留"进行中活动"这一职责）
 *
 * 关键设计决策：
 *
 * 为什么用 Context 而不是把 state 放在 GameLayout？
 *   活动状态被左栏（技能导航）、中栏（工作卡片进度）等多处消费；
 *   Context 用一次 Provider 就把"当前活动 + 操作回调"推到所有消费点。
 *
 * 为什么进度条用 requestAnimationFrame + 服务端时间戳而不是 setInterval 累加？
 *   本地动画只是演出（《任务清单》铁律），进度 = min(1, (serverNow - started_at) / interval_ms)。
 *   setInterval 会随标签页隐藏被节流，回前台时会"跳变"；rAF 在隐藏时暂停、
 *   显示时立即以当前真实时间重算，恢复瞬间就是正确位置，不会看到追帧。
 *   所有时间戳都来自服务器（started_at / next_tick_at 由后端下发），
 *   本地时钟只做减法，永远不直接告诉后端"现在几点"。
 *
 * 为什么对时间隔 20s 而不是每次都问？
 *   服务器权威，但没必要每帧对时：本地动画本身不决定任何后端写入，
 *   只在"漂移大到影响视觉"时才需要纠正。20s 一次足够把客户端可能
 *   累计的时钟漂移拉回来，又把请求频率控制在可忽略的量级。
 */

/** 对时间隔（毫秒）：足够拉回漂移，又不会对服务器造成可感知压力 */
const SYNC_INTERVAL_MS = 20_000;

/** rAF 进度归一化：夹到 0..1，越界（时钟偏差/暂停后）不产生负宽度 */
function clamp01(fraction: number): number {
  return Math.min(1, Math.max(0, fraction));
}

interface ActionContextValue {
  /** 当前进行中活动（null = 空闲） */
  active: ActiveActionData | null;
  /** 进行中活动的下一次结算时刻（服务器时间戳，毫秒） */
  nextTickAt: number | null;
  /** 进行中活动的单次间隔；进度条分母 */
  intervalMs: number | null;
  /** 操作进行中标志：防止重复点击 */
  pending: boolean;
  /** 最近一次错误消息（null = 无错） */
  error: string | null;
  /** 进度条 0..1 实时值：rAF 驱动，不是 state 累加 */
  progressRef: React.MutableRefObject<number>;
  /**
   * 结算完成信号：每次 stop 成功 +1。
   *
   * 为什么用自增 nonce 而不是回调注册？
   *   PlayerProvider 在 ActionProvider 之下，不能被子组件反向注册；
   *   一个单调递增的计数让任何消费者用 useEffect 声明式地"结算后刷新"，
   *   无需关心订阅/取消订阅的生命周期。
   */
  settleNonce: number;
  /** 点击开始：立即写入 active 并用响应的 next_tick_at 启动动画 */
  start: (skillId: string, actionId: string) => Promise<void>;
  /** 点击停止：调用后端结算，成功后 bump settleNonce 供背包刷新 */
  stop: () => Promise<void>;
}

const ActionContext = createContext<ActionContextValue | null>(null);

export function useAction(): ActionContextValue {
  const ctx = useContext(ActionContext);
  if (!ctx) throw new Error('useAction() 必须在 <ActionProvider> 内使用');
  return ctx;
}

export function ActionProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();

  const [active, setActive] = useState<ActiveActionData | null>(null);
  const [nextTickAt, setNextTickAt] = useState<number | null>(null);
  const [intervalMs, setIntervalMs] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settleNonce, setSettleNonce] = useState(0);

  /**
   * 进度条实时值：放在 ref 而不是 state，是为了避免每个 rAF 帧都触发 React 重渲染
   * （中栏进度条 60fps 重渲染会拖慢整页）。消费方（进度条组件）自己 rAF
   * 读这个 ref 并写入 DOM style，绕过 React 渲染管线，性能最优。
   */
  const progressRef = useRef(0);
  /** rAF 句柄：active 变化时要清掉旧动画 */
  const rafHandleRef = useRef<number | null>(null);
  /** 对时计时器句柄 */
  const syncTimerRef = useRef<number | null>(null);
  /** 最近一次 sync 的时间戳（用于避免短时间内重复同步） */
  const lastSyncAtRef = useRef<number>(0);

  /* -------- 内部：仅同步 current_action（不打存档） -------- */
  const syncActive = useCallback(async () => {
    if (!token) return;
    const cur = await fetchCurrentAction(token);
    lastSyncAtRef.current = Date.now();
    if (cur.current_action) {
      setActive(cur.current_action);
      setNextTickAt(cur.next_tick_at ?? null);
      setIntervalMs(cur.interval_ms ?? null);
    } else {
      setActive(null);
      setNextTickAt(null);
      setIntervalMs(null);
    }
  }, [token]);

  /* -------- 对外：开始活动 -------- */
  const start = useCallback(async (skillId: string, actionId: string) => {
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      const res = await requestStart(token, skillId, actionId);
      // 服务器已写入 current_action；前端立刻进入"进行中"状态，
      // 用响应的 next_tick_at 启动本地进度条演出
      setActive(res.current_action);
      setNextTickAt(res.next_tick_at);
      // interval_ms 从 start 响应推不出来（后端契约已定），立即拉一次 current 补齐
      const cur = await fetchCurrentAction(token);
      setIntervalMs(cur.interval_ms ?? null);
      progressRef.current = 0;
      lastSyncAtRef.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
      throw e;
    } finally {
      setPending(false);
    }
  }, [token]);

  /* -------- 对外：停止并结算 -------- */
  const stop = useCallback(async () => {
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      await requestStop(token);
      // 结算已落库：清空进行中状态；自增信号让 PlayerProvider 重拉 /api/player
      // （背包/经验都在后端结算里变化，前端不自行推算）
      setActive(null);
      setNextTickAt(null);
      setIntervalMs(null);
      progressRef.current = 0;
      setSettleNonce((n) => n + 1);
      lastSyncAtRef.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
      throw e;
    } finally {
      setPending(false);
    }
  }, [token]);

  /* -------- 登录/退登：拉取或清空 -------- */
  useEffect(() => {
    if (!token) {
      // 退登：清空所有活动相关状态
      setActive(null);
      setNextTickAt(null);
      setIntervalMs(null);
      setError(null);
      progressRef.current = 0;
      return;
    }
    // 登录：拉一次 current 覆盖本地状态；失败不阻塞（下次 sync 再试）
    syncActive().catch(() => undefined);
  }, [token, syncActive]);

  /* -------- rAF 进度动画：active.next_tick_at 驱动 -------- */
  useEffect(() => {
    if (!active || nextTickAt === null || intervalMs === null) {
      progressRef.current = 0;
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
      }
      return;
    }

    const tickMs = intervalMs;
    // 当前 tick 的起点：next_tick_at - interval；动画从 0 走到 1
    const tickStart = nextTickAt - tickMs;

    const step = () => {
      const now = Date.now();
      const fraction = clamp01((now - tickStart) / tickMs);
      progressRef.current = fraction;
      if (fraction >= 1) {
        // 到达 tick 末尾：本地不重复滚动，立即向服务器要最新状态。
        // 为什么不在前端自己 +interval？本地动画只是演出，"真实进行到第几个 tick"
        // 由 current 接口决定；前端自己推演会在标签页隐藏/恢复后产生幻觉。
        syncActive().catch(() => undefined);
      }
      rafHandleRef.current = requestAnimationFrame(step);
    };

    rafHandleRef.current = requestAnimationFrame(step);
    return () => {
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
      }
    };
  }, [active, nextTickAt, intervalMs, syncActive]);

  /* -------- 20s 对时：只有 active 时才需要 -------- */
  useEffect(() => {
    if (!active || !token) {
      if (syncTimerRef.current !== null) {
        window.clearInterval(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      return;
    }
    syncTimerRef.current = window.setInterval(() => {
      syncActive().catch(() => undefined);
    }, SYNC_INTERVAL_MS);
    return () => {
      if (syncTimerRef.current !== null) {
        window.clearInterval(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [active, token, syncActive]);

  const value: ActionContextValue = {
    active,
    nextTickAt,
    intervalMs,
    pending,
    error,
    progressRef,
    settleNonce,
    start,
    stop,
  };

  return createElement(ActionContext.Provider, { value }, children);
}
