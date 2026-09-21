import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import {
  buildContentSnapshot,
  createCoreRegistry,
  type ContentSnapshot,
} from '@lazycraft/shared';
import { ContentPackStateService } from './content-pack-state.service.js';

/**
 * 重载结果：供管理接口如实报告"重载到了什么、有没有校验错误"。
 *
 * 为什么把 errors 一并返回而不是只记日志？
 *   校验失败**不阻断**重载（可诊断优先），但管理员必须能从响应/审计里看到
 *   "这次重载带着 N 项引用错误"，否则停用 pack 造成的内容缺失会被当成正常。
 */
export interface ContentReloadResult {
  /** 重建后的快照（已原子替换进 ContentService.snapshot） */
  snapshot: ContentSnapshot;
  /** 本次注册的 validate() 错误列表（为空 = 内容自洽） */
  errors: string[];
  /** 本次实际启用（注册进快照）的 pack id 集合，供审计与中断判定复用 */
  enabledPackIds: string[];
}

/**
 * 内容服务：进程内持有唯一的内容快照。
 *
 * 为什么在 onModuleInit 里注册 + validate，而不是构造函数里？
 *   Nest 依赖图在构造完成后、init 阶段才稳定；把"启动自检"放到 onModuleInit
 *   既保证服务已注入完毕，又让校验失败能通过 Logger 落到启动日志。
 *   构造函数里做则会在 DI 半成品状态下执行，且异常栈更难读。
 *
 * 为什么快照默认只建一次？
 *   内容在正常请求路径上不重建（每次请求重建纯属浪费），这也保证
 *   `/api/content` 与 `action.start` 读的是同一份内存对象。
 *   后台启停 pack **不自动换快照**：只有管理员显式调用 `reload()` 时，
 *   才按最新持久化启用集合重建并原子替换（task-42 已定决策）。
 *   这是"显式重载"而不是"热更新"——中间态绝不会被 getSnapshot() 观察到。
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
    if (!this.snapshot) this.snapshot = this.buildWithErrors(undefined).snapshot;
    return this.snapshot;
  }

  /**
   * 显式重载：按"最新持久化启用集合"重建快照并**原子替换**。
   *
   * 原子性：`buildWithErrors` 会先完整构造出新的 ContentSnapshot 对象
   * （注册 + validate + 各桶拷贝全部完成）后才返回，这里只做一次赋值，
   * 因此 getSnapshot() 永远只能看到旧快照或新快照，看不到半成品。
   *
   * 失败不阻断：读开关失败退回"全部启用"、validate 报错只如实返回错误数；
   * 重载本身必须成功返回，否则管理员改一个坏配置就会把内容服务卡住。
   */
  async reload(): Promise<ContentReloadResult> {
    const enabledIds = await this.readEnabledIds();
    const { snapshot, errors } = this.buildWithErrors(enabledIds);
    this.snapshot = snapshot;

    const enabled = snapshot.packs.map((pack) => pack.id);
    this.logger.log(
      `内容快照已重载：启用 pack [${enabled.length > 0 ? enabled.join(', ') : '无'}]，` +
        `校验错误 ${errors.length} 项`,
    );
    return { snapshot, errors, enabledPackIds: enabled };
  }

  /**
   * 启动时按"持久化的启用集合"重建快照。
   *
   * 读开关失败（DB 抖动 / 表未迁移）不阻断启动：内容服务是核心读路径，
   * 不能因为一个后台状态表不可用就让整个 API 起不来；此时退回"全部启用"
   * 并告警，管理员可在日志里定位。
   */
  private async init(): Promise<ContentSnapshot> {
    const enabledIds = await this.readEnabledIds();
    const { snapshot } = this.buildWithErrors(enabledIds);
    this.snapshot = snapshot;
    return snapshot;
  }

  /** 读持久化启用集合；无 packState（精简挂载）或读失败时返回 undefined（= 全启用） */
  private async readEnabledIds(): Promise<string[] | undefined> {
    if (!this.packState) return undefined;
    try {
      return await this.packState.enabledPackIds();
    } catch (error) {
      this.logger.warn(
        `读取内容包启用状态失败，按"全部启用"处理：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  /**
   * 注册（按启用集合）+ 校验 + 建快照；校验失败只打印不抛，保证服务可启动/可重载。
   * 返回 `{ snapshot, errors }` 而不是只返回快照：重载响应与审计需要如实的错误数。
   */
  private buildWithErrors(enabledIds: string[] | undefined): {
    snapshot: ContentSnapshot;
    errors: string[];
  } {
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
    return { snapshot: buildContentSnapshot(registry), errors };
  }
}
