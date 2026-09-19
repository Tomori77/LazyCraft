# @lazycraft/icons

LazyCraft 图标库：本体手绘图标目录 + 渲染 + DLC 图标引用解析。

## 定位

- **本体与自带 DLC**：只用本库的手绘图标（`HAND_DRAWN_ICONS`），零外部依赖。
- **`game-icons.net` / `lucide`**：仅供 **DLC 引用** 的外部源。DLC 只登记
  「库名 + 图标名」，实际 path 在**构建期抽取内联**（运行时零请求、零依赖）。
- 许可：`game-icons.net` 为 CC BY 3.0（需署名）；`lucide` 为 ISC（免署名）。
  署名统一放在页脚/关于页，本库不内置外部素材。

## 用法

```ts
import {
  findIcon, renderSprite, renderIconSvg, resolveIconRef,
} from '@lazycraft/icons';

findIcon('skill.mining');              // IconDef | undefined
renderSprite();                        // 本体全部图标 → 一个 <svg> sprite
renderIconSvg(findIcon('item.ore')!);  // 单个 <svg>

// DLC 登记（交给 Registry / 内容系统）
resolveIconRef({ name: 'skill.fletching', source: 'game-icons', iconName: 'wood-beam' }, externalTable);
```

## 命名规范

`<域>.<概念>`：`skill.*` / `item.*` / `slot.*` / `ui.*`。

## 修改图标

所有手绘图标集中在 `src/catalog.ts`。改一个图标的 `paths` 即可，
全站引用（左栏、工作卡片、背包格、装备槽…）自动更新。

## 画法约定

- 24×24 视口；描边 1.7、圆头圆角；`fill: true` 的路径用于填充/挖空。
- 颜色统一走 `currentColor`，尺寸由消费端 CSS 控制。
