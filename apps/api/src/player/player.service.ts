import { Injectable } from '@nestjs/common';
import { ContentService } from '../content/content.service.js';
import { SaveService } from '../save/save.service.js';
import { buildPlayerData, type PlayerData } from './player-shape.js';

/**
 * 玩家信息聚合服务（task-26）。
 *
 * 只读且复用 SaveService.read()：那里有懒创建与版本迁移，
 * 绕过它直接查 saves 表会让"老存档读到 v2 形态"或"新玩家拿不到默认结构"。
 */
@Injectable()
export class PlayerService {
  constructor(
    private readonly saveService: SaveService,
    private readonly contentService: ContentService,
  ) {}

  async getPlayer(accountId: string): Promise<PlayerData> {
    // player.name 与存档由 readWithPlayer 一条 LEFT JOIN 取回：
    // 原先 ensurePlayer + read 是两条串行查询（远程 DB 下 ≈160ms），
    // 而玩家名本就和 data 同行；懒创建/迁移语义仍由 read() 兜底。
    const { name, data } = await this.saveService.readWithPlayer(accountId);
    return buildPlayerData(name, this.contentService.getSnapshot(), data);
  }
}
