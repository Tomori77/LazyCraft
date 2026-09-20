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
import { BUILTIN_PACKS, selectEnabledPacks } from '../packs/index.js';
import { ContentRegistry, createRegistry } from '../registry/index.js';

/** 快照里的单个 pack 元信息（前端「内容」页据此展示启用开关） */
export interface PackInfo {
  id: string;
  name: string;
  version: string;
  /** 是否已注册。快照只登记"实际启用"的包，故构建时恒为 true；保留字段供前端做乐观态 */
  enabled: boolean;
}

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
  /** 本次快照实际启用的 pack 列表（task-41）：证明"内容缺失 = 某包被停用" */
  packs: readonly PackInfo[];
}

/**
 * 注册内置内容包并做一次一致性校验。
 *
 * 为什么返回值里带 validate 结果而不是在这里抛？
 *   调用时机不同（后端启动 / 测试 / 前端只读），抛错策略应归调用方；
 *   这里只负责"注册 + 如实报告"。
 *
 * 启用集合（task-41）：
 *   传 `enabledIds` 时只注册 `BUILTIN_PACKS` 中命中的包；
 *   **省略参数 = 全部启用**（保持既有调用点行为不变，向后兼容）。
 *   空数组 `[]` 是合法输入，表示一个包都不启用（用于测试/极端配置）。
 */
export function createCoreRegistry(enabledIds?: readonly string[]): {
  registry: ContentRegistry;
  errors: string[];
} {
  const registry = createRegistry();
  for (const pack of selectEnabledPacks(BUILTIN_PACKS, enabledIds)) registry.register(pack);
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
    // pack 元信息从"实际注册结果"反查清单，而不是另传一份启用集合：
    // 这样快照永远与 Registry 真实内容一致，不会出现"说启用了但没注册"的分叉。
    packs: registeredPackInfos(registry),
  };
}

/**
 * 实际注册进 Registry 的 pack 元信息（含 name/version，来自内置清单）。
 *
 * 为什么不在快照里列出"未启用的包"？
 *   快照的语义是"引擎此刻认识的内容"，未启用的包不属于此列；
 *   后台「内容」页要的完整清单 + 启停状态由管理 API 单独提供（它读 DB 状态）。
 */
function registeredPackInfos(registry: ContentRegistry): PackInfo[] {
  const registeredIds = new Set(
    registry.listPacks().map((entry) => entry.split('@')[0]),
  );
  return BUILTIN_PACKS.filter((pack) => registeredIds.has(pack.id)).map((pack) => ({
    id: pack.id,
    name: pack.name,
    version: pack.version,
    enabled: true,
  }));
}

/** 便捷：注册核心包并直接产出快照（后端 / 单测的单行入口） */
export function buildCoreSnapshot(): ContentSnapshot {
  return buildContentSnapshot(createCoreRegistry().registry);
}
