/**
 * 内容快照 —— `/api/content` 与 `action/start` 共用的唯一事实源。
 *
 * 为什么要造一个"快照"而不是让接口直接 import SKILLS/ACTIONS？
 *   引擎只认识 Registry 里注册过的内容；如果接口另读原始数组，
 *   一旦 DLC 通过 register 注入内容，前端能看到的和引擎能执行的就分叉了。
 *   快照以 Registry 为唯一写入源，原始数组只作为"注册素材"存在。
 *
 * 抽象资源 / 装备槽位已纳入 Registry（见 types.ts ContentKind），
 *   快照与 skills/actions/itemCatalog 同口径从 Registry 取，
 *   避免"常量表内容 ≠ 引擎认识的内容"这种分叉再次出现。
 * 图标（icons）同理：本体 31 枚手绘 + DLC 覆盖/新增都从图标桶取。
 */

import type {
  AbstractResource,
  AttributeDefinition,
  Content,
  ContentKind,
  EquipmentSlotMeta,
  IconDef,
  Item,
  Skill,
  SkillAction,
} from '../types.js';
import { CorePack } from '../packs/core/index.js';
import { ContentRegistry, createRegistry } from '../registry/index.js';

/** `/api/content` 的响应结构（也是前端内容 Provider 的契约） */
export interface ContentSnapshot {
  skills: readonly Skill[];
  actions: readonly SkillAction[];
  abstractResources: readonly AbstractResource[];
  equipmentSlots: readonly EquipmentSlotMeta[];
  itemCatalog: readonly Item[];
  /** 全部已注册图标（本体手绘 + DLC 登记），前端统一从此渲染 */
  icons: readonly IconDef[];
  /** 全部已注册人物属性元数据（task-34）：前端属性面板按 name_key/order 渲染 */
  attributes: readonly AttributeDefinition[];
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
function listOf<T extends Content>(registry: ContentRegistry, kind: ContentKind): T[] {
  return registry.list(kind) as T[];
}

/** 从 Registry 构造内容快照；纯函数，便于测试与后端复用 */
export function buildContentSnapshot(registry: ContentRegistry): ContentSnapshot {
  return {
    skills: listOf<Skill>(registry, 'skill'),
    actions: listOf<SkillAction>(registry, 'action'),
    abstractResources: listOf<AbstractResource>(registry, 'abstractResource'),
    equipmentSlots: listOf<EquipmentSlotMeta>(registry, 'slot'),
    itemCatalog: listOf<Item>(registry, 'item'),
    icons: listOf<IconDef>(registry, 'icon'),
    attributes: listOf<AttributeDefinition>(registry, 'attribute'),
  };
}

/** 便捷：注册核心包并直接产出快照（后端 / 单测的单行入口） */
export function buildCoreSnapshot(): ContentSnapshot {
  return buildContentSnapshot(createCoreRegistry().registry);
}
