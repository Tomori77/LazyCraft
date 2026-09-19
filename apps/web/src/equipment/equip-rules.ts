import { canEquip, type EquipmentInstance, type EquipmentSlot } from '@lazycraft/shared';

/** 穿戴校验结果：ok=false 时 reasonKey 是 i18n key，文案不落在数据层 */
export interface EquipCheckResult {
  ok: boolean;
  reasonKey?: 'equip.reason.slot_mismatch' | 'equip.reason.level_too_low';
}

/**
 * 前端展示用的 canEquip 包装。
 *
 * 为什么不在前端重写规则？
 *   判定的唯一来源是 shared 的 canEquip（戒指两槽可互换等规则都在那里）；
 *   这里只负责把稳定的原因枚举翻译成 i18n key，绝不复制判定逻辑。
 */
export function canEquipClient(
  item: EquipmentInstance,
  targetSlot: EquipmentSlot,
  playerLevel: number,
): EquipCheckResult {
  const result = canEquip(item, targetSlot, playerLevel);
  return result.ok ? { ok: true } : { ok: false, reasonKey: reasonKeyOf(result.reason) };
}

function reasonKeyOf(
  reason: 'slot_mismatch' | 'level_too_low',
): 'equip.reason.slot_mismatch' | 'equip.reason.level_too_low' {
  return reason === 'level_too_low' ? 'equip.reason.level_too_low' : 'equip.reason.slot_mismatch';
}
