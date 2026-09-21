import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { CarriedItem, EquipmentSlot } from '@lazycraft/shared';
import { useAuth } from '../auth/auth.tsx';
import { useAction } from '../action/action-context.tsx';
import {
  fetchPlayer,
  discardRequest,
  equipRequest,
  moveRequest,
  unequipRequest,
  type PlayerData,
} from './api.ts';

/**
 * 乐观换装：把装备从原容器挪到槽位（原槽装备退回背包），立即可见。
 *
 * 为什么是"尽力而为"而不是精确复刻服务端合并？
 *   装备不可堆叠，不存在堆叠合并的歧义；但派生属性（attributes）等仍以
 *   服务端为准。这里的改动只是"拖放后先让格子动起来"，随后 refreshPlayer()
 *   用权威数据整体覆盖，属性/等级等会在短暂一拍后纠正。
 *   服务端拒绝时（等级/容量不足）refreshPlayer() 同样会把它纠正回原状。
 */
function optimisticEquip(player: PlayerData, uid: string, slot: EquipmentSlot): PlayerData {
  const find = (list: CarriedItem[]) => list.findIndex((i) => i.uid === uid);
  const invIndex = find(player.inventory);
  const stIndex = find(player.storage);
  const from = invIndex >= 0 ? player.inventory : stIndex >= 0 ? player.storage : null;
  const index = invIndex >= 0 ? invIndex : stIndex;
  if (!from || index < 0) return player;
  const item = from[index];
  if (item.kind !== 'equipment') return player;

  const removeAt = (list: CarriedItem[]) => list.filter((_, i) => i !== index);
  const inventory = from === player.inventory ? removeAt(player.inventory) : player.inventory;
  const storage = from === player.storage ? removeAt(player.storage) : player.storage;
  const displaced = player.equipment[slot] ?? null;
  const nextInventory = displaced ? [...inventory, displaced] : inventory;

  return {
    ...player,
    inventory: nextInventory,
    storage,
    equipment: { ...player.equipment, [slot]: item },
    carry: { ...player.carry, inventory_used: nextInventory.length },
  };
}

/** 乐观卸下：槽位清空，装备回到背包 */
function optimisticUnequip(player: PlayerData, slot: EquipmentSlot): PlayerData {
  const item = player.equipment[slot] ?? null;
  if (!item) return player;
  const inventory = [...player.inventory, item];
  return {
    ...player,
    inventory,
    equipment: { ...player.equipment, [slot]: null },
    carry: { ...player.carry, inventory_used: inventory.length },
  };
}

/**
 * 乐观丢弃：装备整件移除；堆叠物按 quantity 减量，减到 0 才移除该格。
 *
 * 为什么减量与移除要分开处理？
 *   容器按"格数"计容量，整格丢弃才会释放一格；减量只是数字变化。
 *   若把减量也当成移除，界面会短暂多出一格空位，与服务端真相不符。
 */
function optimisticDiscard(player: PlayerData, uid: string, quantity?: number): PlayerData {
  const inInventory = player.inventory.some((i) => i.uid === uid);
  const list = inInventory ? player.inventory : player.storage;
  const index = list.findIndex((i) => i.uid === uid);
  if (index < 0) return player;
  const item = list[index];

  // 装备不可拆分，恒整件；堆叠物 quantity 缺省即整格（与服务端 DiscardItemDto 同口径）
  const discardQty = quantity ?? (item.kind === 'stack' ? item.quantity : 1);
  const left = item.kind === 'stack' ? item.quantity - discardQty : 0;
  const next: CarriedItem[] =
    left > 0
      ? list.map((cur, i) => (i === index && item.kind === 'stack' ? { ...item, quantity: left } : cur))
      : list.filter((_, i) => i !== index);

  return {
    ...player,
    inventory: inInventory ? next : player.inventory,
    storage: inInventory ? player.storage : next,
    carry: {
      ...player.carry,
      inventory_used: inInventory ? next.length : player.inventory.length,
      storage_used: inInventory ? player.storage.length : next.length,
    },
  };
}

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
  /** 丢弃：quantity 缺省 = 整格（堆叠）/整件（装备） */
  discardItem: (uid: string, quantity?: number) => Promise<void>;
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

  /**
   * 乐观更新的统一节奏：先本地变更立即可见 → 发请求 → 用服务端权威数据覆盖。
   *
   * 为什么失败也要 refreshPlayer？
   *   乐观状态是"猜的"；服务端拒绝（等级/容量不足等）时若不回拉，
   *   界面会停在一个服务器并不认可的形态。回拉保证最终一定与服务端一致。
   */
  const runOptimistic = useCallback(
    async (apply: (p: PlayerData) => PlayerData, request: () => Promise<unknown>) => {
      if (!token) return;
      // useEffect 风格的函数式更新：直接基于 React 的最新 state 计算，
      // 无需 ref 快照，回调也保持稳定（不依赖 player）
      setPlayer((prev) => (prev ? apply(prev) : prev));
      try {
        await request();
      } finally {
        await refreshPlayer();
      }
    },
    [token, refreshPlayer],
  );

  const equipItem = useCallback(
    (uid: string, slot: EquipmentSlot) =>
      runOptimistic(
        (p) => optimisticEquip(p, uid, slot),
        () => equipRequest(token as string, uid, slot),
      ),
    [token, runOptimistic],
  );

  const unequipItem = useCallback(
    (slot: EquipmentSlot) =>
      runOptimistic(
        (p) => optimisticUnequip(p, slot),
        () => unequipRequest(token as string, slot),
      ),
    [token, runOptimistic],
  );

  const moveItem = useCallback(
    (uid: string, from: 'inventory' | 'storage', to: 'inventory' | 'storage') =>
      runOptimistic(
        (p) => {
          // 跨容器移动：把 uid 从源容器移到目标容器末尾，立即可见；
          // 服务端会按堆叠合并规则重排，refreshPlayer() 后收敛到权威形态
          if (from === to) return p;
          const src = from === 'inventory' ? p.inventory : p.storage;
          const item = src.find((i) => i.uid === uid);
          if (!item) return p;
          const inventory =
            from === 'inventory' ? p.inventory.filter((i) => i.uid !== uid) : [...p.inventory, item];
          const storage =
            from === 'storage' ? p.storage.filter((i) => i.uid !== uid) : [...p.storage, item];
          return {
            ...p,
            inventory,
            storage,
            carry: { ...p.carry, inventory_used: inventory.length, storage_used: storage.length },
          };
        },
        () => moveRequest(token as string, uid, from, to),
      ),
    [token, runOptimistic],
  );

  const discardItem = useCallback(
    (uid: string, quantity?: number) =>
      runOptimistic(
        (p) => optimisticDiscard(p, uid, quantity),
        () => discardRequest(token as string, uid, quantity),
      ),
    [token, runOptimistic],
  );

  return createElement(
    PlayerContext.Provider,
    { value: { player, loading, error, refreshPlayer, equipItem, unequipItem, moveItem, discardItem } },
    children,
  );
}
