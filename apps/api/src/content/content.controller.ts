import { Controller, Get } from '@nestjs/common';
import { ContentService } from './content.service.js';

/**
 * 内容接口：公开、无需登录。
 *
 * 为什么公开？
 *   技能/动作/资源/槽位是"游戏说明书"，登录前的前端启动流程也要用它渲染；
 *   它不含任何玩家数据，鉴权在这里没有安全收益，只会让启动多一次往返。
 */
@Controller('api/content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Get()
  getContent() {
    return this.contentService.getSnapshot();
  }
}
