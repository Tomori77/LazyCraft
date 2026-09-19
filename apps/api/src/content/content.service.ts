import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  buildContentSnapshot,
  createCoreRegistry,
  type ContentSnapshot,
} from '@lazycraft/shared';

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
 */
@Injectable()
export class ContentService implements OnModuleInit {
  private readonly logger = new Logger(ContentService.name);
  private snapshot?: ContentSnapshot;

  onModuleInit(): void {
    this.init();
  }

  /** 只读快照：调用方不得修改，接口层直接序列化返回 */
  getSnapshot(): ContentSnapshot {
    // 懒兜底：脱离 Nest 生命周期直接 new 出来单测时也能拿到快照
    return (this.snapshot ??= this.init());
  }

  private init(): ContentSnapshot {
    const { registry, errors } = createCoreRegistry();
    if (errors.length > 0) {
      // 一次打印全部错误：DLC 作者改一轮就能修复，避免"启动-改一个-再启动"
      this.logger.error(`内容校验失败，共 ${errors.length} 项：`);
      for (const error of errors) this.logger.error(`  - ${error}`);
    }
    this.snapshot = buildContentSnapshot(registry);
    return this.snapshot;
  }
}
