/**
 * 外部 DLC 加载器单测（task-43）。
 *
 * 覆盖"失败隔离"这一硬要求的纯逻辑面：加载器对坏 DLC 只记错误、不抛；
 * 对好 DLC 正确产出 ContentPack。e2e 覆盖"应用不因坏 DLC 启动失败"的集成面。
 *
 * 为什么用真实临时目录而不是 mock fs？
 *   加载器的核心风险恰恰在"目录里到底有什么"（缺文件、JSON 坏、形状错），
 *   mock fs 会把被测的行为也一起伪造掉；用 os.tmpdir 里的真实文件才测得到。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DlcLoaderService,
  extractPack,
  isContentPack,
} from './dlc-loader.service.js';

/** 合法入口：导出具名 pack，注册一个物品（自洽，不引用外部内容） */
const GOOD_ENTRY = `
export const pack = {
  id: 'good_dlc',
  name: '好 DLC',
  version: '1.0.0',
  register(registry) {
    registry.item({
      id: 'good_dlc_item',
      name: '好物品',
      type: 'material',
      tier: 1,
      stack_max: 99,
      tradeable: false,
      quality: ['common'],
      use_tags: [],
      rarity: 'normal',
      broadcast_threshold: 'epic',
    });
  },
};
`;

let root: string;
let originalDir: string | undefined;

beforeAll(async () => {
  originalDir = process.env.DLC_DIR;
  root = await mkdtemp(join(tmpdir(), 'lazycraft-dlc-unit-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  if (originalDir === undefined) delete process.env.DLC_DIR;
  else process.env.DLC_DIR = originalDir;
});

async function makeDlc(
  name: string,
  manifest: string | null,
  entry: string | null,
) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  if (manifest !== null)
    await writeFile(join(dir, 'manifest.json'), manifest, 'utf8');
  if (entry !== null) await writeFile(join(dir, 'index.js'), entry, 'utf8');
  return dir;
}

describe('isContentPack / extractPack', () => {
  it('合法形状返回 true，缺字段返回 false', () => {
    expect(
      isContentPack({ id: 'a', name: 'b', version: '1', register: () => {} }),
    ).toBe(true);
    expect(
      isContentPack({ id: '', name: 'b', version: '1', register: () => {} }),
    ).toBe(false);
    expect(isContentPack({ id: 'a', name: 'b', version: '1' })).toBe(false);
    expect(isContentPack(null)).toBe(false);
    expect(isContentPack('x')).toBe(false);
  });

  it('优先取具名 pack，兜底 default', () => {
    const named = { pack: { id: 'p' } };
    expect(extractPack(named)).toEqual({ id: 'p' });
    const dflt = { default: { id: 'd' } };
    expect(extractPack(dflt)).toEqual({ id: 'd' });
    expect(extractPack({})).toBeUndefined();
  });
});

describe('DlcLoaderService.load 失败隔离', () => {
  it('目录不存在 = 无外部 DLC，且不是错误', async () => {
    process.env.DLC_DIR = join(root, 'does-not-exist');
    const { packs, errors } = await new DlcLoaderService().load();
    expect(packs).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('好 DLC 被加载；坏 DLC 只记错误、不抛出，好 DLC 不受影响', async () => {
    process.env.DLC_DIR = join(root, 'mixed');
    await mkdir(process.env.DLC_DIR, { recursive: true });
    await makeDlc(
      'mixed/good',
      JSON.stringify({
        id: 'good_dlc',
        name: '好',
        version: '1.0.0',
        entry: 'index.js',
      }),
      GOOD_ENTRY,
    );
    // 坏 1：manifest JSON 语法错
    await makeDlc('mixed/bad-json', '{ not json', GOOD_ENTRY);
    // 坏 2：入口不存在
    await makeDlc(
      'mixed/missing-entry',
      JSON.stringify({
        id: 'missing',
        name: '缺',
        version: '1',
        entry: 'nope.js',
      }),
      null,
    );
    // 坏 3：形状不合规（register 不是函数）
    await makeDlc(
      'mixed/bad-shape',
      JSON.stringify({
        id: 'badshape',
        name: '坏',
        version: '1',
        entry: 'index.js',
      }),
      'export const pack = { id: "badshape", name: "坏", version: "1" };',
    );
    // 坏 4：id 与内置包 core 冲突
    await makeDlc(
      'mixed/conflict',
      JSON.stringify({
        id: 'core',
        name: '冲',
        version: '1',
        entry: 'index.js',
      }),
      'export const pack = { id: "core", name: "冲", version: "1", register() {} };',
    );

    const { packs, errors } = await new DlcLoaderService().load();
    expect(packs.map((p) => p.id)).toEqual(['good_dlc']);
    const stages = new Map(
      errors.map((e) => [e.dir.split(/[\\/]/).pop(), e.stage]),
    );
    expect(stages.get('bad-json')).toBe('manifest');
    expect(stages.get('missing-entry')).toBe('import');
    expect(stages.get('bad-shape')).toBe('shape');
    expect(stages.get('conflict')).toBe('conflict');
    // 每条错误都带可诊断信息与目录绝对路径
    for (const error of errors) {
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.dir.startsWith(root)).toBe(true);
    }
  });

  it('同一入口文件内容变化后返回新版本（cache-busting 生效），无需重启', async () => {
    process.env.DLC_DIR = join(root, 'bust');
    const dir = join(process.env.DLC_DIR, 'v');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'v',
        name: 'V',
        version: '1.0.0',
        entry: 'index.js',
      }),
      'utf8',
    );
    await writeFile(
      join(dir, 'index.js'),
      GOOD_ENTRY.replaceAll('good_dlc', 'v'),
      'utf8',
    );

    const loader = new DlcLoaderService();
    const first = await loader.load();
    expect(first.packs[0]?.version).toBe('1.0.0');

    // 覆盖入口文件并让 mtime/size 变化 → 重载必须拾取新内容
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'v',
        name: 'V',
        version: '2.0.0',
        entry: 'index.js',
      }),
      'utf8',
    );
    await writeFile(
      join(dir, 'index.js'),
      GOOD_ENTRY.replaceAll('good_dlc', 'v').replace(
        "version: '1.0.0'",
        "version: '2.0.0'",
      ),
      'utf8',
    );

    const second = await loader.load();
    expect(second.packs[0]?.version).toBe('2.0.0');
  });
});
