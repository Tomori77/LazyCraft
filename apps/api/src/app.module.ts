import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { SaveModule } from './save/save.module.js';
import { AppConfigModule } from './config/config.module.js';

@Module({
  imports: [AuthModule, SaveModule, AppConfigModule],
  controllers: [AppController],
  providers: [AppService,
    {
      provide: APP_PIPE,
      useClass: ValidationPipe,
    }],
})
export class AppModule {}
