import { Injectable } from '@nestjs/common';
import { BUILTIN_PACKS } from '@lazycraft/shared';
import { PrismaClient } from '../lib/prisma-client/client.js';

/**
 * 内容包启用状态读写（task-41）。
 *
 * 为什么单独一个 service 而不是塞进 ContentService？
 *   ContentService 持有的是**不可变快照**（task-22 铁律：进程内只建一次），
 *   而本 service 读写的是**可变的管理状态**（DB 开关）。两者生命周期与
 *   一致性契约完全不同：快照重启才刷新，开关随时可写。
 *   合在一起会让"改了开关但快照没变"看起来像 bug。
 *
 * 默认语义：**表里没有记录的 pack 视为启用**。
 *   保证首次部署 / 新编译进来的 pack 不因缺行被意外停用。
 *   显式写 false 才会停用；显式写 true 会落一行，语义与缺行等价但更可查。
 */
@Injectable()
export class ContentPackStateService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 读取"启用集合"：只在 DB 里显式标了 enabled=false 的 pack 被排除。
   *
   * 为什么返回 BUILTIN_PACKS 里存在的 id，而不是 DB 里所有行？
   *   表里可能有历史遗留的、已从编译产物移除的 pack id；把它们当启用集合
   *   传给注册逻辑没有意义（注册时会被清单过滤掉），但会影响日志可读性。
   */
  async enabledPackIds(): Promise<string[]> {
    const rows = await this.prisma.contentPackState.findMany();
    const disabled = new Set(rows.filter((row) => !row.enabled).map((row) => row.id));
    return BUILTIN_PACKS.filter((pack) => !disabled.has(pack.id)).map((pack) => pack.id);
  }

  /** 单个 pack 是否启用（缺行 = 启用） */
  async isEnabled(packId: string): Promise<boolean> {
    const row = await this.prisma.contentPackState.findUnique({ where: { id: packId } });
    return row?.enabled ?? true;
  }

  /** 写入启用状态（upsert：无记录时新建，有记录时覆盖） */
  async setEnabled(packId: string, enabled: boolean): Promise<void> {
    await this.prisma.contentPackState.upsert({
      where: { id: packId },
      create: { id: packId, enabled },
      update: { enabled },
    });
  }

  /** 全部显式状态（缺行的默认 true 由调用方补齐），管理列表用 */
  async states(): Promise<Map<string, boolean>> {
    const rows = await this.prisma.contentPackState.findMany();
    return new Map(rows.map((row) => [row.id, row.enabled]));
  }
}
