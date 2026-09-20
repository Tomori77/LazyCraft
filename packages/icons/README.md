# @lazycraft/icons

LazyCraft 图标库：多形态图标目录 + 渲染 + DLC 图标引用解析。

## 定位

- **本体与自带 DLC**：只用本库的手绘图标（`HAND_DRAWN_ICONS`），零外部依赖。
- **`game-icons.net` / `lucide`**：仅供 **DLC 引用** 的外部源。DLC 只登记
  「库名 + 图标名」，实际 path 在**构建期抽取内联**（运行时零请求、零依赖）。
- **`emoji` / `raster`**（task-35）：另外两种形态。emoji 零素材占位；
  位图存 `apps/web/public/icons/<name>.<ext>`，`url` 用 `/icons/xxx.webp` 相对路径。
- 许可：`game-icons.net` 为 CC BY 3.0（需署名）；`lucide` 为 ISC（免署名）；
  **位图必须有 `license`**（构建期校验，缺失即失败）。署名统一放在页脚/关于页，
  本库不内置外部素材。

## 多形态（task-35 / docs/06 §九）

`IconDef` 是判别联合，判别键为 `source`：

```ts
type IconDef =
  | { name; source: 'hand-drawn'; paths: IconPath[]; viewBox? }          // 矢量·手绘
  | { name; source: 'game-icons'|'lucide'; iconName: string }            // 矢量·外部库（构建期抽取）
  | { name; source: 'emoji'; char: string }                              // emoji 字符
  | { name; source: 'raster'; url: string; format: 'png'|'jpg'|'webp';
      license: { spdx; author?; source? } }                              // 位图（许可必填）
```

- **格式优先级**：svg 内联 > webp > png > emoji；jpg 不支持透明、慎用（仍支持）。
- **渲染**：`renderSprite` / `renderIconSymbol` **只处理矢量**（外部库解析后也归矢量）；
  `renderIconSvg` 对 emoji 产 `<text>`、对 raster 产 `<image>`；
  `renderIconHtml` 对 raster 产 `<img>`；`toIconRender` 返回与框架无关的**渲染描述**，
  前端据此在 JSX 里分别渲染 `<use>` / 文本 / `<img>`。
- **校验**：`validateIcons(icons)` 检查 raster 缺 `license`、emoji 缺 `char`、
  raster `url` 非 `/icons/` 前缀、`format` 与扩展名不符、重名、空 paths 等。
  `Registry.validate()` 复用同一套规则，构建期与启动期口径一致。
- **署名**：`extractIcons(...).materialAttributions` 按许可聚合位图素材署名
  （`aggregateMaterialAttributions`），与外部库署名（`attributions`）并列产出。
- **示例**：`FORMAT_DEMO_ICONS`（`src/formats.ts`，emoji ×2 + webp/png/jpg ×3），
  素材在 `apps/web/public/icons/`，均为项目自绘（`LicenseRef-LazyCraft`）。

## 与内容系统（`@lazycraft/shared`）的关系

图标也是"内容"：`ContentKind` 含 `'icon'`，本体 31 枚手绘由 CorePack
`registry.icon(...)` 登记，随 `GET /api/content` 的 `icons` 字段下发。

依赖方向固定为 **`shared` → `icons`**（`shared` 依赖本库取 `IconDef` 与
`HAND_DRAWN_ICONS`）；**本库保持零依赖**，可被前端 / DLC 独立使用。
`@lazycraft/shared` 顶层转出本库常用导出，消费端只装 shared 一个包也能用。

## 用法

```ts
import {
  findIcon, renderSprite, renderIconSvg, renderIconHtml, toIconRender,
  resolveIconRef, extractIcons, validateIcons,
} from '@lazycraft/icons';

findIcon('skill.mining');              // SvgIconDef | undefined
renderSprite();                        // 本体全部图标 → 一个 <svg> sprite（仅矢量）
renderIconSvg(findIcon('item.ore')!);  // 单个 <svg>
toIconRender(emojiIcon);               // { kind: 'emoji', char }
toIconRender(rasterIcon);              // { kind: 'raster', url, format }

// DLC 登记（交给 Registry / 内容系统）
resolveIconRef({ name: 'skill.fletching', source: 'game-icons', iconName: 'wood-beam' }, externalTable);
resolveIconRef({ name: 'item.gem', source: 'raster', url: '/icons/item.gem.webp',
  format: 'webp', license: { spdx: 'CC-BY-4.0', author: 'X' } });

validateIcons(icons);                  // { ok, errors }：raster 缺许可等构建期硬错误
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
- 署名元数据在 `src/external/attribution.ts`：外部库用 `EXTERNAL_ATTRIBUTIONS` /
  `attributionFor`；位图素材用 `aggregateMaterialAttributions`（按许可聚合），
  页脚/关于页直接消费。
- `extractIcons` 同时返回 `validation`（形态校验）与 `materialAttributions`（位图署名），
  构建脚本据此决定是否让构建失败。

## 命名规范

`<域>.<概念>`：`skill.*` / `item.*` / `slot.*` / `ui.*`。

## 修改图标

所有手绘图标集中在 `src/catalog.ts`。改一个图标的 `paths` 即可，
全站引用（左栏、工作卡片、背包格、装备槽…）自动更新。

## 画法约定

- 24×24 视口；描边 1.7、圆头圆角；`fill: true` 的路径用于填充/挖空。
- 颜色统一走 `currentColor`，尺寸由消费端 CSS 控制。
- emoji / 位图同样受消费端 `size` / CSS 约束；位图用 `object-fit: contain` 防溢出。
