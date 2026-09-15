import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '../lib/prisma-client/client.js';
import { CURRENT_SAVE_VERSION, createEmptySaveData, type SaveData } from './save-shape.js';
import { migrateSave } from './migrations/index.js';

/**
 * 存档读写服务
 *
 * 服务器权威的关键点：
 *   - 读取时如果检测到旧版本，立即用迁移脚本把 data 升级并回写 DB；
 *     这样所有下游消费者（结算引擎、前端）永远只面对 CURRENT_SAVE_VERSION 的存档。
 *   - 写入时校验 version 与 DB 当前版本一致才允许覆盖；不一致返回 409，
 *     由客户端重新拉取后再重试（"冲突以服务器为准"）。
 */
@Injectable()
export class SaveService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 当前账号没有显式的"角色选择"流程，约定每个账号至少有一个默认 player。
   * 这里通过 findFirst + create 实现"懒创建"——避免要求客户端先调用一个创建角色的接口。
   *
   * 为什么不在注册账号时同步创建 player？
   *   注册与存档属于不同模块的职责；用懒创建可以让 AuthModule 不需要感知 Player 的存在，
   *   后续要支持"多存档槽位"时也是改这一处而不是动注册流程。
   */
  private async ensureDefaultPlayer(accountId: string) {
    const existed = await this.prisma.player.findFirst({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
    });
    if (existed) {
      return existed;
    }
    // 默认角色名直接使用账号 id 的前 8 位，便于调试时一眼定位所属账号
    return this.prisma.player.create({
      data: { accountId, name: `player-${accountId.slice(0, 8)}` },
    });
  }

  /**
   * 读取当前账号的存档；若存档不存在则按 v1 空结构懒创建一份。
   * 若 DB 里存档版本落后，迁移成功后立即回写。
   */
  async read(accountId: string) {
    const player = await this.ensureDefaultPlayer(accountId);
    let save = await this.prisma.save.findUnique({ where: { playerId: player.id } });

    if (!save) {
      save = await this.prisma.save.create({
        data: {
          playerId: player.id,
          version: CURRENT_SAVE_VERSION,
          data: createEmptySaveData() as unknown as Prisma.InputJsonValue,
        },
      });
    }

    if (save.version > CURRENT_SAVE_VERSION) {
      // 出现版本超前意味着数据库被人为/异常写入，必须当成服务器错误而不是悄悄返回，
      // 让上游 5xx 监控能捕获到这种数据一致性问题
      throw new InternalServerErrorException(
        `存档版本 v${save.version} 超过服务端支持的 v${CURRENT_SAVE_VERSION}`,
      );
    }

    let data = save.data as unknown as SaveData;
    if (save.version < CURRENT_SAVE_VERSION) {
      const migrated = migrateSave(save.version, data);
      save = await this.prisma.save.update({
        where: { id: save.id },
        data: {
          version: CURRENT_SAVE_VERSION,
          data: migrated as unknown as Prisma.InputJsonValue,
        },
      });
      data = migrated;
    }

    return {
      version: CURRENT_SAVE_VERSION,
      data,
      updatedAt: save.updatedAt,
    };
  }

  /**
   * 写入存档：先做版本校验，再用客户端传入的 data 完整覆盖。
   *
   * "冲突以服务器为准"的实现：不是合并 data，而是当 version 不匹配时直接 409，
   * 让客户端重新拉取服务器的最新存档再决定下一步——保证服务端永远是唯一可信源。
   */
  async write(accountId: string, clientVersion: number, data: Record<string, unknown>) {
    const player = await this.ensureDefaultPlayer(accountId);
    const save = await this.prisma.save.findUnique({ where: { playerId: player.id } });

    // 首次写入允许基于"空存档"直接创建；否则要求客户端版本必须等于 DB 版本
    const currentVersion = save?.version ?? CURRENT_SAVE_VERSION;
    if (save && clientVersion !== currentVersion) {
      throw new ConflictException(
        `存档版本冲突：客户端 v${clientVersion}，服务端 v${currentVersion}，请重新拉取`,
      );
    }

    // 写入前先把客户端提供的 data 迁移到当前版本——
    // 允许客户端基于 v1 提交，但服务端永远只存 CURRENT_SAVE_VERSION 的形态
    const migrated = migrateSave(clientVersion, data as unknown as SaveData);

    const next = await this.prisma.save.upsert({
      where: { playerId: player.id },
      create: {
        playerId: player.id,
        version: CURRENT_SAVE_VERSION,
        data: migrated as unknown as Prisma.InputJsonValue,
      },
      update: {
        version: CURRENT_SAVE_VERSION,
        data: migrated as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      version: CURRENT_SAVE_VERSION,
      data: next.data as unknown as SaveData,
      updatedAt: next.updatedAt,
    };
  }
}
