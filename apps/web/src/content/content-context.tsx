import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { ContentSnapshot } from '@lazycraft/shared';
import { fetchContent } from './api.ts';

/**
 * 内容上下文（技能/动作/资源/槽位快照）。
 *
 * 为什么挂载只拉一次、不做轮询？
 *   内容是策划配置（将来迁 DB 也只在发版/后台改），运行期几乎不变；
 *   轮询只会白白增加请求。失败时暴露 error + refreshContent，
 *   由界面渲染"可重试"错误态，而不是让整页白屏。
 */
interface ContentContextValue {
  content: ContentSnapshot | null;
  loading: boolean;
  error: string | null;
  refreshContent: () => Promise<void>;
}

const ContentContext = createContext<ContentContextValue | null>(null);

export function useContent(): ContentContextValue {
  const ctx = useContext(ContentContext);
  if (!ctx) throw new Error('useContent() 必须在 <ContentProvider> 内使用');
  return ctx;
}

export function ContentProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ContentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setContent(await fetchContent());
    } catch (e) {
      setError(e instanceof Error ? e.message : '内容配置加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshContent();
  }, [refreshContent]);

  return createElement(
    ContentContext.Provider,
    { value: { content, loading, error, refreshContent } },
    children,
  );
}
