import { Injectable } from '@nestjs/common';
import {
  findLootTableByMonster,
  findTemplateById,
  rollLoot,
  QUALITY_ORDER,
  type LootResult,
  type Quality,
} from '@lazycraft/shared';
import { PrismaClient } from '../lib/prisma-client/client.js';

/** 广播列表返回给前端的单条视图 */
export interface BroadcastView {
  id: string;
  type: string;
  /** 触发者玩家 ID（当前不展示角色名——name 在 players 表，等排行榜视图合并后再考虑 join） */
  playerId: string;
  itemId: string;
  quality: Quality;
  createdAt: string;
}

/** 品质是否"至少达到 threshold"：按 QUALITY_ORDER 索引比较，epic 是最高档 */
function isQualityAtLeast(q: Quality, threshold: Quality): boolean {
  return QUALITY_ORDER.indexOf(q) >= QUALITY_ORDER.indexOf(threshold);
}

/**
 * 全服广播服务（task-17）
 *
 * 服务器权威关键点：
 *   1. 是否触发由 `Item.broadcast_threshold` 配置驱动，在写入侧判断；
 *      DB 不校验——广播表是"事件流水"，不是状态。
 *   2. 写入失败不抛给业务调用方：广播是"锦上添花"的可观测性事件，
 *      绝不能让广播写挂导致玩家掉落失败。
 *   3. 当前版本用"前端 10s 轮询 + GET /api/broadcasts"代替 WebSocket：
 *      放置游戏的玩家对实时性容忍度高（轮播延迟几秒无感），WebSocket
 *      会引入网关/会话管理复杂度，为单一功能不值。
 */
@Injectable()
export class BroadcastService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 把一次 loot 掉落结果上报进广播流（仅对达到该物品 broadcast_threshold 的触发）。
   *
   * 为什么把 threshold 判断写在这里而不是 DB / 前端？
   *   - DB：threshold 是内容配置（属于 packages/shared 的物品定义），不属于表约束；
   *   - 前端：threshold 是服务器权威规则的一部分，客户端不应决定"什么算稀有"。
   *
   * @param playerId 触发者玩家 id（players.id）
   * @param itemId Item.id（材料）或 EquipmentTemplate.id（装备底材）
   * @param quality 掉落品质
   * @param threshold 触发广播的最低品质（默认 'epic'，对应"稀有度 ≥ 史诗（epic）"）
   * @returns 写入成功返回视图；未达阈值或写库失败返回 null
   */
  async recordDrop(
    playerId: string,
    itemId: string,
    quality: Quality,
    threshold: Quality = 'epic',
  ): Promise<BroadcastView | null> {
    if (!isQualityAtLeast(quality, threshold)) return null;

    try {
      const row = await this.prisma.broadcast.create({
        data: {
          type: 'loot_drop',
          playerId,
          itemId,
          quality,
        },
      });
      return this.toView(row);
    } catch {
      // 静默失败——广播丢一条不致命，掉落主流程必须继续
      return null;
    }
  }

  /**
   * 列出最近的广播（按创建时间倒序）。
   *
   * @param limit 返回条数；<=0 时不限（当前 UI 一次性渲染前 N 条）
   */
  async listRecent(limit: number): Promise<{ broadcasts: BroadcastView[] }> {
    const take = Number.isFinite(limit) && limit > 0 ? Math.min(50, Math.floor(limit)) : 20;
    const rows = await this.prisma.broadcast.findMany({
      orderBy: { createdAt: 'desc' },
      take,
    });
    return { broadcasts: rows.map((r) => this.toView(r)) };
  }

  /**
   * 开发期模拟通路：对指定怪物 roll 一次掉落，如触发阈值则写广播。
   *
   * 为什么单独提供这个方法？
   *   战斗模块（task-18）尚未实现，没有真实的"打怪→掉落"路径；
   *   当前要验证"稀有掉落时写入 broadcasts 表"这条验收，需要一个
   *   可触发 rollLoot 的入口。等战斗上线后，recordDrop 会被战斗结算
   *   直接调用，本通路仅用于前端联调 / 演示。
   *
   * @param playerId 模拟触发者
   * @param monsterId 目标怪物（取它的 loot_table）
   * @param rng 测试期可注入确定性随机数；不传则走 Math.random
   */
  async simulateDrop(
    playerId: string,
    monsterId: string,
    rng: () => number = Math.random,
  ): Promise<{ broadcast: BroadcastView | null; loot: LootResult | null }> {
    const table = findLootTableByMonster(monsterId);
    if (!table) return { broadcast: null, loot: null };

    const loot = rollLoot({ table, rng }) ?? null;
    if (!loot) return { broadcast: null, loot: null };

    // 材料词条恒为 common，永远达不到 epic 阈值——直接跳过
    if (loot.kind === 'item') return { broadcast: null, loot };

    // 装备词条：阈值取底材模板对应物品的 broadcast_threshold；
    // 当前模板未在 items 表注册（模板与 Item 正交），无法按 item 查阈值，
    // 走装备通用规则：quality >= epic 即广播
    const template = findTemplateById(loot.equipment.template_id);
    if (!template) return { broadcast: null, loot };

    const broadcast = await this.recordDrop(playerId, template.id, loot.equipment.quality);
    return { broadcast, loot };
  }

  /* ---------------------------------------------------------------- */
  /* 内部                                                              */
  /* ---------------------------------------------------------------- */

  private toView(row: {
    id: string;
    type: string;
    playerId: string;
    itemId: string;
    quality: string;
    createdAt: Date;
  }): BroadcastView {
    return {
      id: row.id,
      type: row.type,
      playerId: row.playerId,
      itemId: row.itemId,
      quality: row.quality as Quality,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
