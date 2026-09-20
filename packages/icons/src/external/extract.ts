/**
 * 外部图标抽取 —— 把 DLC 登记的 IconRef[] 解析成可内联的 IconDef sprite。
 *
 * 定位（见 docs/07-UI风格与图标系统.md §二）：
 *   - 运行时零请求、零依赖：外部库只登记"库名 + 图标名"，
 *     实际 path 在**构建期**抽成内联 sprite（<symbol> + <use>）。
 *   - 本体手绘也在同一批里，最终产出一张统一 sprite，
 *     DLC 侧只关心"我要用到的图标"，不关心它来自手绘还是外部库。
 *
 * task-35 起本函数同时承担"多形态素材的构建期关口"：
 *   解析各形态 → 校验（raster 缺许可等）→ 产出 sprite（仅矢量）+ 署名清单
 *   （外部库署名 + 位图素材署名）。
 *
 * 实现程度说明：
 *   本仓库未安装 game-icons / lucide，也不为抽取引入运行时依赖；
 *   因此这里实现的是**契约 + 本地表解析 + sprite 产出 + 署名/校验**。
 *   真实素材的库文件抽取由构建期（在装有对应库的 DLC 仓库）完成，
 *   结果写进 external/table.ts 或作为 externalTable 入参传入即可。
 */

import type { IconDef, IconRef } from '../types.js';
import { resolveIconRef, type ExternalIconTable } from '../resolve.js';
import { renderSprite } from '../render.js';
import { validateIcons, type IconValidationResult } from '../validate.js';
import {
  aggregateMaterialAttributions,
  attributionFor,
  type IconAttribution,
  type MaterialAttribution,
} from './attribution.js';
import { LOCAL_EXTERNAL_TABLE } from './table.js';

/** 单个引用的抽取结果 */
export interface ExtractedIcon {
  /** DLC 登记的引用名 */
  name: string;
  /** 是否解析成功；失败时 icon 缺省、reason 给出原因 */
  ok: boolean;
  icon?: IconDef;
  /** 来源（命中外部表或手绘回退后仍保留原始 source 便于统计署名） */
  source: IconRef['source'];
  reason?: 'missing-hand-drawn' | 'missing-external' | 'invalid-raster';
}

/** 抽取结果：sprite 字符串 + 逐条明细 + 用到的署名 */
export interface ExternalExtraction {
  /** 统一 sprite（隐藏 <svg> + 全部 <symbol>；仅矢量形态） */
  sprite: string;
  /** 成功解析出的图标（已去重，含 emoji / raster 等非矢量形态） */
  icons: IconDef[];
  /** 逐条解析明细，失败项也保留，便于构建期报警 */
  entries: ExtractedIcon[];
  /** 本次用到的外部源署名（仅列出真正命中外部表的源） */
  attributions: IconAttribution[];
  /** 本次用到的位图素材署名（按许可聚合；构建期与页脚共用） */
  materialAttributions: MaterialAttribution[];
  /** 形态完整性校验结果（raster 缺许可等；ok=false 时构建应失败） */
  validation: IconValidationResult;
  /** 缺失/非法引用（构建期应视为错误或告警） */
  missing: string[];
}

/**
 * 抽取一组 DLC 图标引用为内联 sprite。
 *
 * @param refs DLC / 内容登记的图标引用
 * @param externalTable 构建期抽取表；缺省用本地占位表（见 external/table.ts）
 */
export function extractIcons(
  refs: ReadonlyArray<IconRef>,
  externalTable: ExternalIconTable = LOCAL_EXTERNAL_TABLE,
): ExternalExtraction {
  const entries: ExtractedIcon[] = [];
  const icons: IconDef[] = [];
  const seen = new Set<string>();
  const missing: string[] = [];
  const usedSources = new Set<'game-icons' | 'lucide'>();

  for (const ref of refs) {
    const resolved = resolveIconRef(ref, externalTable);
    if (resolved.ok) {
      entries.push({ name: ref.name, ok: true, icon: resolved.icon, source: ref.source });
      if (!seen.has(ref.name)) {
        seen.add(ref.name);
        icons.push(resolved.icon);
      }
      // 只有"外部引用且命中了外部表"才算真正用到该外部源
      if (ref.source === 'game-icons' || ref.source === 'lucide') {
        const key = `${ref.source}:${ref.iconName}`;
        if (externalTable?.[key]) usedSources.add(ref.source);
      }
    } else {
      entries.push({
        name: ref.name,
        ok: false,
        source: ref.source,
        reason: resolved.reason,
      });
      missing.push(ref.name);
    }
  }

  return {
    sprite: renderSprite(icons),
    icons,
    entries,
    attributions: [...usedSources].map(attributionFor),
    materialAttributions: aggregateMaterialAttributions(icons),
    validation: validateIcons(icons),
    missing,
  };
}
