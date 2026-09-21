import { Module } from '@nestjs/common';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';
import { ContentPackDirectoryService } from './content-pack-directory.service.js';
import { DlcLoaderService } from './dlc-loader.service.js';

/**
 * 内容模块：只暴露公开的 `/api/content`，不依赖存档 / 鉴权。
 *
 * 导出 ContentService 供 action 等模块复用同一份快照，
 * 保证"接口展示的内容"与"引擎能执行的内容"完全一致。
 *
 * task-43：外部 DLC 加载器与"运行时可启停 pack 目录"随本模块提供。
 *   两者无 DB 依赖（只读文件系统），不破坏 ContentModule"可脱离 PG 单独挂载"
 *   的设计——content.e2e 挂本模块时不会被动拉起 Prisma。
 *   ContentPackStateService 仍是 @Optional 注入（由 @Global 的
 *   ContentPackStateModule 在 AppModule 提供），保持既有 e2e 语义。
 */
@Module({
  controllers: [ContentController],
  providers: [ContentService, ContentPackDirectoryService, DlcLoaderService],
  exports: [ContentService, ContentPackDirectoryService, DlcLoaderService],
})
export class ContentModule {}
