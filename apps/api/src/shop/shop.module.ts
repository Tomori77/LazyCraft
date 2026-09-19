import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SaveModule } from '../save/save.module.js';
import { ShopController } from './shop.controller.js';
import { ShopService } from './shop.service.js';

/**
 * 商店模块（task-24）
 *
 * 与市场模块互不影响：import AuthModule + SaveModule 即可，
 * 金币走 abstract_resources.gold，不 import market 模块。
 */
@Module({
  imports: [AuthModule, SaveModule],
  controllers: [ShopController],
  providers: [ShopService],
})
export class ShopModule {}
