#!/usr/bin/env node
/**
 * DLC 校验脚本（task-44）。
 *
 * 定位：构建脚本（build-dlc.mjs）的"下线前体检"，也是坏 DLC 的本地复现工具。
 * 它刻意**复用 task-43 加载器的判定口径**，而不是自造一套：
 *   1. manifest 形状 —— 与 `DlcLoaderService.readManifest` 同一组必填字段；
 *   2. 入口可导入 —— 与加载器同款 `pathToFileURL` + `?v=` cache-busting import；
 *   3. 导出契约 —— 优先具名 `pack`、兜底 `default`，id/name/version 非空 + register 函数，
 *      且 `pack.id === manifest.id`；
 *   4. 整包试注册 —— `createRegistry()` + `register(pack)` + `validate()`（含内置包），
 *      做引用完整性检查（action.skill_id / input_items / output_items / item.source_skill /
 *      slot.order 唯一 / attribute 规则 / 图标多形态）；
 *   5. 产物与资源路径存在性 —— entry 文件、raster 图标的素材文件。
 * 失败信息按加载器的 5 个 stage（scan/manifest/import/shape/conflict）打标，
 * 让"脚本报的错"能直接对上台「内容」页里显示的阶段。
 *
 * 为什么校验脚本要能把裸包名 `@lazycraft/shared` 解析到本仓库产物？
 *   DLC 入口若用了运行时值（非类型导入），本地挂载目录未必能向上找到宿主
 *   node_modules（只有生产镜像 /app 才行）。校验脚本用 module.registerHooks 把
 *   这两个包名别名到仓库构建产物，使"本地能校验 = 线上能加载"，同时不改变
 *   DLC 自己的解析行为（别名只在本脚本进程内生效）。
 *
 * 用法：
 *   node scripts/validate-dlc.mjs [dlcDir]
 *     缺省校验 examples/dlc-example；
 *     传"单个 DLC 目录"（内有 manifest.json）→ 只校验它；
 *     传"挂载根目录"（子目录才是 DLC）→ 校验全部子目录并汇总。
 *   退出码：0 = 全部通过；1 = 至少一项失败（可直接用于 CI / 运维脚本）。
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import module from 'node:module';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const SHARED_DIST = join(REPO_ROOT, 'packages/shared/dist/index.js');
const ICONS_DIST = join(REPO_ROOT, 'packages/icons/dist/index.js');
const WEB_ICONS_DIR = join(REPO_ROOT, 'apps/web/public/icons');

/* ------------------------------------------------------------------ */
/* 依赖别名：让校验进程内可解析裸包名                                    */
/* ------------------------------------------------------------------ */

/**
 * 把两个 workspace 包名指向本仓库的构建产物。
 * 为什么不用 import map / NODE_PATH？它们对 ESM 无效；registerHooks 是
 * Node 22.15+/24 提供的同步解析钩子，正好覆盖"脚本内 dynamic import"的场景。
 */
function installWorkspaceAliases() {
  if (typeof module.registerHooks !== 'function') return false;
  const aliases = {
    '@lazycraft/shared': pathToFileURL(SHARED_DIST).href,
    '@lazycraft/icons': pathToFileURL(ICONS_DIST).href,
  };
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      const mapped = aliases[specifier];
      if (mapped) return { url: mapped, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* 校验结果收集                                                          */
/* ------------------------------------------------------------------ */

class Report {
  constructor(dlcDir) {
    this.dlcDir = dlcDir;
    this.errors = [];
    this.warnings = [];
  }

  error(stage, message) {
    this.errors.push({ stage, message });
  }

  warn(message) {
    this.warnings.push(message);
  }

  get ok() {
    return this.errors.length === 0;
  }
}

/* ------------------------------------------------------------------ */
/* 与加载器同口径的纯函数                                                */
/* ------------------------------------------------------------------ */

/** 从模块命名空间取 ContentPack 候选：优先具名 pack，兜底 default（对齐 extractPack） */
function extractPack(namespace) {
  if (typeof namespace !== 'object' || namespace === null) return undefined;
  return namespace.pack ?? namespace.default;
}

/** 校验 ContentPack 形状（对齐 isContentPack） */
function isContentPack(value) {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    typeof value.register === 'function'
  );
}

const messageOf = (error) =>
  error instanceof Error ? error.message : String(error);

/* ------------------------------------------------------------------ */
/* 单个 DLC 的校验流水线                                                 */
/* ------------------------------------------------------------------ */

async function checkDlc(dlcDir, shared) {
  const report = new Report(dlcDir);

  /* --- manifest ---------------------------------------------------- */
  const manifestPath = join(dlcDir, 'manifest.json');
  let raw;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (error) {
    report.error('manifest', `缺少或无法读取 manifest.json（${messageOf(error)}）`);
    return report;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    report.error('manifest', `manifest.json 不是合法 JSON：${messageOf(error)}`);
    return report;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    report.error('manifest', 'manifest.json 顶层必须是对象');
    return report;
  }

  const missing = ['id', 'name', 'version', 'entry'].filter(
    (key) => typeof parsed[key] !== 'string' || parsed[key].length === 0,
  );
  if (missing.length > 0) {
    report.error(
      'manifest',
      `manifest.json 缺少非空字符串字段：${missing.join(', ')}`,
    );
    return report;
  }
  const manifest = parsed;

  // 推荐字段缺失只告警：运行时加载器不读它们，但发布规范要求可追溯
  for (const key of ['author', 'license', 'description']) {
    if (typeof manifest[key] !== 'string' || manifest[key].length === 0) {
      report.warn(`manifest.json 建议补上 "${key}"（署名/许可/说明可追溯）`);
    }
  }

  // 依赖的最低游戏版本：仅当 DLC 要求高于本体时才提示（不影响加载，影响预期）
  if (
    typeof manifest.min_game_version === 'string' &&
    manifest.min_game_version.length > 0 &&
    shared.GAME_VERSION !== undefined &&
    compareVersions(manifest.min_game_version, shared.GAME_VERSION) > 0
  ) {
    report.warn(
      `manifest.min_game_version=${manifest.min_game_version} 高于本体 ` +
        `GAME_VERSION=${shared.GAME_VERSION}，DLC 可能依赖本体尚未提供的能力`,
    );
  }

  // id 冲突（对齐加载器的 conflict 阶段：内置包优先，外部包之间先到先得）
  const builtinIds = new Set(shared.BUILTIN_PACKS.map((pack) => pack.id));
  if (builtinIds.has(manifest.id)) {
    report.error('conflict', `pack id "${manifest.id}" 已被内置包占用`);
    return report;
  }

  /* --- entry 存在性（import 阶段的前置） ---------------------------- */
  const entryPath = join(dlcDir, manifest.entry);
  const entryStat = await stat(entryPath).catch(() => null);
  if (!entryStat?.isFile()) {
    report.error(
      'import',
      `入口文件不存在或不是文件：${manifest.entry}（解析为 ${entryPath}）`,
    );
    return report;
  }

  /* --- 动态 import（与加载器同款 cache-busting specifier） ---------- */
  let namespace;
  try {
    const token = `${Math.trunc(entryStat.mtimeMs)}-${entryStat.size}`;
    namespace = await import(`${pathToFileURL(entryPath).href}?v=${token}`);
  } catch (error) {
    report.error('import', `入口 import 失败：${messageOf(error)}`);
    return report;
  }

  const candidate = extractPack(namespace);
  if (!isContentPack(candidate)) {
    report.error(
      'shape',
      '入口未导出合法 ContentPack（要求具名导出 pack 或 default，含非空 id/name/version 与 register 函数）',
    );
    return report;
  }
  if (candidate.id !== manifest.id) {
    report.error(
      'shape',
      `manifest.id "${manifest.id}" 与入口导出 pack.id "${candidate.id}" 不一致`,
    );
    return report;
  }

  /* --- 整包试注册 + 引用一致性（含内置包，模拟运行时注册集合） ------- */
  const registry = shared.createRegistry();
  for (const pack of shared.BUILTIN_PACKS) registry.register(pack);
  try {
    registry.register(candidate);
  } catch (error) {
    report.error('shape', `register() 执行时抛异常：${messageOf(error)}`);
    return report;
  }

  const validation = registry.validate();
  if (!validation.ok) {
    for (const message of validation.errors) report.error('shape', message);
  }

  /* --- 产物与资源路径存在性 ---------------------------------------- */
  checkRasterAssets(dlcDir, registry, report);

  return report;
}

/**
 * 检查本包登记的 raster 图标是否有对应素材文件。
 *
 * 两个可能位置：
 *   - DLC 自带：`<dlcDir>/assets/<文件名>`（build-dlc 会整目录复制过来）；
 *   - 本体前端产物：`apps/web/public/icons/<文件名>`（`/icons/` 的同源托管根）。
 * 两处都没有才报错——否则会给"素材随前端发布"的合法形态制造假阳性。
 */
function checkRasterAssets(dlcDir, registry, report) {
  const rasterIcons = registry
    .list('icon')
    .filter((icon) => icon.source === 'raster');
  for (const icon of rasterIcons) {
    const fileName = icon.url.split('/').pop();
    if (fileName === undefined || fileName.length === 0) {
      report.error('shape', `[icon:${icon.name}] raster url 缺少文件名：${icon.url}`);
      continue;
    }
    const inDlc = join(dlcDir, 'assets', fileName);
    const inWeb = join(WEB_ICONS_DIR, fileName);
    if (!existsSync(inDlc) && !existsSync(inWeb)) {
      report.error(
        'shape',
        `[icon:${icon.name}] raster 素材缺失：${fileName} ` +
          `（既不在 ${relative(REPO_ROOT, inDlc)}，也不在 ${relative(REPO_ROOT, inWeb)}）`,
      );
    }
  }
}

/** 简单的 x.y.z 比较；用于 min_game_version 提示（非严格 semver） */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* 目录发现：单 DLC 目录 vs 挂载根目录                                   */
/* ------------------------------------------------------------------ */

async function discoverDlcDirs(target) {
  const targetStat = await stat(target).catch(() => null);
  if (!targetStat?.isDirectory()) {
    return { dirs: [], missing: `目录不存在或不是目录：${target}` };
  }
  // 目标自身就是 DLC（有 manifest.json）：单包模式
  if (existsSync(join(target, 'manifest.json'))) {
    return { dirs: [target], missing: null };
  }
  // 否则当挂载根：只把"含 manifest.json 的子目录"视为 DLC
  const entries = await readdir(target, { withFileTypes: true });
  const dirs = [];
  const skipped = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(target, entry.name);
    if (existsSync(join(dir, 'manifest.json'))) dirs.push(dir);
    else skipped.push(entry.name);
  }
  return { dirs: dirs.sort(), missing: null, skipped };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const arg = process.argv[2];
  if (arg === '-h' || arg === '--help') {
    console.log(
      '用法：node scripts/validate-dlc.mjs [dlcDir]\n' +
        '  dlcDir  默认 examples/dlc-example\n' +
        '          传单个 DLC 目录（内有 manifest.json）只校验它；\n' +
        '          传挂载根目录（含多个 DLC 子目录）则全部校验并汇总。',
    );
    return 0;
  }

  // 相对路径按仓库根解析（`node scripts/...` 的既有约定）；绝对路径原样使用，
  // 便于对临时目录 / 服务器上的真实挂载点做校验。
  const raw = arg ?? 'examples/dlc-example';
  const target = isAbsolute(raw) ? raw : join(REPO_ROOT, raw);
  const rel = (p) => {
    const r = relative(REPO_ROOT, p).replace(/\\/g, '/');
    // 目标在仓库外时 relative() 会带一堆 ..，直接显示绝对路径更可读
    return r.startsWith('..') ? p.replace(/\\/g, '/') : r || '.';
  };

  const aliased = installWorkspaceAliases();
  if (!aliased) {
    console.warn(
      '[validate-dlc] 警告：当前 Node 不支持 module.registerHooks，' +
        '使用裸包名（@lazycraft/*）的 DLC 可能在此脚本内解析失败。',
    );
  }

  let shared;
  try {
    shared = await import(pathToFileURL(SHARED_DIST).href);
  } catch (error) {
    console.error(
      `[validate-dlc] 无法加载 packages/shared 构建产物：${messageOf(error)}\n` +
        '  请先在仓库根执行 `pnpm --filter @lazycraft/shared build`。',
    );
    return 1;
  }
  if (typeof shared.createRegistry !== 'function') {
    console.error('[validate-dlc] packages/shared 产物缺少 createRegistry()，请重新构建。');
    return 1;
  }

  const { dirs, missing, skipped = [] } = await discoverDlcDirs(target);
  if (missing !== null) {
    // scan 阶段：目标本身不可读（与加载器"目录不存在不算错"不同——校验脚本的
    // 目标是用户显式指定的，找不到就是用法错误，必须报出来）
    console.error(`[validate-dlc] [scan] ${missing}`);
    return 1;
  }

  if (dirs.length === 0) {
    console.log(
      `[validate-dlc] ${rel(target)} 下没有找到含 manifest.json 的 DLC 子目录` +
        (skipped.length > 0 ? `（已跳过：${skipped.join(', ')}）` : ''),
    );
    return 0;
  }

  let failed = 0;
  let errorCount = 0;
  let warningCount = 0;

  for (const dir of dirs) {
    const report = await checkDlc(dir, shared);
    const label = rel(dir);
    errorCount += report.errors.length;
    warningCount += report.warnings.length;
    if (report.ok) {
      console.log(`✓ ${label} 通过校验`);
    } else {
      failed += 1;
      console.error(`✗ ${label} 校验失败（${report.errors.length} 项）：`);
      for (const { stage, message } of report.errors) {
        console.error(`    [${stage}] ${message}`);
      }
    }
    for (const message of report.warnings) {
      console.warn(`    ! ${label}：${message}`);
    }
  }

  const summary =
    `[validate-dlc] 共 ${dirs.length} 个 DLC：` +
    `${dirs.length - failed} 通过 / ${failed} 失败` +
    `（错误 ${errorCount}，告警 ${warningCount}）`;
  if (failed > 0) {
    console.error(summary);
    return 1;
  }
  console.log(summary);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`[validate-dlc] 未预期错误：${messageOf(error)}`);
    process.exitCode = 1;
  });
