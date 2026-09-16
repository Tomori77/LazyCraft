import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * POST /api/broadcasts/simulate 的请求体（开发期通路，详见 controller 注释）
 *
 * 为什么只收 monsterId 而不是更复杂的字段？
 *   战斗模块（task-18）尚未实现，当前"什么时候掉落、掉几件"还没有运行时规则；
 *   模拟通路只负责"roll 一次 + 触发阈值就写库"，参数越少越不容易与未来的
 *   真实战斗请求形状混淆。
 *
 * 为什么允许带 rngSequence？
 *   rollLoot 的随机性意味着"直到触发 epic"可能要循环几十次；测试里反复
 *   依赖 Math.random 会让用例时长不可控（30 次只有 ~12% 触发率）。
 *   调用方注入一段 0~1 的数列后，就能稳定走"选装备词条 + roll 出 epic"
 *   这条路径；生产前端不传时仍走 Math.random。
 *
 * ⚠️ 调用方必须 `import { SimulateDropDto }` 而不是 `import type` —
 *    class-validator 的装饰器只在运行时反射到真正的类对象时生效，
 *    用 `import type` 会被 TS 擦除、运行时拿不到 DTO 类，ValidationPipe 直接跳过校验。
 */
export class SimulateDropDto {
  @IsString({ message: 'monsterId 必须是字符串' })
  @IsNotEmpty({ message: 'monsterId 不能为空' })
  monsterId: string;

  /** 测试/演示注入的确定性随机数列：依次消费，耗尽后回落 Math.random */
  @IsOptional()
  @IsArray({ message: 'rngSequence 必须是数组' })
  @IsNumber({}, { each: true, message: 'rngSequence 元素必须是 0~1 的数字' })
  rngSequence?: number[];
}
