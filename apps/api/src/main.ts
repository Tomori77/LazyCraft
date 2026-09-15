import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 开启全局验证管道：自动解析 DTO + class-validator 规则、转换类型、剥离未知字段
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
