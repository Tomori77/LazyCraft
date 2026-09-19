import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
// 槽位清单从 shared 派生，避免前后端各写死一份 10 槽常量而漂移
import { EQUIPMENT_SLOTS } from '@lazycraft/shared';

const SLOT_IDS = EQUIPMENT_SLOTS.map((s) => s.id);
const CONTAINER_IDS = ['inventory', 'storage'] as const;

/** POST /api/inventory/move：跨容器移动单件（装备实例也可整体搬运） */
export class MoveItemDto {
  @IsString({ message: 'uid 必须是字符串' })
  @IsNotEmpty({ message: 'uid 不能为空' })
  uid: string;

  @IsIn(CONTAINER_IDS, { message: 'from 必须是 inventory/storage 之一' })
  from: 'inventory' | 'storage';

  @IsIn(CONTAINER_IDS, { message: 'to 必须是 inventory/storage 之一' })
  to: 'inventory' | 'storage';
}

/** POST /api/inventory/equip：客户端传的 slot 只是意图，服务端必须重跑 canEquip */
export class EquipItemDto {
  @IsString({ message: 'uid 必须是字符串' })
  @IsNotEmpty({ message: 'uid 不能为空' })
  uid: string;

  @IsIn(SLOT_IDS, { message: 'slot 不是合法的装备槽位' })
  slot: string;
}

/** POST /api/inventory/unequip：卸下指定槽位到背包 */
export class UnequipItemDto {
  @IsIn(SLOT_IDS, { message: 'slot 不是合法的装备槽位' })
  slot: string;
}

/** POST /api/inventory/discard：quantity 缺省 = 整格（堆叠）/整件（装备） */
export class DiscardItemDto {
  @IsString({ message: 'uid 必须是字符串' })
  @IsNotEmpty({ message: 'uid 不能为空' })
  uid: string;

  @IsOptional()
  @IsInt({ message: 'quantity 必须是整数' })
  @Min(1, { message: 'quantity 必须 ≥ 1' })
  quantity?: number;
}
