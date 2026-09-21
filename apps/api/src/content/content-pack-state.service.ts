import { Injectable } from '@nestjs/common';
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
 *
 * task-43 起本服务只提供"DB 里的原始事实"，不再自己与 pack 清单求交：
 *   可启停集合变成运行时的"内置 + 外部 DLC"，若这里再读静态清单过滤，
 *   外部 DLC 的停用会被静默丢掉。求交由持有目录/快照的 ContentService 做。
 */
@Injectable()
export class ContentPackStateService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 被 DB 显式停用的 pack id 集合（原始事实，不做任何清单过滤）。
   *
   * 为什么给"停用集合"而不是"启用集合"？
   *   缺行 = 启用，所以"启用集合"必须由一个可用 pack 清单反推；而本服务
   *   不知道运行时有哪些 pack（内置 + 外部 DLC 在 ContentService 手里）。
   *   返回停用集合后，ContentService 只需 `available.filter(不在停用集)`,
   *   既不需要反向注入，也不会漏掉任何外部 pack。
   */
  async disabledPackIds(): Promise<Set<string>> {
    const rows = await this.prisma.contentPackState.findMany();
    return new Set(rows.filter((row) => !row.enabled).map((row) => row.id));
  }

  /** 单个 pack 是否启用（缺行 = 启用） */
  async isEnabled(packId: string): Promise<boolean> {
    const row = await this.prisma.contentPackState.findUnique({
      where: { id: packId },
    });
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
