import { Injectable } from '@nestjs/common';
import { BUILTIN_PACKS, type ContentPack } from '@lazycraft/shared';
import { DlcLoaderService, type DlcLoadError } from './dlc-loader.service.js';

/**
 * 运行时可启停 pack 目录（task-43）。
 *
 * 为什么要单开一个"目录"服务，而不是继续到处读 BUILTIN_PACKS？
 *   task-43 之前"全部 pack"是编译期常量，谁读都一致；之后它变成
 *   `BUILTIN_PACKS + 本次从挂载目录加载成功的外部 DLC`这一**运行时集合**，
 *   再让 content/admin 各自拼一遍，就会出现"某个请求看到外部包、另一个没看到"
 *   的分叉。把"当前可用集合"收敛到唯一持有者，是所有消费方读同一份事实的前提。
 *
 * 为什么不直接塞进 ContentService？
 *   ContentService 持有的是**不可变快照**，而本服务持有的是**可刷新的目录**
 *   （重扫挂载目录后可能变）；两者生命周期不同。分开后，
 *   ContentPackStateService 也不必反向注入 ContentService（避免循环依赖）——
 *   它只提供"DB 里被显式停用的 id"这类原始事实，由 ContentService 求交。
 *
 * 为什么外部 DLC 加载由 ContentService 触发的 refresh() 驱动，而不是本服务
 * 自己 onModuleInit？
 *   Nest 的模块 init 顺序不保证 ContentService 先于本服务；若本服务先扫、
 *   ContentService 后建快照，启动路径上会出现"目录已就绪但快照没吃到"的窗口。
 *   让 ContentService 在自己 init/reload 里显式 refresh()，时序就是确定的。
 */
@Injectable()
export class ContentPackDirectoryService {
  private externalPacks: readonly ContentPack[] = [];
  private loadErrors: readonly DlcLoadError[] = [];

  constructor(private readonly loader: DlcLoaderService) {}

  /** 重新扫描挂载目录并原子替换外部 DLC 快照；失败项只记录不抛 */
  async refresh(): Promise<void> {
    const { packs, errors } = await this.loader.load();
    this.externalPacks = packs;
    this.loadErrors = errors;
  }

  /** 当前全部可启停 pack = 内置 + 已加载成功的外部 DLC（内置在前，顺序稳定） */
  availablePacks(): readonly ContentPack[] {
    return [...BUILTIN_PACKS, ...this.externalPacks];
  }

  /** 按 id 查可用 pack（管理接口校验 id 存在性与展示 name/version 用） */
  find(id: string): ContentPack | undefined {
    return this.availablePacks().find((pack) => pack.id === id);
  }

  /** 最近一次 refresh 的加载失败列表（供管理接口只读暴露） */
  errors(): readonly DlcLoadError[] {
    return this.loadErrors;
  }

  /** 挂载目录绝对路径（错误诊断里给运维看"到底扫的是哪"） */
  dir(): string {
    return this.loader.dlcDir();
  }
}
