/** 游戏数据版本号：前后端共用，用于判断存档结构是否需要迁移 */
export const GAME_VERSION = '0.1.0';

// 挂机/离线结算核心：整个项目的灵魂（task-06）
export * from './idle/index.js';

// 内容数据表（task-07 资源/技能，task-08 动作）：引擎不识别业务，业务全在这里
export * from './data/resources.js';
export * from './data/skills.js';
export * from './data/actions.js';

// 技能规则：经验 ↔ 等级查询（task-07）
export * from './skill/skill-service.js';

// 内容注册表 + 内置核心包（task-09）：DLC 接入的注册通路
export * from './registry/index.js';
export * from './packs/core/index.js';

// 掉落 / 词缀 / 装备生成（task-14）：刷宝系统的数据与计算
export * from './loot/index.js';

// 共享核心类型契约（types.ts 是单一事实源）
export * from './types.js';
