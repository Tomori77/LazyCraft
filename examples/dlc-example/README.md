# 示例 DLC（dlc-example）

一个**可复制、可跑通**的最小 LazyCraft 内容包：1 个技能 + 2 个物品 + 2 个动作
+ 1 个抽象资源 + 1 个人物属性 + 三形态图标（手绘 / emoji / 位图）。

规范全文见 `docs/DLC-开发规范.md`；本文只讲"照着怎么用"。

## 目录里有什么

```
examples/dlc-example/
├── manifest.json          # 包元信息（id/name/version/entry + 署名类可选字段）
├── package.json           # 仅声明 "type": "module"（非 workspace 成员）
├── src/
│   ├── index.ts           # 入口：导出 pack，register() 逐条登记内容
│   ├── content.ts         # 内容数据（技能/物品/动作/抽象资源/属性）
│   └── icons.ts           # 三形态图标示例
└── assets/
    └── dlc_example_essence.png   # 位图素材（随包发布，构建时复制到产物）
```

## 三步跑通

```bash
# 1. 构建：TS 源码 → 挂载目录形态的产物（默认输出 ./dlc/<pack-id>/）
node scripts/build-dlc.mjs

# 2. 校验：manifest/入口/导出契约/引用一致性/素材路径
node scripts/validate-dlc.mjs

# 3. 生效：产物已在 ./dlc/dlc_example/，管理后台「内容」页点「应用重载」
#    （本地无 API 时，把 DLC_DIR 指到 ./dlc 再启 API 也能看到）
```

`build-dlc.mjs` 产物布局（与 task-43 加载器约定一致）：

```
dlc/dlc_example/
├── manifest.json   # entry 已被改写为产物入口（index.js）
├── index.js        # 单文件 ESM 入口（esbuild 打包，无相对 import）
├── package.json    # {"type":"module"}，让 Node 稳定按 ESM 加载
└── assets/         # 随包静态资源
```

## 复制成一个新 DLC 要改什么

1. **新建目录**（建议在 `examples/` 外，如自己的 `my-dlc/`），整体拷贝本目录。
2. **`manifest.json`**：
   - 改 `id`（必须是唯一包 id，建议带自己的前缀，如 `mypack_`）；
   - 改 `name` / `version` / `author` / `license` / `description`；
   - `entry` 指向自己的入口源文件。
3. **`src/content.ts`**：把所有 id 换成自己的（**全部 id 都带同一前缀**，避免跨包撞名），
   调整数值。新增内容时记住引用必须自洽（见规范里的 validate() 自检清单）。
4. **`src/icons.ts`**：按需保留/替换三形态示例。
5. **`src/index.ts`**：把 `pack.id` 改成和 `manifest.id` **完全一致**（否则加载器
   以 `shape` 阶段失败）。

> 不想用模板？最小 DLC 只需要两个字面文件：`manifest.json` +
> 入口 `index.js`（`export const pack = { id, name, version, register }`）。

## 依赖怎么引

入口只做**类型导入**：`import type { ContentPack, Registry } from '@lazycraft/shared'`。
类型导入编译后被擦除，产物里没有裸包名，所以在本地 dev / 生产镜像 / e2e 三种
挂载位置下都能被加载。

若确实需要**运行时值**（例如 `StopReason` 枚举），可以用裸包名
`@lazycraft/shared`：生产镜像里它在 `/app/node_modules/@lazycraft/shared`，
而 DLC 位于 `/app/dlc/<pack-id>/`，Node 向上查找能命中。
`build-dlc.mjs` 会把 `@lazycraft/*` 保持为 external，不会把 shared 打进 DLC。

## 图标三形态（`src/icons.ts`）

| 形态 | 写法 | 适用 |
|---|---|---|
| 手绘 SVG | `source: 'hand-drawn'` + 内联 `paths` | 推荐：零素材、可换色 |
| emoji | `source: 'emoji'` + `char` | 原型期占位，零素材 |
| 位图 | `source: 'raster'` + `url`/`format`/`license` | 有正式美术时；**license 必填** |

图标名要命中前端派生名（技能 `skill.<id>`、物品 `item.<id>`），前端才会自动用上；
否则回退首字母，不报错。

> **位图的已知局限**：`/icons/` 前缀当前由 nginx 从**前端产物**
> （`apps/web/public/icons/`）同源托管。DLC 位图要真正渲染，除了随包放
> `assets/`，还需把素材同步到 `apps/web/public/icons/` 并重建前端。
> 详见 `docs/DLC-开发规范.md`「图标与素材」。

## 安全边界

DLC 是**在 API 进程内执行的任意 JS**。只有能写服务器挂载目录（默认 `/app/dlc`，
compose 里是 `:ro`）的运维能放它；管理后台**没有**上传 / 在线编辑 DLC 的入口。
不要把不可信来源的 JS 放进挂载目录。
