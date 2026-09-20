/**
 * 本地外部图标表 —— 构建期抽取的"落点"。
 *
 * 为什么是"本地表"而不是 `import { icons } from 'game-icons'`？
 *   本仓库（按 docs/07 约定）不引入 game-icons / lucide 运行时或构建期依赖：
 *   本体只用内联手绘，外部库仅供 DLC 引用。真正需要的做法是——
 *   由 DLC 声明 `IconRef[]`，构建脚本在**安装了对应库的 DLC 仓库里**
 *   把用到的子集抽成 IconDef，写进这里（或作为入参传给抽取函数），
 *   本仓库只提供契约、解析与 sprite 产出。
 *
 * ⚠️ 当前表中的 path 是**占位形状**，用于打通契约与测试；
 *    真实素材需由构建期从已安装的库文件抽取后替换（见 README「外部图标抽取」）。
 *    不要把它们当成正式视觉资产发版。
 */

import type { ExternalIconTable } from '../resolve.js';
import type { SvgIconDef } from '../types.js';

const s = (d: string) => ({ d });

/**
 * 占位外部图标：命名与 resolve.ts 的 `externalKey` 对齐（`"<source>:<iconName>"`）。
 *
 * 这些 iconName 对应 DLC 已登记的引用示例（docs/07 里的 wood-beam / search）；
 * 替换成真实抽取结果时保持 key 不变，DLC 侧无需改动。
 */
export const LOCAL_EXTERNAL_TABLE: ExternalIconTable = {
  'game-icons:wood-beam': {
    name: 'game-icons:wood-beam',
    source: 'game-icons',
    paths: [s('M4 8h16v8H4z'), s('M8 8v8M16 8v8')],
  },
  'game-icons:pickaxe': {
    name: 'game-icons:pickaxe',
    source: 'game-icons',
    paths: [s('M4 8c5-2 11-2 16 0'), s('M12 7v13')],
  },
  'lucide:search': {
    name: 'lucide:search',
    source: 'lucide',
    paths: [s('M11 4a7 7 0 100 14 7 7 0 000-14z'), s('M16 16l4 4')],
  },
  'lucide:settings': {
    name: 'lucide:settings',
    source: 'lucide',
    paths: [s('M12 9a3 3 0 100 6 3 3 0 000-6z'), s('M12 3v2M12 19v2M3 12h2M19 12h2')],
  },
};

/** DLC 若要自带一张抽取表，可基于本地表覆盖/扩展 */
export function mergeExternalTables(
  ...tables: ReadonlyArray<ExternalIconTable | undefined>
): ExternalIconTable {
  const merged: Record<string, SvgIconDef> = {};
  for (const table of tables) {
    if (table) Object.assign(merged, table);
  }
  return merged;
}
