import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller.js';

// 命名为 AppConfigModule 以区别于 @nestjs/config 的 ConfigModule，避免后续混用时歧义
@Module({
  controllers: [ConfigController],
})
export class AppConfigModule {}
