import { useCallback, useEffect, useRef, useState, createContext, createElement, useContext, type ReactNode } from 'react';
import { useAuth } from '../auth/auth.tsx';
import {
  fetchCurrentAction,
  fetchQueue,
  settleDueAction,
  stopAction as requestStop,
  startAction as requestStart,
} from './api.ts';
import type { ActiveActionData } from './api.ts';
import type { StopReason } from '@lazycraft/shared';

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
  /**
   * 自动停止原因（材料耗尽 / 背包满）；手动停止或重新开始后清空。
   * 供工作面板提示"为什么停了"，null = 没有需要提示的自动停止。
   */
  stopReason: StopReason | null;
  /** 进度条 0..1 实时值：rAF 驱动，不是 state 累加 */
  progressRef: React.MutableRefObject<number>;
  /**
   * 结算完成信号：每次逐圈结算/停止有产物时 +1。
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
  /** 队列面板操作后调用：若空闲则踢一脚让服务器起跑队首 */
  refreshQueue: () => Promise<void>;
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
  const [stopReason, setStopReason] = useState<StopReason | null>(null);
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
  /**
   * 已经触发过结算的"圈末边界"（next_tick_at 值）。
   *
   * 为什么用边界值而不是布尔？
   *   rAF 在 fraction >= 1 后仍会持续回调（每帧 ~60 次），没有守卫就会每帧发
   *   settle-due → 请求风暴（P1-1）。用"已触发过的边界值"作守卫：
   *   结算成功后服务器把 next_tick_at 推进到下一个边界，条件自然再次成立，
   *   于是每圈恰好触发一次，不依赖 effect 重建时机。
   *   失败时清空，允许下一帧重试（配合 retryAfterRef 退避，避免风暴）。
   */
  const firedBoundaryRef = useRef<number | null>(null);
  /** settle-due 是否正在飞行中：避免响应回来前同一圈重复触发 */
  const settlingRef = useRef(false);
  /** 失败退避截止时间戳：失败后 1s 内不再重试，避免每帧重试演成新的风暴 */
  const retryAfterRef = useRef(0);
  /**
   * settleDue 的稳定引用槽。
   *
   * 为什么需要它？syncActive 定义在 settleDue 之前，却需要在"空闲 + 队列非空"时
   * 踢一脚让它自动起跑队首。用 ref 槽打破定义顺序，避免把两个 callback 互相依赖。
   */
  const settleDueRef = useRef<((boundary: number) => Promise<void>) | null>(null);
  /** 上一次看到的队列长度：用于判断队列是否发生变化（完成移除 / 接续下一项） */
  const queueLengthRef = useRef(0);

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
      // 空闲但队列非空：服务器需要被"踢一脚"才会起跑队首（settle-due 空闲分支）。
      // 登录/对时时自动补这一脚，否则队列只能靠队列面板打开才启动。
      if ((cur.action_queue?.length ?? 0) > 0) {
        settleDueRef.current?.(0).catch(() => undefined);
      }
    }
  }, [token]);

  /**
   * 内部：结清截至现在的所有到期整圈（每走满一圈由 rAF 触发一次）。
   *
   * 为什么失败不覆盖守卫（firedBoundaryRef）？
   *   失败后守卫保持未设状态，下一帧会再次尝试；配合 retryAfterRef 退避，
   *   既不会永久卡在满格，也不会演成每帧一次的新风暴。
   * 为什么只在有产物时 bump settleNonce？
   *   无产出的空圈不该触发 PlayerProvider 重拉 /api/player，省一次往返。
   */
  const settleDue = useCallback(async (boundary: number) => {
    if (!token || settlingRef.current) return;
    settlingRef.current = true;
    try {
      const res = await settleDueAction(token);
      lastSyncAtRef.current = Date.now();
      // 队列长度变化（完成并移除 / 接续下一项）也要通知订阅者刷新面板，
      // 否则在"本圈无产出"的时刻面板会短暂显示过期队列
      const queueLen = res.action_queue?.length ?? 0;
      const queueChanged = queueLen !== queueLengthRef.current;
      queueLengthRef.current = queueLen;
      const gainedExp = Object.keys(res.report.exp_gained ?? {}).length > 0;
      const produced = res.report.gained.length > 0 || gainedExp || res.report.lost.length > 0;

      if (res.current_action) {
        setActive(res.current_action);
        setNextTickAt(res.next_tick_at);
        setIntervalMs(res.interval_ms);
        if (res.report.ticks > 0) {
          // 结清成功：把守卫固定到本次边界。服务器返回的新 next_tick_at
          // 必然大于它，下一圈会再次满足触发条件；本次边界永不重复触发。
          firedBoundaryRef.current = boundary;
          retryAfterRef.current = 0;
        } else {
          // ticks=0（客户端时钟略快于服务器）：不清守卫，退避 0.5s 后再试
          retryAfterRef.current = Date.now() + 500;
        }
      } else {
        // 动作已结束：清空状态。仅材料耗尽/背包满才是"需要提示的自动停止"，
        // 其余（手动停止竞态、无活动）静默收敛，避免误报。
        setActive(null);
        setNextTickAt(null);
        setIntervalMs(null);
        if (
          res.report.stop_reason === 'input_exhausted' ||
          res.report.stop_reason === 'inventory_full'
        ) {
          setStopReason(res.report.stop_reason);
        }
        progressRef.current = 0;
        firedBoundaryRef.current = boundary;
        retryAfterRef.current = 0;
      }
      // 有产物或队列长度变化都刷新订阅者（背包 / 队列面板）
      if (produced || queueChanged) setSettleNonce((n) => n + 1);
    } catch {
      // 失败：退避 1s 后允许重试，且不覆盖守卫（下一帧再试），避免卡死或风暴
      retryAfterRef.current = Date.now() + 1000;
    } finally {
      settlingRef.current = false;
    }
  }, [token]);
  // 把稳定引用暴露给 syncActive（定义顺序在前），用于空闲+队列时自动起跑队首
  useEffect(() => {
    settleDueRef.current = settleDue;
  }, [settleDue]);

  /* -------- 对外：开始活动 -------- */
  const start = useCallback(async (skillId: string, actionId: string) => {
    if (!token) return;
    setPending(true);
    setError(null);
    setStopReason(null);
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
      firedBoundaryRef.current = null;
      retryAfterRef.current = 0;
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
      setStopReason(null);
      queueLengthRef.current = 0; // stop = 停下一切，队列也被服务端清空
      progressRef.current = 0;
      firedBoundaryRef.current = null;
      retryAfterRef.current = 0;
      setSettleNonce((n) => n + 1);
      lastSyncAtRef.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
      throw e;
    } finally {
      setPending(false);
    }
  }, [token]);

  /* -------- 对外：队列面板操作后调用 -------- */
  const refreshQueue = useCallback(async () => {
    if (!token) return;
    const res = await fetchQueue(token);
    queueLengthRef.current = res.action_queue.length;
    // 入队后若空闲（尚未起跑），踢一脚 settle-due 让服务器把队首拉起，
    // 否则进度条不会动，玩家以为队列没生效。
    if (!res.current_action && res.action_queue.length > 0) {
      await settleDue(0).catch(() => undefined);
    }
  }, [token, settleDue]);

  /* -------- 登录/退登：拉取或清空 -------- */
  useEffect(() => {
    if (!token) {
      // 退登：清空所有活动相关状态
      setActive(null);
      setNextTickAt(null);
      setIntervalMs(null);
      setError(null);
      setStopReason(null);
      queueLengthRef.current = 0;
      progressRef.current = 0;
      firedBoundaryRef.current = null;
      retryAfterRef.current = 0;
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
    // 当前 tick 的起点与终点：终点就是服务器下发的 next_tick_at
    const tickStart = nextTickAt - tickMs;
    const boundary = nextTickAt;

    const step = () => {
      const now = Date.now();
      const fraction = clamp01((now - tickStart) / tickMs);
      progressRef.current = fraction;
      if (fraction >= 1 && Date.now() >= retryAfterRef.current) {
        // 到达本圈末尾：只有"本边界尚未触发过、且不在飞行中"时才发一次结算。
        // 为什么不在前端自己 +interval？本地动画只是演出，"真实进行到第几个 tick"
        // 由服务器结算决定；前端自己推演会在标签页隐藏/恢复后产生幻觉。
        if (firedBoundaryRef.current !== boundary && !settlingRef.current) {
          settleDue(boundary).catch(() => undefined);
        }
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
  }, [active, nextTickAt, intervalMs, settleDue]);

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
    stopReason,
    progressRef,
    settleNonce,
    start,
    stop,
    refreshQueue,
  };

  return createElement(ActionContext.Provider, { value }, children);
}
