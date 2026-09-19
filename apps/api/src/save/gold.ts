import type { SaveData } from './save-shape.js';

/** 抽象资源 key：金币。与 shared 的 RES_GOLD / 市场 GOLD_KEY 对齐 */
export const GOLD_KEY = 'gold';

/**
 * 从 data.abstract_resources 读金币余额；字段缺失或非法一律视为 0。
 *
 * 为什么抽成独立文件而不是各模块各写一份？
 *   金币是"唯一被多个系统（市场/商店/任务奖励）共同读写"的抽象资源，
 *   读侧 floor + 非负兜底、写侧只动 gold 一个字段——这套语义必须一致，
 *   否则某个模块写进浮点数会让金币账目在别处溢出。market 模块暂不迁移，
 *   新的 inventory/shop 从这一处取用。
 */
export function readGold(data: SaveData): number {
  const raw = (data.abstract_resources as Record<string, unknown> | undefined)?.[GOLD_KEY];
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

/** 写回金币余额：只动 gold 一个字段，其它抽象资源原样保留 */
export function writeGold(data: SaveData, gold: number): SaveData {
  return {
    ...data,
    abstract_resources: {
      ...(data.abstract_resources as Record<string, unknown> | undefined),
      [GOLD_KEY]: Math.max(0, Math.floor(gold)),
    },
  };
}
