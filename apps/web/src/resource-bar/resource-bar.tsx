import { useMemo, useState } from 'react';
import { useT } from '../i18n/index.ts';
import { useContent } from '../content/content-context.tsx';
import { usePlayer } from '../player/player-context.tsx';

/**
 * 顶部资源条（通栏）。
 *
 * 铁律：资源清单来自 `GET /api/content` 的 abstractResources，按 tier 升序取前 3 项常驻，
 * 其余折叠进"更多"；不得写死 gold/res_wood 等任何 id。数值来自 `GET /api/player`。
 */
export function ResourceBar() {
  const { t } = useT();
  const { content } = useContent();
  const { player } = usePlayer();
  const [showMore, setShowMore] = useState(false);

  const sortedResources = useMemo(() => {
    if (!content?.abstractResources) return [];
    return [...content.abstractResources].sort((a, b) => a.tier - b.tier);
  }, [content]);

  const topThree = sortedResources.slice(0, 3);
  const remaining = sortedResources.slice(3);

  const amountOf = (resId: string) => player?.abstract_resources?.[resId] ?? 0;

  return (
    <header className="resource-bar-container">
      <div className="resource-bar-main">
        {topThree.map((res) => (
          <div key={res.id} className="resource-item">
            <span className="resource-icon" aria-hidden="true">
              {res.icon || res.name.charAt(0)}
            </span>
            <span className="resource-name">{t(`resource.${res.id}.name`)}</span>
            <span className="resource-value">{amountOf(res.id).toLocaleString()}</span>
          </div>
        ))}

        {remaining.length > 0 && (
          <div className="resource-more-wrapper">
            <button
              type="button"
              className="resource-more-btn"
              onClick={() => setShowMore((v) => !v)}
              aria-expanded={showMore}
            >
              {t('resource.more')} ▾
            </button>

            {showMore && (
              <div className="resource-dropdown">
                {remaining.map((res) => (
                  <div key={res.id} className="resource-dropdown-item">
                    <span className="resource-icon" aria-hidden="true">
                      {res.icon || res.name.charAt(0)}
                    </span>
                    <span className="resource-name">{t(`resource.${res.id}.name`)}</span>
                    <span className="resource-value">{amountOf(res.id).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
