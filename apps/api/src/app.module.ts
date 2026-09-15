import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [AppController],
  providers: [AppService,
    {
      provide: APP_PIPE,
      useClass: ValidationPipe,
    }],
})
export class AppModule {}
