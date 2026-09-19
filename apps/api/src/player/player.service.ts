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
    // 先确保 player 存在再读存档：read() 内部也会 ensurePlayer，
    // 但 name 需要从 player 行取，这里显式拿一次避免 service 再查一遍 player 表
    const player = await this.saveService.ensurePlayer(accountId);
    const { data } = await this.saveService.read(accountId);
    return buildPlayerData(player.name, this.contentService.getSnapshot(), data);
  }
}
