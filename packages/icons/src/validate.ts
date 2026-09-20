/**
 * 图标构建期校验（task-35 / docs/06 §九）。
 *
 * 为什么校验要放在图标库而不是只放 Registry.validate()？
 *   Registry 只认识"已注册内容"，而位图素材的问题（缺许可、URL 不是 /icons/、
 *   格式与扩展名不符）与注册路径无关——DLC 在构建期扫素材目录时就该拦住。
 *   本函数是**纯函数**，构建脚本 / 测试 / 后端启动都能调，先于发布失败。
 *
 * 只做"缺了会出事"的硬校验，不做风格建议：
 *   raster 必须有 license（法务）、url 必须以 /icons/ 开头（同源托管契约）、
 *   format 与扩展名一致（防 404）、emoji 必须有 char（否则渲染空白）。
 */

import type { IconDef, RasterFormat } from './types.js';
import { isRasterIcon } from './types.js';

export interface IconValidationResult {
  ok: boolean;
  errors: string[];
}

/** 允许的位图扩展名（jpg 与 jpeg 等价，规范化为 jpg） */
const FORMAT_EXT: Readonly<Record<RasterFormat, ReadonlyArray<string>>> = {
  png: ['.png'],
  jpg: ['.jpg', '.jpeg'],
  webp: ['.webp'],
};

/** 位图 URL 的约定前缀：Vite public / nginx 同源托管（docs/06 §九） */
export const RASTER_URL_PREFIX = '/icons/';

/** 校验单枚图标的形态完整性，返回错误列表（空数组 = 通过） */
export function validateIcon(icon: IconDef): string[] {
  const errors: string[] = [];

  if (icon.name.length === 0) {
    errors.push(`[icon] name 不能是空字符串`);
  }

  if (isRasterIcon(icon)) {
    if (!icon.license?.spdx) {
      errors.push(`[icon:${icon.name}] raster 缺少 license.spdx（禁止无许可来源的位图进仓库）`);
    }
    if (!icon.url.startsWith(RASTER_URL_PREFIX)) {
      errors.push(`[icon:${icon.name}] raster url 必须以 "${RASTER_URL_PREFIX}" 开头：${icon.url}`);
    }
    const exts = FORMAT_EXT[icon.format];
    if (exts && !exts.some((ext) => icon.url.toLowerCase().endsWith(ext))) {
      errors.push(
        `[icon:${icon.name}] raster format "${icon.format}" 与 url 扩展名不符：${icon.url}`,
      );
    }
    return errors;
  }

  if (icon.source === 'emoji') {
    if (icon.char.length === 0) {
      errors.push(`[icon:${icon.name}] emoji 缺少 char`);
    }
    return errors;
  }

  // svg 形态
  if (icon.paths.length === 0) {
    errors.push(`[icon:${icon.name}] paths 不能为空数组`);
    return errors;
  }
  for (const path of icon.paths) {
    if (path.d.length === 0) {
      errors.push(`[icon:${icon.name}] 存在 d 为空的绘制指令`);
    }
  }

  return errors;
}

/**
 * 校验一组图标；返回全部错误（不提前 return，便于一轮修完）。
 *
 * @param icons 待校验图标（本体目录 / DLC 登记后的快照 / 素材清单）
 */
export function validateIcons(icons: ReadonlyArray<IconDef>): IconValidationResult {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const icon of icons) {
    for (const error of validateIcon(icon)) errors.push(error);
    // 重名会让 <use href="#name"> 引用到不确定的一份，属构建期硬错误
    if (icon.name.length > 0) {
      if (seen.has(icon.name)) {
        errors.push(`[icon:${icon.name}] name 重复`);
      }
      seen.add(icon.name);
    }
  }

  return { ok: errors.length === 0, errors };
}
