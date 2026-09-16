import { useCallback, useEffect, useState } from 'react';
import { findTemplateById } from '@lazycraft/shared';
import { useT } from '../i18n/index.ts';
import { fetchRecentBroadcasts, type BroadcastEntry } from './api.ts';

/**
 * 顶部滚动广播条（task-17 前端）
 *
 * 数据通路：10s 轮询 GET /api/broadcasts 拉最近 20 条。
 *
 * 为什么用轮询而不是 WebSocket？
 *   放置游戏玩家对实时性容忍度极高（几秒钟延迟无感），WebSocket 引入的
 *   网关/会话/断线重连管理复杂度为单一功能不值。服务器权威原则下，
 *   广播本来就是事件流水，"晚几秒才看到"完全可接受。
 *
 * 轮播节奏：6s/条（CSS transition 时长一致），避免与 10s 的拉取节拍打架。
 *
 * 点击展示详情：只读弹窗，展示触发玩家 id 前 8 位 + 装备名 + 品质 + 时间，
 * 与排行榜"用 id 前缀展示"约定一致（玩家名在 players 表，未来再做 join）。
 */

const POLL_INTERVAL_MS = 10_000;
const CAROUSEL_INTERVAL_MS = 6_000;

/** 品质 → 取色 class 后缀；样式在 index.css */
type QualityClass = 'common' | 'uncommon' | 'rare' | 'epic';
function toQualityClass(q: string): QualityClass {
  if (q === 'uncommon' || q === 'rare' || q === 'epic') return q;
  return 'common';
}

/**
 * 从广播条目解析"装备显示名"。
 *
 * 装备实例由 EquipmentTemplate 派生，base_name 是显示名打底；
 * 找不到模板时回退 itemId（不破坏 UI，给开发期一个可定位的字符串）。
 */
function useItemDisplayName(b: BroadcastEntry): string {
  const template = findTemplateById(b.itemId);
  if (template) return template.base_name;
  return b.itemId;
}

function DetailCard({ broadcast, onClose }: { broadcast: BroadcastEntry; onClose: () => void }) {
  const { t } = useT();
  const name = useItemDisplayName(broadcast);
  const qualityKey = `quality.name.${toQualityClass(broadcast.quality)}`;
  return (
    <div className="broadcast-detail" role="dialog" aria-modal="true" aria-label={t('broadcast.detail_title')}>
      <header className="broadcast-detail-head">
        <h3 className="broadcast-detail-title">{t('broadcast.detail_title')}</h3>
        <button type="button" className="broadcast-detail-close" onClick={onClose} aria-label={t('common.cancel')}>
          ×
        </button>
      </header>
      <dl className="broadcast-detail-body">
        <div>
          <dt>{t('broadcast.detail_player')}</dt>
          <dd>{broadcast.playerId.slice(0, 8)}</dd>
        </div>
        <div>
          <dt>{t('broadcast.detail_item')}</dt>
          <dd className={`broadcast-name is-${toQualityClass(broadcast.quality)}`}>{name}</dd>
        </div>
        <div>
          <dt>{t('broadcast.detail_quality')}</dt>
          <dd className={`is-${toQualityClass(broadcast.quality)}`}>{t(qualityKey)}</dd>
        </div>
        <div>
          <dt>{t('broadcast.detail_time')}</dt>
          <dd>{new Date(broadcast.createdAt).toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  );
}

function CarouselItem({ broadcast, onClick }: { broadcast: BroadcastEntry; onClick: () => void }) {
  const { t } = useT();
  const name = useItemDisplayName(broadcast);
  const colorClass = `is-${toQualityClass(broadcast.quality)}`;
  return (
    <button type="button" className="broadcast-item" onClick={onClick}>
      <span className="broadcast-player">{broadcast.playerId.slice(0, 8)}</span>
      <span className="broadcast-verb">{t('broadcast.drop_verb')}</span>
      <span className={`broadcast-name ${colorClass}`}>{name}</span>
      <span className={`broadcast-quality ${colorClass}`}>[{t(`quality.name.${toQualityClass(broadcast.quality)}`)}]</span>
    </button>
  );
}

export function BroadcastBar() {
  const { t } = useT();
  const [broadcasts, setBroadcasts] = useState<BroadcastEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<BroadcastEntry | null>(null);

  const load = useCallback(async () => {
    try {
      const { broadcasts: list } = await fetchRecentBroadcasts(20);
      // 防止新列表比游标短——游标跟着列表长度走是 UI 最直观的行为
      setBroadcasts(list);
      setCursor((prev) => (list.length === 0 ? 0 : prev % list.length));
    } catch {
      // 轮询失败静默跳过：下一次 tick 再试，不打扰玩家。
      // 错误上报由全局 ErrorBoundary 处理；这里只是 UI 演出层。
    }
  }, []);

  /* 初始加载 + 10s 轮询 */
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  /* 6s 轮播前进 */
  useEffect(() => {
    if (broadcasts.length === 0) return;
    const timer = setInterval(() => {
      setCursor((prev) => (prev + 1) % broadcasts.length);
    }, CAROUSEL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [broadcasts.length]);

  /* 详情弹窗 ESC 关闭 */
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  if (broadcasts.length === 0) {
    // 空态保留容器，避免轮播条突然出现/消失造成版心抖动
    return (
      <div className="broadcast-bar" aria-live="polite" aria-label={t('broadcast.region_label')} />
    );
  }

  const current = broadcasts[cursor];

  return (
    <>
      <div className="broadcast-bar" aria-live="polite" aria-label={t('broadcast.region_label')}>
        <span className="broadcast-prefix">{t('broadcast.prefix')}</span>
        <CarouselItem broadcast={current} onClick={() => setSelected(current)} />
      </div>
      {selected && <DetailCard broadcast={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
