import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { SaveModule } from './save/save.module.js';
import { ActionModule } from './action/action.module.js';
import { LeaderboardModule } from './leaderboard/leaderboard.module.js';
import { AppConfigModule } from './config/config.module.js';
import { QuestModule } from './quest/quest.module.js';
import { BroadcastModule } from './broadcast/broadcast.module.js';
import { MarketModule } from './market/market.module.js';
import { CombatModule } from './combat/combat.module.js';
import { ContentModule } from './content/content.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { ShopModule } from './shop/shop.module.js';

@Module({
  imports: [AuthModule, SaveModule, ActionModule, LeaderboardModule, AppConfigModule, QuestModule, BroadcastModule, MarketModule, CombatModule, ContentModule, InventoryModule, ShopModule],
  controllers: [AppController],
  providers: [AppService,
    {
      provide: APP_PIPE,
      useClass: ValidationPipe,
    }],
})
export class AppModule {}
