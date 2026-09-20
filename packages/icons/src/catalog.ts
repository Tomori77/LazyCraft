/**
 * 本体手绘图标目录 —— 匠人工坊风格。
 *
 * 命名规范：`<域>.<概念>`，域用 skill / item / slot / ui。
 *   消费端（前端/内容包）只认 name，不认文件位置；
 *   想精修某个图标，改本文件对应条目即可，全站引用自动生效。
 *
 * 绘制风格：24×24 视口、1.7 描边、圆头圆角；`fill: true` 的路径用于挖空高光。
 * 这些是初版样式稿，比例与细节可后续迭代（见 docs/07-UI风格与图标系统.md）。
 */

import type { IconPath, SvgIconDef } from './types.js';

/** 描边路径简写（最常用） */
const s = (d: string): IconPath => ({ d });
/** 填充路径简写（挖空/实心块） */
const f = (d: string): IconPath => ({ d, fill: true });

/* ------------------------------------------------------------------ */
/* 技能                                                                */
/* ------------------------------------------------------------------ */

const SKILL_ICONS: ReadonlyArray<SvgIconDef> = [
  { name: 'skill.attack', source: 'hand-drawn', paths: [
    s('M12 2.5l2.3 2.3V14L12 16.3 9.7 14V4.8z'), s('M7 15.3h10'), s('M12 16.3v5'),
  ] },
  { name: 'skill.mining', source: 'hand-drawn', paths: [
    s('M4.5 8.6C8 6.3 16 6.3 19.5 8.6'), s('M12 7.6V20.5'),
  ] },
  { name: 'skill.woodcutting', source: 'hand-drawn', paths: [
    s('M6 20.5L14.5 9'),
    s('M13.5 4.2c3.6.5 6.3 2.6 7.3 6.2-2.6 1.5-5.3 1.7-7.2.6-1.3-2.1-1.3-4.5-.1-6.8z'),
  ] },
  { name: 'skill.fishing', source: 'hand-drawn', paths: [
    s('M20.5 12c-3 4-8.5 5-13 2.8L3 17l.8-5L3 7l4.5 2.2C12 7 17.5 8 20.5 12z'),
    f('M17.1 10.9a1.1 1.1 0 11-2.2 0 1.1 1.1 0 012.2 0z'),
  ] },
  { name: 'skill.firemaking', source: 'hand-drawn', paths: [
    s('M12 3.5c3 4.5 5.5 7 5.5 10.5a5.5 5.5 0 11-11 0c0-2.2 1-4 2.6-6 .8 1.4 1.6 2 2.5 2 0-2.2-.4-4 .4-6.5z'),
  ] },
];

/* ------------------------------------------------------------------ */
/* 物品                                                                */
/* ------------------------------------------------------------------ */

const ITEM_ICONS: ReadonlyArray<SvgIconDef> = [
  { name: 'item.ore', source: 'hand-drawn', paths: [
    s('M12 3l7 4.5v9L12 21l-7-4.5v-9z'), s('M12 3v18M5 7.5l7 4.5 7-4.5'),
  ] },
  { name: 'item.log', source: 'hand-drawn', paths: [
    s('M8 4h8a3 3 0 013 3v10a3 3 0 01-3 3H8a3 3 0 01-3-3V7a3 3 0 013-3z'),
    s('M15.4 12a3.4 3.4 0 11-6.8 0 3.4 3.4 0 016.8 0z'),
  ] },
  { name: 'item.stone', source: 'hand-drawn', paths: [
    s('M7 6l5-2.5L19 6l2 6-3.5 7h-9L4 12z'), s('M7 6l5 4 7-4'),
  ] },
  { name: 'item.ingot', source: 'hand-drawn', paths: [
    s('M7 7h10l3 10H4z'), s('M6.5 10h11'),
  ] },
  { name: 'item.feather', source: 'hand-drawn', paths: [
    s('M19 5c-6 .5-10 4-11.5 9.5L5 19'), s('M8.5 14.5L19 5'),
    s('M9.5 12.5l-2.5-.5M11.5 10l-1-2.5M13.5 8l-.3-2'),
  ] },
  { name: 'item.charcoal', source: 'hand-drawn', paths: [
    s('M8 9l4-4 4 3-1 6-5 2-3-3z'), s('M6 14l3 5 4-1 3 3'),
  ] },
  { name: 'item.coin', source: 'hand-drawn', paths: [
    s('M20 12a8 8 0 11-16 0 8 8 0 0116 0z'), s('M12 8v8M9.5 10h5M9.5 14h5'),
  ] },
  { name: 'item.gem', source: 'hand-drawn', paths: [
    s('M7 4h10l3 5-8 11L4 9z'), s('M4 9h16M8 4l-1 5 5 11M16 4l1 5-5 11'),
  ] },
  { name: 'item.plank', source: 'hand-drawn', paths: [
    s('M3 8h18v8H3z'), s('M3 12h18M8 8v8M16 8v8'),
  ] },
];

/* ------------------------------------------------------------------ */
/* 装备槽                                                              */
/* ------------------------------------------------------------------ */

const SLOT_ICONS: ReadonlyArray<SvgIconDef> = [
  { name: 'slot.helmet', source: 'hand-drawn', paths: [
    s('M5 14a7 7 0 0114 0v3H5z'), s('M12 7v10'),
  ] },
  { name: 'slot.necklace', source: 'hand-drawn', paths: [
    s('M6 5c0 5 2.7 8 6 8s6-3 6-8'), s('M14.2 16a2.2 2.2 0 11-4.4 0 2.2 2.2 0 014.4 0z'),
  ] },
  { name: 'slot.main_hand', source: 'hand-drawn', paths: [
    s('M12 2.5l2.3 2.3V14L12 16.3 9.7 14V4.8z'), s('M7 15.3h10'), s('M12 16.3v5'),
  ] },
  { name: 'slot.off_hand', source: 'hand-drawn', paths: [
    s('M12 3l7 2.5v6c0 4-3 7-7 9-4-2-7-5-7-9v-6z'),
  ] },
  { name: 'slot.chest', source: 'hand-drawn', paths: [
    s('M7 9l5-4 5 4v6l-5 4-5-4z'), s('M7 9l5 3 5-3M12 12v7'),
  ] },
  { name: 'slot.legs', source: 'hand-drawn', paths: [
    s('M9 4h6v7l-1.5 9h-3L9 11z'), s('M12 11v9'),
  ] },
  { name: 'slot.hands', source: 'hand-drawn', paths: [
    s('M8 20V9a2 2 0 014 0V5a1.5 1.5 0 013 0v4'),
    s('M15 9a1.5 1.5 0 013 0v7a4 4 0 01-4 4h-2'),
  ] },
  { name: 'slot.feet', source: 'hand-drawn', paths: [
    s('M9 4v9l-2 4a2 2 0 002 2h6a2 2 0 002-2V4'), s('M9 4h6'),
  ] },
  { name: 'slot.ring1', source: 'hand-drawn', paths: [
    s('M17 14a5 5 0 11-10 0 5 5 0 0110 0z'), s('M9.5 9.5L12 5l2.5 4.5'),
  ] },
  { name: 'slot.ring2', source: 'hand-drawn', paths: [
    s('M17 14a5 5 0 11-10 0 5 5 0 0110 0z'), s('M9.5 9.5L12 5l2.5 4.5'),
  ] },
];

/* ------------------------------------------------------------------ */
/* 界面零件                                                            */
/* ------------------------------------------------------------------ */

const UI_ICONS: ReadonlyArray<SvgIconDef> = [
  { name: 'ui.settings', source: 'hand-drawn', paths: [
    s('M15 12a3 3 0 11-6 0 3 3 0 016 0z'),
    s('M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4'),
  ] },
  { name: 'ui.search', source: 'hand-drawn', paths: [
    s('M17 11a6 6 0 11-12 0 6 6 0 0112 0z'), s('M15.5 15.5L20 20'),
  ] },
  { name: 'ui.close', source: 'hand-drawn', paths: [ s('M6 6l12 12M18 6L6 18') ] },
  { name: 'ui.user', source: 'hand-drawn', paths: [
    s('M15.6 8a3.6 3.6 0 11-7.2 0 3.6 3.6 0 017.2 0z'), s('M5 20c0-3.6 3-6 7-6s7 2.4 7 6'),
  ] },
  { name: 'ui.shop', source: 'hand-drawn', paths: [
    s('M4 9l1.5-5h13L20 9M4 9h16v10H4z'),
    s('M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3'),
  ] },
  { name: 'ui.logout', source: 'hand-drawn', paths: [
    s('M14 4H6v16h8M10 12h11M18 8l4 4-4 4'),
  ] },
  { name: 'ui.flame-brand', source: 'hand-drawn', paths: [
    s('M12 3.5c3 4.5 5.5 7 5.5 10.5a5.5 5.5 0 11-11 0c0-2.2 1-4 2.6-6 .8 1.4 1.6 2 2.5 2 0-2.2-.4-4 .4-6.5z'),
  ] },
];

/** 本体全部手绘图标（顺序即图库页展示顺序） */
export const HAND_DRAWN_ICONS: ReadonlyArray<SvgIconDef> = [
  ...SKILL_ICONS,
  ...ITEM_ICONS,
  ...SLOT_ICONS,
  ...UI_ICONS,
];

/** 按名字索引，避免每次线性查找 */
const BY_NAME: ReadonlyMap<string, SvgIconDef> = new Map(
  HAND_DRAWN_ICONS.map((icon) => [icon.name, icon]),
);

/** 按名字取图标；不存在返回 undefined（调用方决定回退策略） */
export function findIcon(name: string): SvgIconDef | undefined {
  return BY_NAME.get(name);
}

/** 按域列出图标（域 = name 的第一段，如 'skill' / 'item'） */
export function listIconsByDomain(domain: string): SvgIconDef[] {
  return HAND_DRAWN_ICONS.filter((icon) => icon.name.startsWith(`${domain}.`));
}
