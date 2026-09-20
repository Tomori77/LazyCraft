import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ContentPackStateService } from './content-pack-state.service.js';

/**
 * 内容包启用状态模块（task-41）。
 *
 * 为什么标 @Global 而不让 ContentModule 直接 import？
 *   ContentService 在启动时需要读启用集合，但 ContentModule 被设计为
 *   **不依赖数据库**（内容接口公开、e2e 可脱离 PG 单独挂载）。
 *   若 ContentModule 直接 import 本模块，就会把 PrismaModule 拖进
 *   content.e2e 的依赖图，让"公开只读接口"的测试被远程库可用性牵连。
 *   标成 @Global 后：AppModule 里 import 一次，ContentService 即可注入；
 *   而只挂 ContentModule 的 e2e 里本模块不存在，ContentService 的
 *   @Optional 依赖落空并退回"全部启用"。
 *
 * AdminModule 仍显式 import 本模块：它本来就有 DB 依赖，显式声明比依赖
 * 全局可见性更易读。
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [ContentPackStateService],
  exports: [ContentPackStateService],
})
export class ContentPackStateModule {}
