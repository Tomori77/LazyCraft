/** 游戏数据版本号：前后端共用，用于判断存档结构是否需要迁移 */
export const GAME_VERSION = '0.1.0';

// 挂机/离线结算核心：整个项目的灵魂（task-06）
export * from './idle/index.js';
