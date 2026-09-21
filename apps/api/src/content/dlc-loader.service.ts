import { Injectable, Logger } from '@nestjs/common';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUILTIN_PACKS, type ContentPack } from '@lazycraft/shared';

/**
 * 外部 DLC 加载器（task-43）。
 *
 * 安全边界（必须写死在代码里）：DLC 是**在 API 进程内执行的任意 JS**，
 * 加载器只做"读目录 + import 文件"，**不提供任何上传 / 在线编辑出口**。
 * 因此能放 DLC 的人 = 能写服务器挂载目录的人（运维）；管理后台永远不能
 * 制造一个 DLC 文件。这是 task-43 与总纲共同确认的取舍，不是遗漏。
 *
 * 为什么加载器放 apps/api 而不是 packages/shared？
 *   shared 是纯逻辑包（浏览器也要消费），引入 node:fs / dynamic import 会让
 *   前端构建把整个 loader 打进产物、并在浏览器里报错。目录扫描天生是 Node 侧职责。
 *
 * 目录约定：`DLC_DIR`（默认 `/app/dlc`）下的**每个子目录 = 一个 DLC**：
 *   <dlc-dir>/<pack-id>/manifest.json   —— 元信息（id/name/version/entry）
 *   <dlc-dir>/<pack-id>/index.js        —— entry 指向的 ESM 入口
 *
 * 入口导出约定：优先取**具名导出 `pack`**（`export const pack = {...}`），
 *   兼容 `export default {...}` 作为兜底。两者都必须是合法 ContentPack 形状。
 *
 * 失败隔离：任一环节失败都只记一条可诊断错误并**跳过该 DLC**，
 *   绝不让 API 启动失败——DLC 是运营内容，不该有能力弄挂整个服务。
 */

/** 加载失败发生的阶段：供管理页定位"是目录/清单/文件还是代码的问题" */
export type DlcLoadStage =
  | 'scan' // 根目录本身读不了（权限/IO），区别于"目录不存在"
  | 'manifest' // manifest.json 缺失或 JSON 语法/字段不合法
  | 'import' // 入口文件缺失或 import 执行时抛异常
  | 'shape' // 导出对象不满足 ContentPack 契约
  | 'conflict'; // id 与内置包或其它外部包冲突

/** 一条可诊断的加载失败记录（dir 为出错目录的绝对路径） */
export interface DlcLoadError {
  dir: string;
  stage: DlcLoadStage;
  message: string;
}

/** 加载结果：成功的包 + 全部失败记录（失败不影响成功项） */
export interface DlcLoadResult {
  packs: ContentPack[];
  errors: DlcLoadError[];
}

/** manifest.json 的字段契约（最小集） */
export interface DlcManifest {
  id: string;
  name: string;
  version: string;
  /** 相对该 DLC 子目录的 ESM 入口文件，例如 'index.js' */
  entry: string;
}

/** 容器内挂载点；本地 dev / e2e 通过 DLC_DIR 覆盖 */
const DEFAULT_DLC_DIR = '/app/dlc';

@Injectable()
export class DlcLoaderService {
  private readonly logger = new Logger(DlcLoaderService.name);

  /** 当前生效的挂载目录（每次调用都读 env，便于 e2e 在启动前改写） */
  dlcDir(): string {
    const dir = process.env.DLC_DIR?.trim();
    return dir && dir.length > 0 ? dir : DEFAULT_DLC_DIR;
  }

  /**
   * 扫描并加载全部外部 DLC。
   *
   * 目录不存在 = 没有外部 DLC（**不是错误**）：本地 dev 与既有 e2e 都是这种状态，
   * 把它们当成错误会让所有测试默认红。只有"目录存在但读失败"才记 scan 错误。
   */
  async load(): Promise<DlcLoadResult> {
    const root = this.dlcDir();
    const packs: ContentPack[] = [];
    const errors: DlcLoadError[] = [];

    let dirents;
    try {
      dirents = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isErrno(error, 'ENOENT') || isErrno(error, 'ENOTDIR')) {
        // 目录不存在 = 无外部 DLC
        return { packs, errors };
      }
      errors.push({
        dir: root,
        stage: 'scan',
        message: `扫描 DLC 目录失败：${messageOf(error)}`,
      });
      return { packs, errors };
    }

    // 记录已占用 id（内置优先），用于冲突诊断；key=id，value=占用者可读名
    const claimed = new Map<string, string>(
      BUILTIN_PACKS.map((pack) => [pack.id, '内置包']),
    );

    for (const dirent of dirents) {
      // 顶层非目录文件一律忽略：约定就是"一个子目录一个 DLC"，散落文件不构成 DLC
      if (!dirent.isDirectory()) continue;
      const dir = join(root, dirent.name);
      const outcome = await this.loadOne(dir, claimed);
      if (outcome.error) {
        errors.push(outcome.error);
        continue;
      }
      packs.push(outcome.pack);
      claimed.set(outcome.pack.id, dir);
    }

    if (errors.length > 0) {
      // 一次打印全部失败：运维改一轮就能修好，避免"启动-看一条-再启动"
      this.logger.error(
        `外部 DLC 加载失败 ${errors.length} 项（已跳过，不影响启动）：`,
      );
      for (const error of errors) {
        this.logger.error(
          `  - [${error.stage}] ${error.dir}：${error.message}`,
        );
      }
    }
    if (packs.length > 0) {
      this.logger.log(
        `已加载外部 DLC ${packs.length} 个：${packs
          .map((pack) => `${pack.id}@${pack.version}`)
          .join(', ')}`,
      );
    }

    return { packs, errors };
  }

  /* ------------------------------------------------------------------ */
  /* 单个 DLC 的加载流水线                                                */
  /* ------------------------------------------------------------------ */

  private async loadOne(
    dir: string,
    claimed: Map<string, string>,
  ): Promise<
    { pack: ContentPack; error?: undefined } | { error: DlcLoadError }
  > {
    const manifest = await this.readManifest(dir);
    if ('error' in manifest) return manifest;

    // id 冲突在 import 之前拦下：不执行一个注定要被丢弃的 DLC 代码
    const owner = claimed.get(manifest.id);
    if (owner !== undefined) {
      return {
        error: {
          dir,
          stage: 'conflict',
          message: `pack id "${manifest.id}" 已被${owner}占用`,
        },
      };
    }

    const entryPath = join(dir, manifest.entry);
    try {
      const entryStat = await stat(entryPath);
      if (!entryStat.isFile()) {
        return {
          error: {
            dir,
            stage: 'import',
            message: `入口不是文件：${manifest.entry}`,
          },
        };
      }
    } catch (error) {
      return {
        error: {
          dir,
          stage: 'import',
          message: `入口文件不存在或不可读：${manifest.entry}（${messageOf(error)}）`,
        },
      };
    }

    let imported: unknown;
    try {
      imported = await this.importFresh(entryPath);
    } catch (error) {
      return {
        error: {
          dir,
          stage: 'import',
          message: `入口 import 失败：${messageOf(error)}`,
        },
      };
    }

    const candidate = extractPack(imported);
    if (!isContentPack(candidate)) {
      return {
        error: {
          dir,
          stage: 'shape',
          message:
            '入口未导出合法 ContentPack（要求具名导出 pack 或 default，含非空 id/name/version 与 register 函数）',
        },
      };
    }
    // manifest 与入口导出的 id 必须一致：否则管理页显示的 id 与注册进 Registry 的 id 会分叉
    if (candidate.id !== manifest.id) {
      return {
        error: {
          dir,
          stage: 'shape',
          message: `manifest.id "${manifest.id}" 与入口导出 pack.id "${candidate.id}" 不一致`,
        },
      };
    }

    return { pack: candidate };
  }

  private async readManifest(
    dir: string,
  ): Promise<DlcManifest | { error: DlcLoadError }> {
    const manifestPath = join(dir, 'manifest.json');
    let raw: string;
    try {
      raw = await readFile(manifestPath, 'utf8');
    } catch (error) {
      return {
        error: {
          dir,
          stage: 'manifest',
          message: `缺少或无法读取 manifest.json（${messageOf(error)}）`,
        },
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        error: {
          dir,
          stage: 'manifest',
          message: `manifest.json 不是合法 JSON：${messageOf(error)}`,
        },
      };
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return {
        error: {
          dir,
          stage: 'manifest',
          message: 'manifest.json 顶层必须是对象',
        },
      };
    }
    const record = parsed as Record<string, unknown>;
    const missing = (['id', 'name', 'version', 'entry'] as const).filter(
      (key) => {
        const value = record[key];
        return typeof value !== 'string' || value.length === 0;
      },
    );
    if (missing.length > 0) {
      return {
        error: {
          dir,
          stage: 'manifest',
          message: `manifest.json 缺少非空字符串字段：${missing.join(', ')}`,
        },
      };
    }

    return {
      id: record.id as string,
      name: record.name as string,
      version: record.version as string,
      entry: record.entry as string,
    };
  }

  /**
   * import 一个绝对路径的 ESM 入口，并**绕过 Node 的模块缓存**。
   *
   * 为什么必须 cache-busting？
   *   ESM 按 specifier 缓存，同一 URL 重复 import 不会重新执行——运维替换了
   *   DLC 文件后，普通 import 会一直拿到旧模块对象，重载形同虚设。
   *   这里给 file URL 追加 `?v=<mtimeMs>-<size>`：文件内容一变，specifier 就变，
   *   Node 视为新模块重新执行，从而实现"更新 DLC 无需重启进程"。
   *
   * 已知局限：只对入口本身取指纹，入口内部 import 的本地子模块不会被 bust
   *   （它们的相对 URL 不带 query）。单文件入口是推荐形态，多文件包建议每次整包替换。
   */
  private async importFresh(entryPath: string): Promise<unknown> {
    const entryStat = await stat(entryPath);
    const token = `${Math.trunc(entryStat.mtimeMs)}-${entryStat.size}`;
    // pathToFileURL：ESM + nodenext 下直接 import 裸文件路径会被当成包名解析而失败
    const url = `${pathToFileURL(entryPath).href}?v=${token}`;
    return import(/* @vite-ignore */ url);
  }
}

/* -------------------------------------------------------------------- */
/* 纯函数工具（导出便于单测/复用）                                        */
/* -------------------------------------------------------------------- */

/** 从模块命名空间里取 ContentPack 候选：优先具名 pack，兜底 default */
export function extractPack(moduleNamespace: unknown): unknown {
  if (typeof moduleNamespace !== 'object' || moduleNamespace === null)
    return undefined;
  const ns = moduleNamespace as Record<string, unknown>;
  return ns.pack ?? ns.default;
}

/** 校验导出对象的 ContentPack 形状（与 shared 的 ContentPack 契约一致） */
export function isContentPack(value: unknown): value is ContentPack {
  if (typeof value !== 'object' || value === null) return false;
  const pack = value as Record<string, unknown>;
  return (
    typeof pack.id === 'string' &&
    pack.id.length > 0 &&
    typeof pack.name === 'string' &&
    pack.name.length > 0 &&
    typeof pack.version === 'string' &&
    pack.version.length > 0 &&
    typeof pack.register === 'function'
  );
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
