import { Injectable } from '@nestjs/common';
import { GAME_VERSION } from '@lazycraft/shared';

@Injectable()
export class AppService {
  getHello(): string {
    return 'LazyCraft API 运行中';
  }

  // 容器编排探活专用：只回答"进程是否活着"，刻意不碰 DB/Prisma——
  // 否则数据库抖动会让容器被判不健康并触发重启，反而放大故障。
  getHealth(): { status: string; uptime: number; version: string } {
    return { status: 'ok', uptime: Math.floor(process.uptime()), version: GAME_VERSION };
  }
}
