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
import { acceptQuest, claimQuest, listQuests, type QuestView } from './api.ts';

/**
 * 任务状态上下文
 *
 * 为什么单独一个 Context 而不是塞进 ActionContext？
 *   任务的更新频率远低于"活动"（后者有 rAF / 20s 对时），
 *   塞在一起会让 progressRef 等高频引用混入任务视图；
 *   任务面板的刷新触发点也很清晰：登录后一次 + 领取/交付后重拉 + 结算后再拉。
 *
 * 为什么不把"主线完成后日常列表出现"做成前端过滤？
 *   后端 list() 已经按主线完成态过滤，前端只是渲染返回值——
 *   服务器权威一致：可视任务列表也是服务端说了算。
 */

interface QuestContextValue {
  quests: QuestView[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  accept: (id: string) => Promise<QuestView | null>;
  claim: (id: string) => Promise<QuestView | null>;
}

const QuestContext = createContext<QuestContextValue | null>(null);

export function QuestProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [quests, setQuests] = useState<QuestView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 防止"登录 → 拉取中 → 玩家点了领取"的旧响应盖掉新状态
  const lastMutateAtRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!token) return;
    const fetchedAt = Date.now();
    setLoading(true);
    setError(null);
    try {
      const res = await listQuests(token);
      // 拉取的响应如果晚于最近一次本地变更，丢弃（避免慢响应盖掉刚点的 accept）
      if (fetchedAt >= lastMutateAtRef.current) {
        setQuests(res.quests);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载任务失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const applyLocal = useCallback((next: QuestView) => {
    lastMutateAtRef.current = Date.now();
    setQuests((prev) => {
      const idx = prev.findIndex((q) => q.id === next.id);
      if (idx === -1) return [...prev, next];
      const clone = prev.slice();
      clone[idx] = next;
      return clone;
    });
  }, []);

  const accept = useCallback(
    async (id: string) => {
      if (!token) return null;
      setError(null);
      try {
        const res = await acceptQuest(token, id);
        applyLocal(res.quest);
        return res.quest;
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作失败');
        return null;
      }
    },
    [token, applyLocal],
  );

  const claim = useCallback(
    async (id: string) => {
      if (!token) return null;
      setError(null);
      try {
        const res = await claimQuest(token, id);
        applyLocal(res.quest);
        return res.quest;
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作失败');
        return null;
      }
    },
    [token, applyLocal],
  );

  // 登录边界：拉一次任务列表；退登清空
  useEffect(() => {
    if (!token) {
      setQuests([]);
      setError(null);
      return;
    }
    void refresh();
  }, [token, refresh]);

  return createElement(
    QuestContext.Provider,
    { value: { quests, loading, error, refresh, accept, claim } },
    children,
  );
}

export function useQuests(): QuestContextValue {
  const ctx = useContext(QuestContext);
  if (!ctx) throw new Error('useQuests() 必须在 <QuestProvider> 内使用');
  return ctx;
}
