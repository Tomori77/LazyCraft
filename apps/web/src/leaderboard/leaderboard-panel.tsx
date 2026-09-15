import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/auth.tsx';
import { useT } from '../i18n/index.ts';
import { fetchTotalLevelLeaderboard, type TotalLevelResponse } from './api.ts';

/**
 * 右栏：总等级排行榜面板
 *
 * 为什么折叠而不是常驻展开？
 *   榜单数据粒度是"每小时刷新"，不属于玩家每分钟都要盯的信息；
 *   常驻展开会挤占同栏的背包视觉空间。点开时再拉数据即可。
 *
 * 为什么不用轮询自动更新？
 *   物化视图按小时刷新，前端轮询比它快没有意义——
 *   玩家每次展开时拉一次就是数据源允许的最新鲜结果；
 *   面板里提供手动"刷新"按钮兜底"刚结算完想立刻看"的场景。
 */
export function LeaderboardPanel() {
  const { t } = useT();
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TotalLevelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchTotalLevelLeaderboard(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // 展开时才拉第一次；折叠状态下不发起任何请求
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <div className="leaderboard-panel">
      <button
        type="button"
        className="leaderboard-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {t('leaderboard.title')}
      </button>

      {open && (
        <div className="leaderboard-body">
          {loading && <p className="leaderboard-status">{t('common.loading')}</p>}
          {error && <p className="leaderboard-error">{error}</p>}

          {data && !loading && (
            <>
              {/* 当前玩家行固定在顶部：玩家最关心的是"我"，不是第一名 */}
              <p className="leaderboard-me">
                {data.me
                  ? t('leaderboard.me').replace('{rank}', String(data.me.rank)).replace('{total}', String(data.me.totalLevel))
                  : t('leaderboard.me_unranked')}
              </p>

              {data.entries.length === 0 ? (
                <p className="leaderboard-status">{t('leaderboard.empty')}</p>
              ) : (
                <ol className="leaderboard-list">
                  {data.entries.map((entry) => (
                    <li
                      key={entry.playerId}
                      className={`leaderboard-row${data.me?.playerId === entry.playerId ? ' is-me' : ''}`}
                    >
                      <span className="leaderboard-rank">#{entry.rank}</span>
                      {/* player.name 当前不在物化视图里（保持视图最小），
                          用 id 前缀展示，与 SaveService.ensurePlayer 默认命名规则对应 */}
                      <span className="leaderboard-name">
                        {data.me?.playerId === entry.playerId
                          ? t('leaderboard.you')
                          : entry.playerId.slice(0, 8)}
                      </span>
                      <span className="leaderboard-total">
                        {t('leaderboard.total_level')} {entry.totalLevel}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}

          <div className="leaderboard-footer">
            <button
              type="button"
              className="leaderboard-refresh"
              onClick={() => void load()}
              disabled={loading || !token}
            >
              {t('leaderboard.refresh')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
