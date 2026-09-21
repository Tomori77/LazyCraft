import { useT } from '../i18n/index.ts';
import { toQualityClass } from '../lib/quality.ts';
import type { EquipmentInstance, CarriedItem } from '@lazycraft/shared';

/**
 * 物品详情内容（hover 浮层与右键"详细信息"共用）。
 *
 * 为什么抽成独立组件？
 *   hover 浮层与右键菜单的"详细信息"必须显示同一份内容；
 *   若各写一份，任何字段调整都会只改到一处，两条路径立刻漂移。
 *   这里只负责"内容"，定位/容器（.item-popover 外壳）仍由调用方决定。
 */
export function ItemDetail({ item }: { item: CarriedItem }) {
  return item.kind === 'equipment' ? <EquipmentDetail item={item} /> : <StackDetail item={item} />;
}

/** 装备详情：名称按品质着色 + 槽位 + 门槛 + 属性快照 */
function EquipmentDetail({ item }: { item: EquipmentInstance }) {
  const { t } = useT();
  return (
    <div>
      <div className={`popover-name ${toQualityClass(item.quality)}`}>{item.display_name}</div>
      <div className="popover-meta">
        <span>{t(`slot.${item.slot}`)}</span> | <span>{t('work.card.level')}: {item.required_level}</span>
      </div>
      <div className="popover-stats">
        {item.final_stats.attack !== 0 && (
          <div>
            {t('profile.stat.attack')} {item.final_stats.attack > 0 ? '+' : ''}
            {item.final_stats.attack}
          </div>
        )}
        {item.final_stats.defense !== 0 && (
          <div>
            {t('profile.stat.defense')} {item.final_stats.defense > 0 ? '+' : ''}
            {item.final_stats.defense}
          </div>
        )}
        {item.final_stats.hp !== 0 && (
          <div>
            {t('profile.stat.hp')} {item.final_stats.hp > 0 ? '+' : ''}
            {item.final_stats.hp}
          </div>
        )}
      </div>
    </div>
  );
}

/** 堆叠物详情：名称 + 持有数量 */
function StackDetail({ item }: { item: Extract<CarriedItem, { kind: 'stack' }> }) {
  const { t } = useT();
  return (
    <div>
      <div className="popover-name">{t(`item.${item.item_id}.name`)}</div>
      <div className="popover-meta">
        {t('inventory.quantity')}: {item.quantity}
      </div>
    </div>
  );
}
