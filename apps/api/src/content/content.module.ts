import { Module } from '@nestjs/common';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';

/**
 * 内容模块：只暴露公开的 `/api/content`，不依赖存档 / 鉴权。
 *
 * 导出 ContentService 供 action 等模块复用同一份快照，
 * 保证"接口展示的内容"与"引擎能执行的内容"永不打架。
 */
@Module({
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
