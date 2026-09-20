/**
 * 把 DLC 登记的 `IconRef` 解析成可渲染的 `IconDef`。
 *
 * 为什么要分两步（登记 → 解析）而不是直接存 IconDef？
 *   game-icons / lucide 的图标本体不应被 DLC 打包进来（体积 + 许可），
 *   DLC 只登记"我要哪个库的哪个图标"；构建期再把用到的子集抽出来，
 *   形成一张外部图标表传给 resolveIconRef，运行时零请求、零依赖。
 *
 * 多形态（task-35）下本模块是"登记格式 → 渲染格式"的归一化点：
 *   emoji / raster 由引用直接成型，外部库归并为 svg 形态，
 *   消费端拿到的永远是已收窄过的 IconDef。
 */

import type { IconDef, IconRef, SvgIconDef } from './types.js';
import { findIcon } from './catalog.js';

/** 解析结果：要么可直接渲染，要么缺失（调用方回退到首字母等兜底） */
export type ResolvedIcon =
  | { ok: true; icon: IconDef }
  | { ok: false; reason: 'missing-hand-drawn' | 'missing-external' | 'invalid-raster' }

/**
 * 外部图标表：构建期产物，key 为 `"<source>:<iconName>"`。
 *
 * 表内恒为矢量形态（外部库抽取后内联 path）；
 * 例：`{ "game-icons:wood-beam": SvgIconDef, "lucide:search": SvgIconDef }`
 */
export type ExternalIconTable = Readonly<Record<string, SvgIconDef>>;

/** 外部图标的查表键 */
export function externalKey(source: 'game-icons' | 'lucide', iconName: string): string {
  return `${source}:${iconName}`;
}

/**
 * 解析一个图标引用。
 *
 * @param ref DLC / 内容登记的图标引用
 * @param external 构建期抽取的外部图标表；缺省时外部引用一律视为缺失
 */
export function resolveIconRef(
  ref: IconRef,
  external?: ExternalIconTable,
): ResolvedIcon {
  switch (ref.source) {
    case 'hand-drawn': {
      // 内联手绘：DLC 自带 def，直接成型
      const icon: SvgIconDef = { name: ref.name, source: 'hand-drawn', ...ref.def };
      return { ok: true, icon };
    }

    case 'emoji':
      return { ok: true, icon: { name: ref.name, source: 'emoji', char: ref.char } };

    case 'raster':
      // 位图许可缺失在运行时也拒绝：缺 license 的位图不允许进入可渲染集合
      if (!ref.license?.spdx) return { ok: false, reason: 'invalid-raster' };
      return {
        ok: true,
        icon: {
          name: ref.name,
          source: 'raster',
          url: ref.url,
          format: ref.format,
          license: ref.license,
        },
      };

    default: {
      // 外部库：先查构建期表；查不到再退回本体内置目录（同名手绘兼容）
      const table = external ?? {};
      const key = externalKey(ref.source, ref.iconName);
      const fromTable = table[key];
      if (fromTable) {
        return { ok: true, icon: { ...fromTable, name: ref.name } };
      }

      const fallback = findIcon(ref.name);
      if (fallback) return { ok: true, icon: fallback };

      return { ok: false, reason: 'missing-external' };
    }
  }
}
