import { describe, expect, it } from 'vitest';
import {
  HAND_DRAWN_ICONS,
  findIcon,
  listIconsByDomain,
} from './catalog.js';
import { EMOJI_ICONS, RASTER_ICONS, FORMAT_DEMO_ICONS } from './formats.js';
import {
  renderIconHtml,
  renderIconSymbol,
  renderIconSvg,
  renderSprite,
  toIconRender,
} from './render.js';
import { resolveIconRef, externalKey } from './resolve.js';
import { isEmojiIcon, isRasterIcon, isSvgIcon } from './types.js';
import type { IconDef, RasterIconDef } from './types.js';
import { validateIcon, validateIcons } from './validate.js';
import { extractIcons } from './external/extract.js';
import { LOCAL_EXTERNAL_TABLE, mergeExternalTables } from './external/table.js';
import {
  EXTERNAL_ATTRIBUTIONS,
  aggregateMaterialAttributions,
  attributionFor,
  LAZYCRAFT_LICENSE_SPDX,
} from './external/attribution.js';

describe('图标目录', () => {
  it('名字唯一', () => {
    const names = HAND_DRAWN_ICONS.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('全部为 hand-drawn 且每条 path 有非空 d', () => {
    for (const icon of HAND_DRAWN_ICONS) {
      expect(icon.source).toBe('hand-drawn');
      expect(icon.paths.length).toBeGreaterThan(0);
      for (const p of icon.paths) expect(p.d.length).toBeGreaterThan(0);
    }
  });

  it('多形态示例覆盖 emoji / webp / png / jpg', () => {
    expect(EMOJI_ICONS.every((i) => i.char.length > 0)).toBe(true);
    const formats = RASTER_ICONS.map((i) => i.format).sort();
    expect(formats).toEqual(['jpg', 'png', 'webp']);
    for (const icon of RASTER_ICONS) {
      expect(icon.url.startsWith('/icons/')).toBe(true);
      expect(icon.license.spdx).toBe(LAZYCRAFT_LICENSE_SPDX);
    }
    expect(FORMAT_DEMO_ICONS).toHaveLength(EMOJI_ICONS.length + RASTER_ICONS.length);
  });

  it('findIcon 精确取；不存在返回 undefined', () => {
    expect(findIcon('skill.mining')?.name).toBe('skill.mining');
    expect(findIcon('nope.none')).toBeUndefined();
  });

  it('listIconsByDomain 按域过滤', () => {
    const skills = listIconsByDomain('skill');
    expect(skills.length).toBe(5);
    expect(skills.every((i) => i.name.startsWith('skill.'))).toBe(true);
    expect(listIconsByDomain('item').length).toBe(9);
    expect(listIconsByDomain('slot').length).toBe(10);
  });
});

describe('渲染', () => {
  it('renderIconSvg 输出 svg 且颜色走 currentColor', () => {
    const svg = renderIconSvg(findIcon('skill.mining')!);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('currentColor');
  });

  it('renderIconSymbol 以 name 为 id', () => {
    expect(renderIconSymbol(findIcon('item.ore')!)).toContain('<symbol id="item.ore"');
  });

  it('renderSprite 包含全部图标 symbol', () => {
    const sprite = renderSprite();
    for (const icon of HAND_DRAWN_ICONS) {
      expect(sprite).toContain(`<symbol id="${icon.name}"`);
    }
    expect(sprite).toContain('<defs>');
  });

  it('renderSprite 跳过 emoji / raster 形态', () => {
    const sprite = renderSprite([...HAND_DRAWN_ICONS, ...FORMAT_DEMO_ICONS]);
    for (const icon of FORMAT_DEMO_ICONS) {
      expect(sprite).not.toContain(`<symbol id="${icon.name}"`);
    }
    // 矢量 symbol 仍在
    expect(sprite).toContain('<symbol id="item.ore"');
  });

  it('renderIconSvg 对 emoji 产出 <text>、对 raster 产出 <image>', () => {
    const emoji = renderIconSvg(EMOJI_ICONS[0]);
    expect(emoji).toContain('<text');
    expect(emoji).toContain(EMOJI_ICONS[0].char);

    const raster = renderIconSvg(RASTER_ICONS[0]);
    expect(raster).toContain('<image');
    expect(raster).toContain(RASTER_ICONS[0].url);
  });

  it('renderIconHtml 对 raster 产出 <img>，其余走 svg', () => {
    const html = renderIconHtml(RASTER_ICONS[0]);
    expect(html.startsWith('<img')).toBe(true);
    expect(html).toContain(`src="${RASTER_ICONS[0].url}"`);
    expect(renderIconHtml(EMOJI_ICONS[0]).startsWith('<svg')).toBe(true);
  });

  it('toIconRender 把三形态归一成渲染描述', () => {
    expect(toIconRender(findIcon('item.ore')!)).toMatchObject({ kind: 'svg-use', name: 'item.ore' });
    expect(toIconRender(EMOJI_ICONS[0])).toEqual({ kind: 'emoji', char: EMOJI_ICONS[0].char });
    expect(toIconRender(RASTER_ICONS[0])).toMatchObject({ kind: 'raster', url: RASTER_ICONS[0].url });
  });

  it('类型守卫按 source 收窄', () => {
    expect(isSvgIcon(findIcon('item.ore')!)).toBe(true);
    expect(isEmojiIcon(EMOJI_ICONS[0])).toBe(true);
    expect(isRasterIcon(RASTER_ICONS[0])).toBe(true);
  });
});

describe('图标校验 validateIcons', () => {
  const raster = (over: Partial<RasterIconDef>): IconDef => ({
    name: 'item.bad',
    source: 'raster',
    url: '/icons/item.bad.webp',
    format: 'webp',
    license: { spdx: 'CC-BY-4.0', author: 'Someone' },
    ...over,
  });

  it('本体 32 枚手绘 + 多形态示例全部通过', () => {
    expect(validateIcons(HAND_DRAWN_ICONS)).toEqual({ ok: true, errors: [] });
    expect(validateIcons(FORMAT_DEMO_ICONS)).toEqual({ ok: true, errors: [] });
  });

  it('raster 缺 license → 报错', () => {
    const errors = validateIcon({ ...raster({}), license: undefined } as unknown as IconDef);
    expect(errors.join('\n')).toContain('缺少 license');
  });

  it('raster url 非 /icons/ 前缀 → 报错', () => {
    const errors = validateIcon(raster({ url: '/assets/item.bad.webp' }));
    expect(errors.join('\n')).toContain('/icons/');
  });

  it('raster format 与扩展名不符 → 报错', () => {
    const errors = validateIcon(raster({ format: 'png', url: '/icons/item.bad.webp' }));
    expect(errors.join('\n')).toContain('扩展名不符');
  });

  it('emoji 缺 char → 报错', () => {
    const errors = validateIcon({ name: 'item.e', source: 'emoji', char: '' });
    expect(errors.join('\n')).toContain('缺少 char');
  });

  it('重名 → 报错；空 paths → 报错', () => {
    const result = validateIcons([
      { name: 'dup', source: 'hand-drawn', paths: [{ d: 'M0 0' }] },
      { name: 'dup', source: 'hand-drawn', paths: [{ d: 'M1 1' }] },
      { name: 'empty', source: 'hand-drawn', paths: [] },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('name 重复');
    expect(result.errors.join('\n')).toContain('paths 不能为空数组');
  });
});

describe('解析 IconRef', () => {
  it('内联手绘直接成型', () => {
    const res = resolveIconRef({
      name: 'skill.fletching',
      source: 'hand-drawn',
      def: { paths: [{ d: 'M0 0h24v24H0z' }] },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.icon.name).toBe('skill.fletching');
  });

  it('外部引用命中构建期表', () => {
    const external = {
      [externalKey('lucide', 'search')]: {
        name: 'lucide:search',
        source: 'lucide' as const,
        paths: [{ d: 'M1 1' }],
      },
    };
    const res = resolveIconRef(
      { name: 'ui.alt-search', source: 'lucide', iconName: 'search' },
      external,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.icon.name).toBe('ui.alt-search');
      expect(res.icon.paths[0].d).toBe('M1 1');
    }
  });

  it('外部引用缺失时可回退到同名手绘', () => {
    const res = resolveIconRef({ name: 'skill.mining', source: 'game-icons', iconName: 'pickaxe' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.icon.name).toBe('skill.mining');
  });

  it('外部引用与手绘都没有 → missing-external', () => {
    const res = resolveIconRef({ name: 'nope.thing', source: 'game-icons', iconName: 'nope' });
    expect(res.ok).toBe(false);
  });

  it('emoji 引用直接成型', () => {
    const res = resolveIconRef({ name: 'item.axe', source: 'emoji', char: '🪓' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(isEmojiIcon(res.icon)).toBe(true);
      if (isEmojiIcon(res.icon)) expect(res.icon.char).toBe('🪓');
    }
  });

  it('raster 引用带许可成型', () => {
    const res = resolveIconRef({
      name: 'item.gem',
      source: 'raster',
      url: '/icons/item.gem.webp',
      format: 'webp',
      license: { spdx: 'CC-BY-4.0', author: 'X' },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(isRasterIcon(res.icon)).toBe(true);
      if (isRasterIcon(res.icon)) expect(res.icon.license.spdx).toBe('CC-BY-4.0');
    }
  });

  it('raster 缺许可 → invalid-raster', () => {
    const res = resolveIconRef({
      name: 'item.gem',
      source: 'raster',
      url: '/icons/item.gem.webp',
      format: 'webp',
      license: undefined as never,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid-raster');
  });
});

describe('外部图标抽取', () => {
  it('把 DLC 引用抽成 sprite 并带署名元数据', () => {
    const result = extractIcons([
      { name: 'skill.fletching', source: 'game-icons', iconName: 'wood-beam' },
      { name: 'ui.alt-search', source: 'lucide', iconName: 'search' },
    ]);

    expect(result.missing).toEqual([]);
    expect(result.icons).toHaveLength(2);
    expect(result.sprite).toContain('<defs>');
    expect(result.sprite).toContain('<symbol id="skill.fletching"');
    expect(result.sprite).toContain('<symbol id="ui.alt-search"');

    // 用到了 game-icons 与 lucide，两者署名都要出现
    const sources = result.attributions.map((a) => a.source).sort();
    expect(sources).toEqual(['game-icons', 'lucide']);
    const gameIcons = result.attributions.find((a) => a.source === 'game-icons')!;
    expect(gameIcons.license).toBe('CC BY 3.0');
    expect(gameIcons.requiresAttribution).toBe(true);
    const lucide = result.attributions.find((a) => a.source === 'lucide')!;
    expect(lucide.license).toBe('ISC');
    expect(lucide.requiresAttribution).toBe(false);
  });

  it('内联手绘混入时不产生外部署名', () => {
    const result = extractIcons([
      { name: 'skill.mining', source: 'hand-drawn', def: { paths: [{ d: 'M0 0h24' }] } },
    ]);
    expect(result.icons).toHaveLength(1);
    expect(result.attributions).toEqual([]);
  });

  it('重复引用按 name 去重', () => {
    const result = extractIcons([
      { name: 'ui.search', source: 'lucide', iconName: 'search' },
      { name: 'ui.search', source: 'lucide', iconName: 'search' },
    ]);
    expect(result.icons).toHaveLength(1);
  });

  it('缺失引用进入 missing 且不产生 sprite symbol', () => {
    const result = extractIcons([
      { name: 'nope.thing', source: 'game-icons', iconName: 'nope' },
    ]);
    expect(result.missing).toEqual(['nope.thing']);
    expect(result.sprite).not.toContain('<symbol');
    expect(result.entries[0].ok).toBe(false);
  });

  it('本地表按 externalKey 命名，可被 merge 覆盖', () => {
    expect(LOCAL_EXTERNAL_TABLE['game-icons:wood-beam']).toBeDefined();
    const merged = mergeExternalTables(LOCAL_EXTERNAL_TABLE, {
      'game-icons:wood-beam': {
        name: 'game-icons:wood-beam',
        source: 'game-icons',
        paths: [{ d: 'M1 1' }],
      },
    });
    expect(merged['game-icons:wood-beam'].paths[0].d).toBe('M1 1');
  });

  it('署名元数据可单独按源取用', () => {
    expect(attributionFor('game-icons')).toBe(EXTERNAL_ATTRIBUTIONS['game-icons']);
    expect(EXTERNAL_ATTRIBUTIONS.lucide.homepage).toContain('lucide.dev');
    expect(EXTERNAL_ATTRIBUTIONS['game-icons'].credit).toContain('game-icons.net');
  });

  it('多形态引用：sprite 只含矢量，署名清单含位图素材', () => {
    const result = extractIcons([
      { name: 'skill.mining', source: 'hand-drawn', def: { paths: [{ d: 'M0 0h24' }] } },
      { name: 'item.axe', source: 'emoji', char: '🪓' },
      {
        name: 'item.gem',
        source: 'raster',
        url: '/icons/item.gem.webp',
        format: 'webp',
        license: { spdx: 'CC-BY-4.0', author: 'Someone' },
      },
    ]);

    expect(result.missing).toEqual([]);
    expect(result.icons).toHaveLength(3);
    expect(result.sprite).toContain('<symbol id="skill.mining"');
    expect(result.sprite).not.toContain('item.gem');
    expect(result.sprite).not.toContain('item.axe');

    // 外部库署名不出现（本批无外部引用）；位图署名出现且按许可聚合
    expect(result.attributions).toEqual([]);
    expect(result.materialAttributions).toHaveLength(1);
    expect(result.materialAttributions[0].spdx).toBe('CC-BY-4.0');
    expect(result.materialAttributions[0].icons).toEqual(['item.gem']);
    expect(result.validation.ok).toBe(true);
  });

  it('raster 缺许可的引用进入 missing 且校验失败', () => {
    const result = extractIcons([
      {
        name: 'item.nolicense',
        source: 'raster',
        url: '/icons/item.nolicense.png',
        format: 'png',
        license: undefined as never,
      },
    ]);
    expect(result.missing).toEqual(['item.nolicense']);
    expect(result.materialAttributions).toEqual([]);
  });

  it('aggregateMaterialAttributions 按许可归并同名素材', () => {
    const license = { spdx: LAZYCRAFT_LICENSE_SPDX, author: 'LazyCraft' };
    const list: IconDef[] = [
      { name: 'a', source: 'raster', url: '/icons/a.webp', format: 'webp', license },
      { name: 'b', source: 'raster', url: '/icons/b.png', format: 'png', license },
      { name: 'c', source: 'emoji', char: 'x' },
    ];
    const result = aggregateMaterialAttributions(list);
    expect(result).toHaveLength(1);
    expect(result[0].icons).toEqual(['a', 'b']);
    expect(result[0].credit).toContain('自绘');
  });
});
