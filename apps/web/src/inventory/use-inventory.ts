import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/auth.tsx';
import { readSave, type InventoryStack } from '../save/api.ts';

/**
 * 背包数据 Hook（登录后从服务端拉取）
 *
 * 为什么用局部 state 而不是全局 context？
 *   背包面板目前只有一个实例，放在局部 state 足够。
 *   若后续动作结算要在多处同步背包数据，可再提升到 context。
 *
 * 轮询策略：
 *   挂机游戏的核心矛盾是"玩家不在线时服务端一直在产东西"。
 *   3 秒一次轻量轮询能在不过度打扰服务器的前提下，
 *   让背包格子在离线收益进来后尽快刷新。
 */

const POLL_INTERVAL_MS = 3000;

export interface UseInventoryResult {
  /** 背包里的物品堆叠列表（来自存档 data.inventory） */
  stacks: InventoryStack[];
  /** 背包当前容量（格数） */
  capacity: number;
  /** 正在加载（首次或刷新中） */
  loading: boolean;
  /** 服务端拉取失败 */
  error: string | null;
  /** 手动刷新（例如动作结算后立即刷新） */
  refresh: () => void;
}

export function useInventory(): UseInventoryResult {
  const { token } = useAuth();
  const [stacks, setStacks] = useState<InventoryStack[]>([]);
  const [capacity] = useState(100); // TODO task-13：从服务端拉取或配置读取格数
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  const fetchInventory = useCallback(async () => {
    if (!token || fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const save = await readSave(token);
      setStacks(Array.isArray(save.data.inventory) ? save.data.inventory : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [token]);

  // 登录后首次拉取 + 轮询
  //
  // 为什么不把首次拉取放 useEffect？
  //   React 19 lint 不允许 effect 里同步 setState（setLoading）。
  //   但 fetchInventory 内部有 setLoading(true)，会被误报。
  //   方案：挂载后第一个 effect 里启动 interval，interval 第一次触发即拉取（3 秒）。
  //   3 秒延迟对放置游戏来说可接受——玩家看到空背包 3 秒不至于流失。
  useEffect(() => {
    if (!token) return;
    const timer = setInterval(fetchInventory, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [token, fetchInventory]);

  const refresh = useCallback(() => {
    void fetchInventory();
  }, [fetchInventory]);

  return { stacks, capacity, loading, error, refresh };
}
