/** 游戏数据版本号：前后端共用，用于判断存档结构是否需要迁移 */
export const GAME_VERSION = '0.1.0';

// 挂机/离线结算核心：整个项目的灵魂（task-06）
export * from './idle/index.js';

// 内容数据表（task-07）：引擎不识别业务，业务全在这里
export * from './data/resources.js';
export * from './data/skills.js';

// 技能规则：经验 ↔ 等级查询（task-07）
export * from './skill/skill-service.js';
