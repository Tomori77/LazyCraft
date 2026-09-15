import { Controller, Get } from '@nestjs/common';

/**
 * 全局配置接口
 *
 * 前端启动时读取 defaultLanguage 作为初始语言；
 * 后续如需扩充（如赛季开关、维护公告），在此控制器追加字段即可。
 */
@Controller('api/config')
export class ConfigController {
  @Get()
  getConfig() {
    return { defaultLanguage: 'zh-CN' };
  }
}
