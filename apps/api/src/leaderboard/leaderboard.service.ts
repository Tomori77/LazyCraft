import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../lib/prisma-client/client.js';

/** 物化视图刷新间隔：1 小时（与部署方案"PG 物化视图每小时刷新"一致） */
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/** 总等级榜上一行的形状（物化视图查询结果） */
interface LeaderboardRow {
  player_id: string;
  /** PG int8/numeric 经 pg 驱动默认返回 string|number；聚合后 int 可能是 bigint */
  total_level: bigint | number;
  /** RANK() 窗口函数产出，pg 驱动下 int8 会是 bigint */
  rank: bigint | number;
}

/**
 * 排行榜服务
 *
 * 排行榜的三层结构：
 *   1. 源数据：saves.data(jsonb) 里的 skills.exp——服务器权威的唯一事实源；
 *   2. 物化视图 leaderboard_total_level：每小时把 jsonb 展开预聚合（见 migration.sql）；
 *   3. 本服务：读视图 + 在 SQL 层用 RANK() 窗口函数算名次，一次性出榜。
 *
 * 为什么定时器挂在 Service 里而不是 @Cron？
 *   task-16 允许"NestJS Schedule 或简单定时器"。引入 @nestjs/schedule 会多一个
 *   依赖 + 一个全局 DiscoveryService 扫描；当前刷新逻辑只有一条 SQL，
 *   setInterval 足够，模块销毁时 clearInterval 即可，测试里也不会泄漏句柄。
 */
@Injectable()
export class LeaderboardService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeaderboardService.name);
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  onModuleInit() {
    // 启动后立即刷一次：避免服务重启后到下一个整点之间榜单是旧数据
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    // 不阻止进程退出：测试（vitest）和开发热重载都不希望被定时器吊住
    this.refreshTimer.unref();
  }

  onModuleDestroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * 刷新物化视图。失败只记录日志不抛出——
   * 榜单晚一个小时更新不致命，但把异常抛进定时器回调会变成未处理拒绝。
   */
  async refresh(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW leaderboard_total_level');
      this.logger.log('物化视图 leaderboard_total_level 已刷新');
    } catch (e) {
      this.logger.error('物化视图刷新失败', e instanceof Error ? e.stack : String(e));
    }
  }

  /**
   * 取总等级榜。
   * @param limit 返回前多少名；0 = 不限制（当前 UI 一次性渲染，暂不分页）
   *
   * 为什么在 SQL 层用 RANK() 而不是在 JS 里排序？
   *   "当前玩家的名次"需要全量扫描才能确定（它可能不在前 N 名里）；
   *   用窗口函数让 PG 一次扫描同时产出"带名次的完整榜单"，
   *   JS 只做切片和找人，避免取前 N 后再专程查一次"我排第几"。
   */
  async getTotalLevel(limit: number, currentPlayerId?: string) {
    const rows = await this.prisma.$queryRawUnsafe<LeaderboardRow[]>(`
      SELECT player_id, total_level,
             RANK() OVER (ORDER BY total_level DESC) AS rank
      FROM leaderboard_total_level
      ORDER BY total_level DESC, player_id
    `);

    const entries = rows.map((row) => ({
      playerId: row.player_id,
      totalLevel: Number(row.total_level),
      rank: Number(row.rank),
    }));

    const me = currentPlayerId
      ? (entries.find((entry) => entry.playerId === currentPlayerId) ?? null)
      : null;

    return {
      entries: limit > 0 ? entries.slice(0, limit) : entries,
      me,
    };
  }
}
