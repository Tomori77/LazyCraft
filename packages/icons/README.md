# @lazycraft/icons

LazyCraft 图标库：本体手绘图标目录 + 渲染 + DLC 图标引用解析。

## 定位

- **本体与自带 DLC**：只用本库的手绘图标（`HAND_DRAWN_ICONS`），零外部依赖。
- **`game-icons.net` / `lucide`**：仅供 **DLC 引用** 的外部源。DLC 只登记
  「库名 + 图标名」，实际 path 在**构建期抽取内联**（运行时零请求、零依赖）。
- 许可：`game-icons.net` 为 CC BY 3.0（需署名）；`lucide` 为 ISC（免署名）。
  署名统一放在页脚/关于页，本库不内置外部素材。

## 与内容系统（`@lazycraft/shared`）的关系

图标也是"内容"：`ContentKind` 含 `'icon'`，本体 31 枚手绘由 CorePack
`registry.icon(...)` 登记，随 `GET /api/content` 的 `icons` 字段下发。

依赖方向固定为 **`shared` → `icons`**（`shared` 依赖本库取 `IconDef` 与
`HAND_DRAWN_ICONS`）；**本库保持零依赖**，可被前端 / DLC 独立使用。
`@lazycraft/shared` 顶层转出本库常用导出，消费端只装 shared 一个包也能用。

## 用法

```ts
import {
  findIcon, renderSprite, renderIconSvg, resolveIconRef, extractIcons,
} from '@lazycraft/icons';

findIcon('skill.mining');              // IconDef | undefined
renderSprite();                        // 本体全部图标 → 一个 <svg> sprite
renderIconSvg(findIcon('item.ore')!);  // 单个 <svg>

// DLC 登记（交给 Registry / 内容系统）
resolveIconRef({ name: 'skill.fletching', source: 'game-icons', iconName: 'wood-beam' }, externalTable);
```

## 外部图标抽取（构建期）

运行时零请求、零依赖，靠的是构建期把 DLC 用到的外部图标抽成内联 sprite。
本仓库**未安装** game-icons / lucide，也不为抽取引入运行时依赖，因此这里只实现
**契约 + 本地表 + sprite 产出 + 署名聚合**：

```ts
import { extractIcons, LOCAL_EXTERNAL_TABLE } from '@lazycraft/icons';

const refs = [
  { name: 'skill.fletching', source: 'game-icons', iconName: 'wood-beam' },
  { name: 'ui.alt-search', source: 'lucide', iconName: 'search' },
] as const;

const { sprite, icons, missing, attributions } = extractIcons(refs);
// sprite      → 统一 <svg> sprite 字符串（隐藏 svg + 全部 <symbol>）
// missing     → 未解析出的引用名，构建期应告警
// attributions→ 本次用到的外部源署名（game-icons CC BY 3.0 / lucide ISC）
```

- 抽取表 `LOCAL_EXTERNAL_TABLE`（`src/external/table.ts`）当前为**占位形状**，
  真实 path 需由构建期在装有对应库的 DLC 仓库抽取后替换（保持 key 不变）。
- 署名元数据在 `src/external/attribution.ts`（`EXTERNAL_ATTRIBUTIONS` /
  `attributionFor`），页脚/关于页直接消费。

## 命名规范

`<域>.<概念>`：`skill.*` / `item.*` / `slot.*` / `ui.*`。

## 修改图标

所有手绘图标集中在 `src/catalog.ts`。改一个图标的 `paths` 即可，
全站引用（左栏、工作卡片、背包格、装备槽…）自动更新。

## 画法约定

- 24×24 视口；描边 1.7、圆头圆角；`fill: true` 的路径用于填充/挖空。
- 颜色统一走 `currentColor`，尺寸由消费端 CSS 控制。
