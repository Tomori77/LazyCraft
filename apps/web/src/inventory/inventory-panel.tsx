import { useEffect, useState } from 'react';
import { ITEMS } from '@lazycraft/shared';
import { useT } from '../i18n/index.ts';
import { useAction } from '../action/action-context.tsx';

/**
 * 右栏：背包 / 资源数量显示
 *
 * 为什么"bump 跳动动画"用 nonce key 重挂载而不是 CSS class 切换？
 *   CSS 动画在同一元素上重复触发需要 reflow 或 animation 重置技巧，
 *   用 React 的 key 直接换一个新 DOM 节点是最干净的"播放一次动画"方式：
 *   React 会因为 key 变化卸载旧节点、挂载新节点，动画从 0% 开始播放，
 *   不需要 JS 端的任何 cleanup。
 *
 * 为什么数量显示用 context 的 inventoryTotals 而不是每次从 save 拉？
 *   stop 时已经把最新背包写进 context；直接消费即可，无需额外请求。
 *   登录后的初始数据也是同一份，由 ActionProvider 在挂载时统一刷新。
 */

/** 单个资源条：含跳动动画 */
function ResourceRow({ itemId, nonce }: { itemId: string; nonce: number | undefined }) {
  const { t } = useT();
  const { inventoryTotals } = useAction();
  const quantity = inventoryTotals[itemId] ?? 0;

  // 每次 nonce 变化都用 key 重挂载，触发 bump 动画从头播放
  return (
    <li className="resource-row" key={`${itemId}:${nonce ?? 0}`}>
      <span className="resource-icon" aria-hidden="true">
        {itemId.charAt(0).toUpperCase()}
      </span>
      <span className="resource-name">{t(`item.${itemId}.name`)}</span>
      <span className={`resource-quantity${nonce !== undefined ? ' is-bumping' : ''}`}>{quantity}</span>
    </li>
  );
}

export function InventoryPanel() {
  const { t } = useT();
  const { inventoryTotals, resourceBumps } = useAction();
  const [bumps, setBumps] = useState<Record<string, number>>({});

  // 把 resourceBumps 拷贝到本地 state：动画播放由 React 的 key 机制负责，
  // context 侧在下次结算时会被替换，本地 state 保留 nonce 让已挂载的动画播完
  useEffect(() => {
    setBumps((prev) => {
      const next = { ...prev };
      for (const [itemId, bump] of Object.entries(resourceBumps)) {
        next[itemId] = bump.nonce;
      }
      return next;
    });
  }, [resourceBumps]);

  // 只显示玩家背包里已有的物品；空背包时给一句提示
  const ownedItems = ITEMS.filter((item) => (inventoryTotals[item.id] ?? 0) > 0);

  return (
    <div className="inventory-panel">
      <h2>{t('nav.inventory')}</h2>
      {ownedItems.length === 0 ? (
        <p className="inventory-empty">{t('layout.placeholder')}</p>
      ) : (
        <ul className="resource-list">
          {ownedItems.map((item) => (
            <ResourceRow key={item.id} itemId={item.id} nonce={bumps[item.id]} />
          ))}
        </ul>
      )}
    </div>
  );
}
