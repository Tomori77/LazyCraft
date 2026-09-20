import { useMemo } from 'react';
import { useT } from '../i18n/index.ts';
import { useContent } from '../content/content-context.tsx';
import { usePlayer } from '../player/player-context.tsx';
import { Icon } from '../icons/icon.tsx';
import { resourceIconName } from '../icons/resolve-icon.ts';

/** 右上角抽象资源最多常驻展示的条数（P2-5：取消"更多"，按加载顺序取前 5） */
const MAX_RESOURCES = 5;

/**
 * 右上角抽象资源条。
 *
 * 铁律：资源清单来自 `GET /api/content` 的 abstractResources，按**加载顺序**
 * 取前 5 项常驻（docs/07 定稿），不写死 gold/res_wood 等任何 id；
 * 数值来自 `GET /api/player`。超出 5 项的部分不折叠、不设"更多"——
 * 避免顶栏高度不定与额外交互面。
 */
export function ResourceBar() {
  const { t } = useT();
  const { content } = useContent();
  const { player } = usePlayer();

  const topResources = useMemo(
    () => (content?.abstractResources ?? []).slice(0, MAX_RESOURCES),
    [content],
  );

  const amountOf = (resId: string) => player?.abstract_resources?.[resId] ?? 0;

  return (
    <div className="resource-strip" aria-label={t('resources.title')}>
      {topResources.map((res) => (
        <div key={res.id} className="resource-chip">
          <span className="dot" aria-hidden="true">
            <Icon name={resourceIconName(res.icon, res.id)} size={16} fallback={res.name.charAt(0)} />
          </span>
          <span className="rname">{t(`resource.${res.id}.name`)}</span>
          <span className="rval">{amountOf(res.id).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
