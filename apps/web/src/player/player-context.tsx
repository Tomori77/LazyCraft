import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { EquipmentSlot } from '@lazycraft/shared';
import { useAuth } from '../auth/auth.tsx';
import { useAction } from '../action/action-context.tsx';
import {
  fetchPlayer,
  equipRequest,
  moveRequest,
  unequipRequest,
  type PlayerData,
} from './api.ts';

/**
 * 玩家状态与容器操作上下文。
 *
 * 刷新时机（05 §8）：
 *   - 登录后由 token effect 拉一次；
 *   - 动作 stop 结算后由 ActionProvider 的 settleNonce 触发（背包/经验会变）；
 *   - 装备/卸下/移动/商店买卖后由操作函数自身 await refreshPlayer()。
 *
 * 为什么消费 settleNonce 而不是让 GameLayout 手动调 refreshPlayer？
 *   ActionProvider 在 PlayerProvider 之上，子级无法把回调"塞回去"；
 *   用自增 nonce 做声明式订阅，结算与刷新解耦，也不影响 ActionProvider 的复用。
 */
interface PlayerContextValue {
  player: PlayerData | null;
  loading: boolean;
  error: string | null;
  refreshPlayer: () => Promise<void>;
  equipItem: (uid: string, slot: EquipmentSlot) => Promise<void>;
  unequipItem: (slot: EquipmentSlot) => Promise<void>;
  moveItem: (uid: string, from: 'inventory' | 'storage', to: 'inventory' | 'storage') => Promise<void>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer() 必须在 <PlayerProvider> 内使用');
  return ctx;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const { settleNonce } = useAction();
  const [player, setPlayer] = useState<PlayerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPlayer = useCallback(async () => {
    if (!token) {
      setPlayer(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setPlayer(await fetchPlayer(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取玩家信息失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // 登录后拉取
  useEffect(() => {
    void refreshPlayer();
  }, [refreshPlayer]);

  // 动作结算后刷新（settleNonce 首次为 0，跳过以免与登录首拉重复）
  useEffect(() => {
    if (settleNonce === 0) return;
    void refreshPlayer();
  }, [settleNonce, refreshPlayer]);

  const equipItem = useCallback(
    async (uid: string, slot: EquipmentSlot) => {
      if (!token) return;
      await equipRequest(token, uid, slot);
      await refreshPlayer();
    },
    [token, refreshPlayer],
  );

  const unequipItem = useCallback(
    async (slot: EquipmentSlot) => {
      if (!token) return;
      await unequipRequest(token, slot);
      await refreshPlayer();
    },
    [token, refreshPlayer],
  );

  const moveItem = useCallback(
    async (uid: string, from: 'inventory' | 'storage', to: 'inventory' | 'storage') => {
      if (!token) return;
      await moveRequest(token, uid, from, to);
      await refreshPlayer();
    },
    [token, refreshPlayer],
  );

  return createElement(
    PlayerContext.Provider,
    { value: { player, loading, error, refreshPlayer, equipItem, unequipItem, moveItem } },
    children,
  );
}
