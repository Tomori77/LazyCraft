/**
 * 掉落模块总入口：把同目录下的子模块聚合导出，让上层（NestJS 服务 / 战斗回放工具）
 * 只需要一行 import。
 *
 * 为什么单建 index.ts 而不是让上层逐个 import 子文件？
 *   loot 模块内部文件多，未来拆"怪物掉落 / 宝箱掉落 / 任务奖励"时还要再加；
 *   上层只关心"掉落"这一个领域，给他们一个稳定入口能减少未来重构时的改动面。
 */

export * from './quality.js';
export * from './affix-pool.js';
export * from './equipment-template.js';
export * from './loot-table.js';
export * from './generate-equipment.js';
