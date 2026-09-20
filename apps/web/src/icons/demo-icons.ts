import { FORMAT_DEMO_ICONS, type IconDef } from '@lazycraft/icons';

export { FORMAT_DEMO_ICONS };

/** 演示卡片上的形态标签（webp / png / jpg / emoji） */
export function formatLabel(icon: IconDef): string {
  if (icon.source === 'raster') return `raster · ${icon.format} · ${icon.license.spdx}`;
  if (icon.source === 'emoji') return 'emoji';
  return 'svg';
}
