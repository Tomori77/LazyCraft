/**
 * 内置内容包清单 —— "可启停 pack" 的唯一枚举源（task-41）。
 *
 * 为什么要把清单单独抽出来，而不是让 createCoreRegistry 直接写死 CorePack？
 *   管理后台要"列出全部已编译进来的 pack 及其启用状态"，就必须有一份
 *   "哪些 pack 是本体内置"的权威清单；否则前端只能靠猜，或者硬编码一份
 *   会和引擎分叉的 id 列表。清单放这里后，注册路径与管理路径读的是同一份数组。
 *
 * 为什么是数组常量而不是动态扫描目录？
 *   pack 是编译进产物的代码模块，打包后没有"目录"可扫；显式数组是唯一在
 *   运行时可枚举的形式（未来 DLC 包在构建期加入此数组即可被后台识别）。
 */

import type { ContentPack } from '../types.js';
import { CorePack } from './core/index.js';

/** 全部内置 pack：当前仅核心包。新增 DLC 包时在此追加即可被后台列出并启停 */
export const BUILTIN_PACKS: readonly ContentPack[] = [CorePack];

/**
 * 按启用集合过滤 pack 清单。
 *
 * `enabledIds` 省略 = 全部启用（向后兼容既有调用点）；
 * 空数组 = 一个都不启用（合法输入，用于测试/极端配置）。
 * 纯函数，便于直接用合成 pack 单测过滤语义。
 */
export function selectEnabledPacks(
  packs: readonly ContentPack[],
  enabledIds?: readonly string[],
): readonly ContentPack[] {
  if (enabledIds === undefined) return packs;
  return packs.filter((pack) => enabledIds.includes(pack.id));
}
