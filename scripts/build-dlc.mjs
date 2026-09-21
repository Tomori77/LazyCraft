#!/usr/bin/env node
/**
 * DLC 构建脚本（task-44）。
 *
 * 为什么必须有它，而不是"把 TS 丢进挂载目录让 Node 自己跑"？
 *   生产镜像（node:22-alpine）只运行编译产物，DLC 作者写的是 TS / 多文件；
 *   构建脚本负责把"源码形态"转成加载器要求的"单文件 ESM 入口 + manifest"，
 *   这样"放目录 + 重载"这条运维流程才对作者透明。
 *
 * 为什么用 esbuild 打包成单文件，而不是 tsc 逐文件编译？
 *   task-43 的 cache-busting **只对入口文件取指纹**：入口内部相对 import 的
 *   子模块不会被 bust。逐文件编译会产出多个相对 import，更新子模块后重载可能
 *   仍拿到旧模块（Node ESM 缓存）。打成一个入口 = 更新即整包生效，正合该局限。
 *
 * 为什么 esbuild 从 .pnpm 里解析，而不写 `import('esbuild')`？
 *   仓库根没有 `node_modules/esbuild`（它只是 vite 的传递依赖，只存在于
 *   `node_modules/.pnpm/`），裸包名 import 会直接失败。这里按 glob 定位实际安装
 *   位置，不硬编码版本号；找不到时给出明确的修复提示。同理不依赖裸 `tsc`。
 *
 * 产物布局（必须与 task-43 加载器约定一致）：
 *   <out>/<pack-id>/manifest.json   元信息（entry 已改写为产物文件名）
 *   <out>/<pack-id>/index.js        entry 指向的单文件 ESM 入口
 *   <out>/<pack-id>/assets/**       随包静态资源（源目录有 assets/ 时）
 *   <out>/<pack-id>/package.json    {"type":"module"}，见下方注释
 *
 * 用法：
 *   node scripts/build-dlc.mjs [srcDir] [--out <dir>]
 *     srcDir    DLC 源目录（含 manifest.json），默认 examples/dlc-example
 *     --out    输出根目录，默认 ./dlc（产物落在 ./dlc/<pack-id>/）
 */

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

/* ------------------------------------------------------------------ */
/* 参数解析                                                            */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  let src = null;
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      out = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
    } else if (arg === '-h' || arg === '--help') {
      console.log(
        '用法：node scripts/build-dlc.mjs [srcDir] [--out <dir>]\n' +
          '  srcDir  默认 examples/dlc-example\n' +
          '  --out   默认 ./dlc（产物落在 ./dlc/<pack-id>/）',
      );
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      src = arg;
    }
  }
  return {
    srcDir: join(REPO_ROOT, src ?? 'examples/dlc-example'),
    outRoot: join(REPO_ROOT, out ?? 'dlc'),
  };
}

/* ------------------------------------------------------------------ */
/* esbuild 定位                                                        */
/* ------------------------------------------------------------------ */

/**
 * 在 `node_modules/.pnpm` 下按 glob 找 esbuild 的入口模块。
 * 为什么不写死 `esbuild@0.21.5`？版本会随 vite 升级漂移，写死等于埋一颗定时炸弹。
 */
async function resolveEsbuild() {
  const pnpmDir = join(REPO_ROOT, 'node_modules/.pnpm');
  if (!existsSync(pnpmDir)) {
    throw new Error(
      '找不到 node_modules/.pnpm：请先在仓库根执行 `pnpm install`。',
    );
  }
  const entries = await readdir(pnpmDir);
  const candidates = entries
    .filter((name) => name.startsWith('esbuild@'))
    .map((name) =>
      join(pnpmDir, name, 'node_modules/esbuild/lib/main.js'),
    );
  for (const candidate of candidates) {
    if (existsSync(candidate)) return import(pathToFileURL(candidate).href);
  }
  throw new Error(
    '仓库内找不到 esbuild 可执行模块（.pnpm 下无 esbuild@*/lib/main.js）。\n' +
      '  修复：在仓库根执行 `pnpm install`（esbuild 是 vite 的传递依赖）。',
  );
}

/* ------------------------------------------------------------------ */
/* manifest 读取与字段校验                                              */
/* ------------------------------------------------------------------ */

const REQUIRED_FIELDS = ['id', 'name', 'version', 'entry'];

async function readManifest(srcDir) {
  const manifestPath = join(srcDir, 'manifest.json');
  let raw;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch {
    throw new Error(`源目录缺少 manifest.json：${manifestPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`manifest.json 不是合法 JSON：${error.message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('manifest.json 顶层必须是对象');
  }
  const missing = REQUIRED_FIELDS.filter(
    (key) => typeof parsed[key] !== 'string' || parsed[key].length === 0,
  );
  if (missing.length > 0) {
    throw new Error(`manifest.json 缺少非空字符串字段：${missing.join(', ')}`);
  }
  return parsed;
}

/** 源入口文件名 → 产物入口文件名（扩展名统一成 .js，与加载器"ESM 入口"约定一致） */
function outputEntryName(sourceEntry) {
  const ext = extname(sourceEntry).toLowerCase();
  if (ext === '.js' || ext === '.mjs') return basename(sourceEntry);
  return `${basename(sourceEntry, extname(sourceEntry))}.js`;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const { srcDir, outRoot } = parseArgs(process.argv.slice(2));

  const srcStat = await stat(srcDir).catch(() => null);
  if (!srcStat?.isDirectory()) {
    throw new Error(`源目录不存在或不是目录：${srcDir}`);
  }

  const manifest = await readManifest(srcDir);
  const packDir = join(outRoot, manifest.id);
  const entrySource = join(srcDir, manifest.entry);

  const entryStat = await stat(entrySource).catch(() => null);
  if (!entryStat?.isFile()) {
    throw new Error(
      `manifest.entry 指向的入口不存在：${manifest.entry}（解析为 ${entrySource}）`,
    );
  }

  const esbuild = await resolveEsbuild();
  const entryOutName = outputEntryName(manifest.entry);

  // 先清空目标目录：整包替换是"多文件包更新"的推荐做法（cache-busting 的局限），
  // 残留的旧文件会让运维分不清"目录里到底哪份在生效"。
  await rm(packDir, { recursive: true, force: true });
  await mkdir(packDir, { recursive: true });

  const warnings = [];
  const result = await esbuild.build({
    entryPoints: [entrySource],
    outfile: join(packDir, entryOutName),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    // 裸包名一律 external：DLC 应从宿主解析 @lazycraft/*，不把 shared 打进每个包
    // （否则 DLC 会带着一份与引擎不同的 Registry 类型实现，出现"注册了但引擎不认"）。
    packages: 'external',
    sourcemap: false,
    logLevel: 'silent',
  });
  for (const warning of result.warnings) {
    warnings.push(warning.text);
  }

  // manifest.entry 指向产物入口：源里写 src/index.ts，运维看到的是 index.js
  const outManifest = { ...manifest, entry: entryOutName };
  await writeFile(
    join(packDir, 'manifest.json'),
    `${JSON.stringify(outManifest, null, 2)}\n`,
    'utf8',
  );

  // 为什么额外写一份 package.json？
  //   产物目录在挂载点下没有 package.json，Node 只能靠"语法探测"判断 ESM；
  //   显式声明 type=module 让入口在任意 Node 22.x 补丁版上都稳定按 ESM 加载。
  await writeFile(
    join(packDir, 'package.json'),
    `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
    'utf8',
  );

  // 随包静态资源：约定源目录 `assets/`（位图等），整目录复制到产物旁
  const assetsSrc = join(srcDir, 'assets');
  let assetCount = 0;
  const assetsStat = await stat(assetsSrc).catch(() => null);
  if (assetsStat?.isDirectory()) {
    await cp(assetsSrc, join(packDir, 'assets'), { recursive: true });
    assetCount = (await readdir(assetsSrc, { recursive: true })).filter((p) =>
      /\.(png|jpe?g|webp|svg)$/i.test(p),
    ).length;
  }

  const rel = (p) => p.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
  console.log(`[build-dlc] 已构建 ${manifest.id}@${manifest.version}`);
  console.log(`  源目录   ${rel(srcDir)}`);
  console.log(`  产物目录 ${rel(packDir)}`);
  console.log(`  入口     ${manifest.entry} → ${entryOutName}`);
  console.log(`  资源     ${assetCount} 个（assets/）`);
  if (warnings.length > 0) {
    console.log(`  构建告警 ${warnings.length} 条：`);
    for (const warning of warnings) console.log(`    - ${warning}`);
  }
  console.log(
    `  下一步   node scripts/validate-dlc.mjs ${rel(packDir)}` +
      `（校验通过后拷到挂载目录 ./dlc/ 并点「应用重载」）`,
  );
}

main().catch((error) => {
  console.error(`[build-dlc] 构建失败：${error.message}`);
  process.exit(1);
});
