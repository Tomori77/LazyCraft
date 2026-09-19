import { useState } from 'react';
import { useT } from '../i18n/index.ts';
import { usePlayer } from '../player/player-context.tsx';
import { InventoryGrid } from '../inventory/inventory-grid.tsx';
import type { CarriedItem } from '@lazycraft/shared';

/**
 * 仓库面板：网格 + 搜索 + 分类筛选（材料/装备），与背包同构、可互相拖拽移动。
 */
interface StoragePanelProps {
  onDragStartItem: (item: CarriedItem) => void;
  onDragEndItem: () => void;
}

type CategoryFilter = 'all' | 'material' | 'equipment';

export function StoragePanel({ onDragStartItem, onDragEndItem }: StoragePanelProps) {
  const { t } = useT();
  const { player, moveItem } = usePlayer();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const items = player?.storage ?? [];
  const capacity = player?.carry?.storage_capacity ?? 0;

  // 分类只区分"装备实例 vs 堆叠物"，材料/消耗品的更细类目由物品表决定，不在此写死
  const filtered = items.filter((item) => {
    if (category === 'equipment') return item.kind === 'equipment';
    if (category === 'material') return item.kind === 'stack';
    return true;
  });

  return (
    <div className="storage-panel-section">
      <div className="storage-header">
        <h3>{t('storage.title')}</h3>
        <span className="storage-capacity">
          {items.length} / {capacity}
        </span>
      </div>

      <div className="storage-controls">
        <input
          type="text"
          className="storage-search-input"
          placeholder={t('storage.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="storage-filter-tabs">
          {(['all', 'material', 'equipment'] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`filter-btn ${category === key ? 'is-active' : ''}`}
              onClick={() => setCategory(key)}
            >
              {t(`inventory.tab.${key}`)}
            </button>
          ))}
        </div>
      </div>

      <InventoryGrid
        items={filtered}
        capacity={capacity}
        containerType="storage"
        searchQuery={search}
        onDragStartItem={onDragStartItem}
        onDragEndItem={onDragEndItem}
        onDropFromOther={(uid, from) => void moveItem(uid, from, 'storage')}
      />
    </div>
  );
}
