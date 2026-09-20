import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '../lib/prisma-client/client.js';
import { CURRENT_SAVE_VERSION, createEmptySaveData, type SaveData } from './save-shape.js';
import { migrateSave } from './migrations/index.js';

/** 旧账号懒创建用的随机名后缀：6 位小写字母数字，够短也够避开撞名 */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, '0');
}

/**
 * `read()` 用的"player + save"合并行。
 *
 * 为什么用原生 SQL 而不是 Prisma 的 `include`？
 *   `include` 对每个关联发一条独立查询（实测 `player.findFirst+include` ≈ 2×RTT）；
 *   而本项目的 PG 在远程主机，单次往返约 80ms，读路径每多一条查询就多 80ms。
 *   `LEFT JOIN` 一条查询同时取回玩家名、存档版本与 data，读路径因此少一次往返。
 * 为什么 LEFT JOIN 而不是 INNER JOIN？
 *   正常注册路径已有 player，但"player 存在、save 不存在"的懒创建分支必须能识别出来
 *   （此时 s.version 为 null），否则会静默走到"无存档"逻辑而漏建。
 */
interface PlayerSaveRow {
  player_id: string;
  player_name: string;
  version: number | null;
  data: unknown;
  updated_at: Date | null;
}

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
  constructor(public readonly prisma: PrismaClient) {}

  /**
   * 当前账号没有显式的"角色选择"流程，约定每个账号至少有一个默认 player。
   *
   * 注册流程（P3-7）已直接建好 player（name = 注册用户名），所以正常路径这里只
   * findFirst 命中就返回；**懒创建只服务旧账号**（P3-7 之前注册、尚无玩家）。
   *
   * 为什么懒创建要重试随机名？
   *   players.name 现在是全局唯一（P3-7）。旧账号补名时若随机码撞上已存在的名字，
   *   唯一约束会抛 P2002——重试换一个随机码即可，不该让玩家因此无法进入游戏。
   *
   * 为什么是 public？
   *   task-08 的 ActionModule 需要绕开"读存档"只拿 player.id 去做条件更新。
   *   把 player 定位逻辑收敛在这一处，比让 ActionModule 再写一遍 findFirst+create 更保险。
   */
  async ensurePlayer(accountId: string) {
    const existed = await this.prisma.player.findFirst({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
    });
    if (existed) {
      return existed;
    }

    // 旧账号兜底：随机名 + 冲突重试（唯一约束是最终裁判，避免撞名直接 500）
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.player.create({
          data: { accountId, name: `玩家-${randomSuffix()}` },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    throw new InternalServerErrorException('创建默认角色失败：随机名重复次数过多');
  }

  /**
   * 读取当前账号的存档；若存档不存在则按 v1 空结构懒创建一份。
   * 若 DB 里存档版本落后，迁移成功后立即回写。
   *
   * 性能：正常路径（player 与 save 都在）只发一条 LEFT JOIN 查询返回
   * { player, version, data, updatedAt }；懒创建与迁移回写才走额外写查询。
   */
  async read(accountId: string) {
    const row = await this.selectPlayerSave(accountId);

    // 旧账号无角色时才走懒创建（正常注册路径 P3-7 已建好 player）
    const playerId = row?.player_id ?? (await this.ensurePlayer(accountId)).id;

    if (!row || row.version === null) {
      const created = await this.prisma.save.create({
        data: {
          playerId,
          version: CURRENT_SAVE_VERSION,
          data: createEmptySaveData() as unknown as Prisma.InputJsonValue,
        },
      });
      return { version: CURRENT_SAVE_VERSION, data: created.data as unknown as SaveData, updatedAt: created.updatedAt };
    }

    if (row.version > CURRENT_SAVE_VERSION) {
      // 出现版本超前意味着数据库被人为/异常写入，必须当成服务器错误而不是悄悄返回，
      // 让上游 5xx 监控能捕获到这种数据一致性问题
      throw new InternalServerErrorException(
        `存档版本 v${row.version} 超过服务端支持的 v${CURRENT_SAVE_VERSION}`,
      );
    }

    let data = row.data as unknown as SaveData;
    let updatedAt = row.updated_at;
    if (row.version < CURRENT_SAVE_VERSION) {
      const migrated = migrateSave(row.version, data);
      const saved = await this.prisma.save.update({
        where: { playerId },
        data: {
          version: CURRENT_SAVE_VERSION,
          data: migrated as unknown as Prisma.InputJsonValue,
        },
      });
      data = migrated;
      updatedAt = saved.updatedAt;
    }

    return { version: CURRENT_SAVE_VERSION, data, updatedAt };
  }

  /**
   * 一条 LEFT JOIN 取回"账号最早角色 + 其存档"的原始行。
   *
   * 为什么用原生 SQL 而不是 Prisma 的 include？
   *   include 对关联另发一条查询（实测 2×RTT）；本项目 PG 在远程主机，
   *   单次往返约 80ms，读路径每多一条就多 80ms。LEFT JOIN 一次取全。
   * 为什么保留 LEFT JOIN（不 INNER JOIN）？
   *   必须能识别"有角色但无存档"（s.version 为 null）以触发懒创建。
   */
  private async selectPlayerSave(accountId: string): Promise<PlayerSaveRow | undefined> {
    const rows = await this.prisma.$queryRaw<PlayerSaveRow[]>`
      SELECT p.id AS player_id, p.name AS player_name,
             s.version AS version, s.data AS data, s.updated_at AS updated_at
      FROM players p
      LEFT JOIN saves s ON s.player_id = p.id
      WHERE p.account_id = ${accountId}
      ORDER BY p.created_at ASC
      LIMIT 1`;
    return rows[0];
  }

  /**
   * 读取存档 + 玩家名（个人信息聚合专用）。
   *
   * 为什么要单独开一个方法而不是 `ensurePlayer` + `read`？
   *   `/api/player` 需要 player.name，普通 `read()` 只返回 data；
   *   在远程 DB 下，分别查 player 与 save 是两条串行往返（≈160ms），
   *   而 player 行本就随 data 同一次 LEFT JOIN 取回。
   *   复用 read() 的懒创建/迁移语义，避免绕过它读到旧版本存档。
   */
  async readWithPlayer(accountId: string): Promise<{ name: string; data: SaveData; version: number }> {
    const row = await this.selectPlayerSave(accountId);
    if (row && row.version !== null && row.version > CURRENT_SAVE_VERSION) {
      throw new InternalServerErrorException(
        `存档版本 v${row.version} 超过服务端支持的 v${CURRENT_SAVE_VERSION}`,
      );
    }
    if (row && row.version === CURRENT_SAVE_VERSION) {
      return { name: row.player_name, data: row.data as unknown as SaveData, version: CURRENT_SAVE_VERSION };
    }
    // 懒创建 / 版本迁移：复用 read()，它内部会补齐 player 与 save 并回写
    const { data } = await this.read(accountId);
    const name = row?.player_name ?? (await this.ensurePlayer(accountId)).name;
    return { name, data, version: CURRENT_SAVE_VERSION };
  }

  /**
   * 写入存档：先做版本校验，再用客户端传入的 data 完整覆盖。
   *
   * "冲突以服务器为准"的实现：不是合并 data，而是当 version 不匹配时直接 409，
   * 让客户端重新拉取服务器的最新存档再决定下一步——保证服务端永远是唯一可信源。
   */
  async write(accountId: string, clientVersion: number, data: Record<string, unknown>) {
    // 一次 LEFT JOIN 同时拿 player 与当前版本，替代原先 ensurePlayer + findUnique 两条串行查询
    const row = await this.selectPlayerSave(accountId);
    const playerId = row?.player_id ?? (await this.ensurePlayer(accountId)).id;
    const currentVersion = row?.version ?? CURRENT_SAVE_VERSION;

    // 首次写入允许基于"空存档"直接创建；否则要求客户端版本必须等于 DB 版本
    if (row && row.version !== null && clientVersion !== currentVersion) {
      throw new ConflictException(
        `存档版本冲突：客户端 v${clientVersion}，服务端 v${currentVersion}，请重新拉取`,
      );
    }

    // 写入前先把客户端提供的 data 迁移到当前版本——
    // 允许客户端基于 v1 提交，但服务端永远只存 CURRENT_SAVE_VERSION 的形态
    const migrated = migrateSave(clientVersion, data as unknown as SaveData);

    const next = await this.prisma.save.upsert({
      where: { playerId },
      create: {
        playerId,
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
