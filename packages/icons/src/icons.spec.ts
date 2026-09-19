import { describe, expect, it } from 'vitest';
import {
  HAND_DRAWN_ICONS,
  findIcon,
  listIconsByDomain,
} from './catalog.js';
import { renderIconSymbol, renderIconSvg, renderSprite } from './render.js';
import { resolveIconRef, externalKey } from './resolve.js';

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
