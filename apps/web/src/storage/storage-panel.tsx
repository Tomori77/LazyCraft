import { useState } from 'react';
import { useT } from '../i18n/index.ts';
import { usePlayer } from '../player/player-context.tsx';
import { useContent } from '../content/content-context.tsx';
import { InventoryGrid } from '../inventory/inventory-grid.tsx';
import { Icon } from '../icons/icon.tsx';
import type { CarriedItem } from '@lazycraft/shared';

/**
 * 仓库面板：与背包同构的预览网格（5×2）+ 搜索，可互相拖拽移动。
 *
 * 为什么不做分类筛选页签？
 *   右栏高度在 1280×720 下已很紧（P2-10 要求无滚动条）；
 *   原型定稿的仓库只有 标题 / 搜索 / 网格 三段，分类筛选会让第四段溢出。
 */
interface StoragePanelProps {
  onDragStartItem: (item: CarriedItem) => void;
  onDragEndItem: () => void;
}

export function StoragePanel({ onDragStartItem, onDragEndItem }: StoragePanelProps) {
  const { t } = useT();
  const { content } = useContent();
  const { player, moveItem, equipItem, discardItem } = usePlayer();
  const [search, setSearch] = useState('');

  const items = player?.storage ?? [];

  return (
    <>
      <div className="rcard-head">
        <h3>{t('storage.title')}</h3>
        <span className="cap">
          {items.length} / {player?.carry?.storage_capacity ?? 0}
        </span>
      </div>

      <div className="search">
        <Icon name="ui.search" size={14} />
        <input
          type="text"
          placeholder={t('storage.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <InventoryGrid
        items={items}
        capacity={player?.carry?.storage_capacity ?? 0}
        containerType="storage"
        searchQuery={search}
        onDragStartItem={onDragStartItem}
        onDragEndItem={onDragEndItem}
        onDropFromOther={(uid, from) => void moveItem(uid, from, 'storage')}
        onEquipItem={(uid, slot) => equipItem(uid, slot)}
        onMoveItem={(uid, from, to) => moveItem(uid, from, to)}
        onDiscardItem={(uid, quantity) => discardItem(uid, quantity)}
        playerLevel={player?.level ?? 1}
        equipmentSlots={content?.equipmentSlots ?? []}
      />
    </>
  );
}
