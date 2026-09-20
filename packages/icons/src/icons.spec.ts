import { describe, expect, it } from 'vitest';
import {
  HAND_DRAWN_ICONS,
  findIcon,
  listIconsByDomain,
} from './catalog.js';
import { renderIconSymbol, renderIconSvg, renderSprite } from './render.js';
import { resolveIconRef, externalKey } from './resolve.js';
import { extractIcons } from './external/extract.js';
import { LOCAL_EXTERNAL_TABLE, mergeExternalTables } from './external/table.js';
import { EXTERNAL_ATTRIBUTIONS, attributionFor } from './external/attribution.js';

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
});
