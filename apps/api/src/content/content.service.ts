import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import {
  buildContentSnapshot,
  createCoreRegistry,
  type ContentSnapshot,
} from '@lazycraft/shared';
import { ContentPackStateService } from './content-pack-state.service.js';

/**
 * 内容服务：进程内持有唯一的内容快照。
 *
 * 为什么在 onModuleInit 里注册 + validate，而不是构造函数里？
 *   Nest 依赖图在构造完成后、init 阶段才稳定；把"启动自检"放到 onModuleInit
 *   既保证服务已注入完毕，又让校验失败能通过 Logger 落到启动日志。
 *   构造函数里做则会在 DI 半成品状态下执行，且异常栈更难读。
 *
 * 为什么快照只建一次？
 *   内容在进程生命周期内不可变（DLC 在启动期注册），每次请求重建纯属浪费；
 *   同时这也保证 `/api/content` 与 `action.start` 读的是同一份内存对象。
 *   后台启停 pack 因此**不改内存快照**，只写 DB，重启后才按新启用集合重建
 *   （task-41 已定决策：不做热重载）。
 */
@Injectable()
export class ContentService implements OnModuleInit {
  private readonly logger = new Logger(ContentService.name);
  private snapshot?: ContentSnapshot;

  constructor(
    // 可选注入：脱离 Nest 生命周期直接 new 出来单测/挂载精简模块时不带 DB 也能工作，
    // 此时退回"全部启用"（createCoreRegistry 省略参数语义）。
    @Optional() private readonly packState?: ContentPackStateService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.init();
  }

  /** 只读快照：调用方不得修改，接口层直接序列化返回 */
  getSnapshot(): ContentSnapshot {
    // 懒兜底：若 onModuleInit 尚未跑到（如精简挂载），用"全启用"同步建一份
    if (!this.snapshot) this.snapshot = this.build(undefined);
    return this.snapshot;
  }

  /**
   * 启动时按"持久化的启用集合"重建快照。
   *
   * 读开关失败（DB 抖动 / 表未迁移）不阻断启动：内容服务是核心读路径，
   * 不能因为一个后台状态表不可用就让整个 API 起不来；此时退回"全部启用"
   * 并告警，管理员可在日志里定位。
   */
  private async init(): Promise<ContentSnapshot> {
    let enabledIds: string[] | undefined;
    if (this.packState) {
      try {
        enabledIds = await this.packState.enabledPackIds();
      } catch (error) {
        this.logger.warn(
          `读取内容包启用状态失败，按"全部启用"启动：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    this.snapshot = this.build(enabledIds);
    return this.snapshot;
  }

  /** 注册（按启用集合）+ 校验 + 建快照；校验失败只打印不抛，保证服务可启动 */
  private build(enabledIds: string[] | undefined): ContentSnapshot {
    const { registry, errors } = createCoreRegistry(enabledIds);
    if (errors.length > 0) {
      // 一次打印全部错误：DLC 作者改一轮就能修复，避免"启动-改一个-再启动"
      const disabledHint =
        enabledIds === undefined
          ? ''
          : `（本次启用的 pack：${enabledIds.length > 0 ? enabledIds.join(', ') : '无'}；` +
            '若错误为"引用的内容未注册"，请检查是否停用了提供该内容的 pack）';
      this.logger.error(`内容校验失败，共 ${errors.length} 项：${disabledHint}`);
      for (const error of errors) this.logger.error(`  - ${error}`);
    }
    return buildContentSnapshot(registry);
  }
}
