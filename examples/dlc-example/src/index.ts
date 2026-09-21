/**
 * 示例 DLC 入口（可复制模板）。
 *
 * 入口导出契约（必须与 task-43 加载器逐字对齐）：
 *   1. **优先具名导出 `pack`**（`export const pack`）；兼容 `export default` 兜底。
 *   2. `pack.id` 必须等于 `manifest.json` 的 `id`，否则加载器以 `shape` 阶段失败。
 *   3. `id` / `name` / `version` 必须是非空字符串，`register` 必须是函数。
 *
 * 依赖解析：这里只用 `import type`（编译后被擦除），所以产物里没有裸包名，
 * 在本地 dev / 服务器 / e2e 三种挂载位置下都能被 `dynamic import`。
 * 若确实需要运行时值（如 `StopReason`），见 docs/DLC-开发规范.md 的依赖一节：
 * 生产镜像 `/app/node_modules/@lazycraft/shared` 会被 Node 向上查找命中。
 *
 * 安全边界：本文件是**在 API 进程内执行的任意 JS**。只有能写服务器挂载目录
 * （默认 `/app/dlc`，compose 里是 `:ro`）的运维能放它；后台没有上传/在线编辑入口。
 */

import type { ContentPack, Registry } from '@lazycraft/shared';
import { EXAMPLE_CONTENT } from './content.ts';
import { EXAMPLE_ICONS } from './icons.ts';

export const pack: ContentPack = {
  id: 'dlc_example',
  name: '示例采集包',
  version: '1.0.0',

  register(registry: Registry) {
    // 注册顺序无关：validate() 等全部包载入完成后才统一执行
    for (const skill of EXAMPLE_CONTENT.skills) registry.skill(skill);
    for (const item of EXAMPLE_CONTENT.items) registry.item(item);
    for (const action of EXAMPLE_CONTENT.actions) registry.action(action);
    for (const resource of EXAMPLE_CONTENT.abstractResources)
      registry.abstractResource(resource);
    for (const attribute of EXAMPLE_CONTENT.attributes)
      registry.attribute(attribute);
    for (const icon of EXAMPLE_ICONS) registry.icon(icon);
  },
};
