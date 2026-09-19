/**
 * 内容快照 —— `/api/content` 与 `action/start` 共用的唯一事实源。
 *
 * 为什么要造一个"快照"而不是让接口直接 import SKILLS/ACTIONS？
 *   引擎只认识 Registry 里注册过的内容；如果接口另读原始数组，
 *   一旦 DLC 通过 register 注入内容，前端能看到的和引擎能执行的就分叉了。
 *   快照以 Registry 为唯一写入源，原始数组只作为"注册素材"存在。
 *
 * 抽象资源 / 装备槽位的取舍：
 *   Registry 的 ContentKind 目前只覆盖 skill/action/item/enemy（见 types.ts），
 *   抽象资源与槽位不是可注册内容。硬塞进 Registry 需要改 ContentKind 联合类型
 *   并扩 validate，超出本任务范围；这里直接从常量表取，并在类型上保持只读，
 *   待 DLC 真的需要注册资源/槽位时再扩 Registry。
 */

import type {
  AbstractResource,
  Content,
  Item,
  Skill,
  SkillAction,
} from '../types.js';
import type { EquipmentSlotMeta } from '../loot/equipment-template.js';
import { EQUIPMENT_SLOTS } from '../loot/equipment-template.js';
import { ABSTRACT_RESOURCES } from '../data/resources.js';
import { CorePack } from '../packs/core/index.js';
import { ContentRegistry, createRegistry } from '../registry/index.js';

/** `/api/content` 的响应结构（也是前端内容 Provider 的契约） */
export interface ContentSnapshot {
  skills: readonly Skill[];
  actions: readonly SkillAction[];
  abstractResources: readonly AbstractResource[];
  equipmentSlots: readonly EquipmentSlotMeta[];
  itemCatalog: readonly Item[];
}

/**
 * 注册内置核心包并做一次一致性校验。
 *
 * 为什么返回值里带 validate 结果而不是在这里抛？
 *   调用时机不同（后端启动 / 测试 / 前端只读），抛错策略应归调用方；
 *   这里只负责"注册 + 如实报告"。
 */
export function createCoreRegistry(): { registry: ContentRegistry; errors: string[] } {
  const registry = createRegistry();
  registry.register(CorePack);
  const result = registry.validate();
  return { registry, errors: result.errors };
}

/** 按类别取已注册内容，收敛掉 Registry.list() 的联合类型收窄 */
function listOf<T extends Content>(registry: ContentRegistry, kind: 'skill' | 'action' | 'item'): T[] {
  return registry.list(kind) as T[];
}

/** 从 Registry 构造内容快照；纯函数，便于测试与后端复用 */
export function buildContentSnapshot(registry: ContentRegistry): ContentSnapshot {
  return {
    skills: listOf<Skill>(registry, 'skill'),
    actions: listOf<SkillAction>(registry, 'action'),
    abstractResources: ABSTRACT_RESOURCES,
    equipmentSlots: EQUIPMENT_SLOTS,
    itemCatalog: listOf<Item>(registry, 'item'),
  };
}

/** 便捷：注册核心包并直接产出快照（后端 / 单测的单行入口） */
export function buildCoreSnapshot(): ContentSnapshot {
  return buildContentSnapshot(createCoreRegistry().registry);
}
