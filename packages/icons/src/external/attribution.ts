/**
 * 外部图标源的许可与署名元数据。
 *
 * 为什么署名要建模进代码而不是只写 README？
 *   抽取脚本产出的 sprite 一旦被 DLC 带进运行时，署名义务就跟着走；
 *   把许可信息挂在抽取结果上，页脚/关于页可以直接消费，
 *   避免"换了素材忘了换署名"这类只在法务时才暴露的问题。
 *
 * task-35 起，位图素材的许可（开放集，无法预先枚举）也在此汇聚：
 *   见 aggregateMaterialAttributions。
 */

import type { IconDef } from '../types.js';
import { isRasterIcon } from '../types.js';

/** 外部源许可信息 */
export interface IconAttribution {
  source: 'game-icons' | 'lucide';
  /** 许可名称 */
  license: string;
  /** 许可全文地址 */
  licenseUrl: string;
  /** 是否强制署名（CC BY 3.0 = 是；ISC = 否，仍建议列出） */
  requiresAttribution: boolean;
  /** 项目主页 */
  homepage: string;
  /** 给页脚/关于页直接用的中文署名文案 */
  credit: string;
}

/** 两个外部源（也是本库唯一认可的外部源）的署名元数据 */
export const EXTERNAL_ATTRIBUTIONS: Readonly<
  Record<'game-icons' | 'lucide', IconAttribution>
> = {
  'game-icons': {
    source: 'game-icons',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    requiresAttribution: true,
    homepage: 'https://game-icons.net',
    credit: '部分图标来自 game-icons.net（CC BY 3.0），作者见各图标页署名。',
  },
  lucide: {
    source: 'lucide',
    license: 'ISC',
    licenseUrl: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE',
    requiresAttribution: false,
    homepage: 'https://lucide.dev',
    credit: '部分图标来自 lucide（ISC 许可）。',
  },
};

/** 取某个外部源的署名信息 */
export function attributionFor(source: 'game-icons' | 'lucide'): IconAttribution {
  return EXTERNAL_ATTRIBUTIONS[source];
}

/* ------------------------------------------------------------------ */
/* 位图素材署名（task-35 / docs/06 §九）                                 */
/* ------------------------------------------------------------------ */

/**
 * 位图素材的署名条目。
 *
 * 为什么与 IconAttribution 分开建型？
 *   外部图标库是"已知闭集"（就 game-icons / lucide 两家，元数据固定）；
 *   位图素材是"开放集"（每个 DLC 各自带素材与许可），无法预先枚举。
 *   这里只按 IconLicense 去重聚合，页脚/关于页原样消费即可。
 */
export interface MaterialAttribution {
  /** SPDX 标识（如 'CC-BY-4.0' / 'LicenseRef-LazyCraft'） */
  spdx: string;
  author?: string;
  /** 素材来源地址 */
  source?: string;
  /** 使用的图标名（同一许可下的全部素材） */
  icons: string[];
  /** 给页脚/关于页直接用的中文署名文案 */
  credit: string;
}

/** 本项目自绘素材的 SPDX 标识（见 docs/06 §九） */
export const LAZYCRAFT_LICENSE_SPDX = 'LicenseRef-LazyCraft';

/** 由 spdx/author 拼一条可读的署名文案 */
function creditOf(license: MaterialAttribution): string {
  if (license.spdx === LAZYCRAFT_LICENSE_SPDX) return '图标素材为 LazyCraft 自绘。';
  const who = license.author ? `${license.author}` : '佚名';
  return `部分位图图标来自 ${who}（${license.spdx}）。`;
}

/** 署名清单的聚合键：同一许可 + 同作者 + 同来源归为一条 */
function materialKey(license: { spdx: string; author?: string; source?: string }): string {
  return `${license.spdx}\u0000${license.author ?? ''}\u0000${license.source ?? ''}`;
}

/**
 * 把一组图标里的位图许可汇聚成署名清单。
 *
 * 为什么按许可聚合而不是逐图一条？
 *   页脚/关于页需要的是"用了哪些许可、署名给谁"，
 *   逐个图标列出会把同一份 CC-BY 素材刷屏；按许可归并后每张素材只出现一次。
 */
export function aggregateMaterialAttributions(
  icons: ReadonlyArray<IconDef>,
): MaterialAttribution[] {
  const byKey = new Map<string, MaterialAttribution>();

  for (const icon of icons) {
    if (!isRasterIcon(icon)) continue;
    const key = materialKey(icon.license);
    const existing = byKey.get(key);
    if (existing) {
      existing.icons.push(icon.name);
      continue;
    }
    const entry: MaterialAttribution = {
      spdx: icon.license.spdx,
      author: icon.license.author,
      source: icon.license.source,
      icons: [icon.name],
      credit: '',
    };
    entry.credit = creditOf(entry);
    byKey.set(key, entry);
  }

  return [...byKey.values()];
}

