/**
 * 图标图库页生成器（task-31）。
 *
 * 为什么用"生成式"而不是运行时快照？
 *   图库页的全部价值在于"与真实图标目录不漂移"。手写 SVG 或内联 JSON 快照
 *   都会在 catalog.ts 改动后悄悄过期；这里直接 import 库的构建产物，
 *   每次 `node scripts/gen-icon-gallery.mjs` 都把目录重新投影成静态页，
 *   产物是纯 HTML（预览服务零依赖、可直接托管）。
 *
 * 为什么读包内相对路径而不是裸包名？
 *   脚本以 `node scripts/...` 从 repo 根运行，不经过 pnpm workspace 解析；
 *   相对 import 到 `packages/icons/dist` 最稳，也避免脚本反向依赖 workspace 链接。
 *
 * 位图示例为什么内联成 data URI？
 *   库里的 raster.url 指向 `/icons/...`（Vite public / nginx 同源）；
 *   而图库页托管在 `docs/UI原型/` 下，该前缀在此不成立。
 *   把素材字节内联后页面自包含、离线也不产生 404，同时原 url 仍如实标注，
 *   不会与库的登记值产生语义分叉。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const ICONS_DIST = join(REPO_ROOT, 'packages/icons/dist/index.js');
const RASTER_DIR = join(REPO_ROOT, 'apps/web/public');
const OUT_FILE = join(REPO_ROOT, 'docs/UI原型/icons.html');

const {
  HAND_DRAWN_ICONS,
  EMOJI_ICONS,
  RASTER_ICONS,
  FORMAT_DEMO_ICONS,
  listIconsByDomain,
  renderSprite,
  renderIconSvg,
  EXTERNAL_ATTRIBUTIONS,
  aggregateMaterialAttributions,
  LAZYCRAFT_LICENSE_SPDX,
} = await import(pathToFileURL(ICONS_DIST).href);

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const escAttr = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escText = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

/** 位图素材内联为 data URI；文件缺失时退回库登记的 url（并告警，提示漂移） */
function rasterDataUri(icon) {
  try {
    const bytes = readFileSync(join(RASTER_DIR, icon.url.replace(/^\//, '')));
    return `data:${MIME[icon.format]};base64,${bytes.toString('base64')}`;
  } catch {
    console.warn(`[icon-gallery] 位图素材缺失，回退为登记的 url：${icon.url}`);
    return icon.url;
  }
}

/* ------------------------------------------------------------------ */
/* 分组（域标签与顺序都来自库的目录顺序）                                */
/* ------------------------------------------------------------------ */

const DOMAINS = [
  { key: 'skill', label: '技能', note: '左栏技能导航、工作卡片标题' },
  { key: 'item', label: '物品', note: '背包格、仓库、工作产出徽章' },
  { key: 'slot', label: '装备槽', note: '个人信息页人体图锚点（10 槽）' },
  { key: 'ui', label: '界面', note: '顶栏与功能按钮零件' },
];

/** 单枚手绘图标卡片：图标 + 名字 + 所属域 + 目录内序号 */
function svgCard(icon, order, domainLabel) {
  return `<article class="g-card" data-name="${escAttr(icon.name)}">
  <div class="g-ico"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#${escAttr(icon.name)}"/></svg></div>
  <div class="g-meta">
    <span class="g-name">${escText(icon.name)}</span>
    <span class="g-tags"><em class="g-tag">${escText(domainLabel)}</em><span class="g-order">目录 #${order}</span></span>
  </div>
</article>`;
}

function emojiCard(icon, order) {
  return `<article class="g-card" data-name="${escAttr(icon.name)}">
  <div class="g-ico">${renderIconSvg(icon, 'i')}</div>
  <div class="g-meta">
    <span class="g-name">${escText(icon.name)}</span>
    <span class="g-tags"><em class="g-tag">emoji</em><span class="g-order">示例 #${order}</span></span>
    <span class="g-note">字符 ${escText(icon.char)} · 零素材占位</span>
  </div>
</article>`;
}

function rasterCard(icon, order) {
  return `<article class="g-card" data-name="${escAttr(icon.name)}">
  <div class="g-ico"><img class="g-img" src="${escAttr(rasterDataUri(icon))}" alt="${escAttr(icon.name)}" /></div>
  <div class="g-meta">
    <span class="g-name">${escText(icon.name)}</span>
    <span class="g-tags"><em class="g-tag">${escText(icon.format)}</em><span class="g-order">示例 #${order}</span></span>
    <span class="g-note">${escText(icon.url)}</span>
  </div>
</article>`;
}

function section({ key, title, keyLabel, note, total, cards }) {
  return `<section class="g-section" data-domain="${escAttr(key)}" data-total="${total}">
  <div class="g-sec-head">
    <h2 class="serif">${escText(title)} <span class="g-sec-key">${escText(keyLabel)}</span></h2>
    <span class="g-sec-count" data-count>${total} 枚</span>
  </div>
  <p class="g-sec-note">${escText(note)}</p>
  <div class="g-grid">
${cards.join('\n')}
  </div>
</section>`;
}

/* ------------------------------------------------------------------ */
/* 组装                                                                */
/* ------------------------------------------------------------------ */

const sprite = renderSprite([...HAND_DRAWN_ICONS, ...EMOJI_ICONS, ...RASTER_ICONS]);

const handSections = DOMAINS.map(({ key, label, note }) => {
  const icons = listIconsByDomain(key);
  return section({
    key,
    title: label,
    keyLabel: `${key}.*`,
    note,
    total: icons.length,
    cards: icons.map((icon, i) => svgCard(icon, i + 1, label)),
  });
});

const formatCards = [
  ...EMOJI_ICONS.map((icon, i) => emojiCard(icon, i + 1)),
  ...RASTER_ICONS.map((icon, i) => rasterCard(icon, i + 1)),
];
const formatSection = section({
  key: 'format-demo',
  title: '多形态示例',
  keyLabel: 'emoji / raster',
  note: '任务 35 引入的另两种形态：emoji 零素材兜底，位图为随包素材（此处内联展示，登记 url 见卡片）',
  total: formatCards.length,
  cards: formatCards,
});

const handCount = HAND_DRAWN_ICONS.length;
const totalCount = handCount + EMOJI_ICONS.length + RASTER_ICONS.length;

const externalRows = Object.values(EXTERNAL_ATTRIBUTIONS)
  .map(
    (a) => `<li>
      <b>${escText(a.source)}</b>
      <span class="g-lic">${escText(a.license)}${a.requiresAttribution ? ' · 需署名' : ' · 免署名（仍列出）'}</span>
      <span class="g-attr-credit">${escText(a.credit)}</span>
      <span class="g-attr-link">${escText(a.homepage)} · ${escText(a.licenseUrl)}</span>
    </li>`,
  )
  .join('\n');

const materialRows = aggregateMaterialAttributions(FORMAT_DEMO_ICONS)
  .map(
    (m) => `<li>
      <b>${escText(m.spdx)}</b>
      <span class="g-lic">${escText(m.credit)}</span>
      <span class="g-attr-credit">素材：${escText(m.icons.join('、'))}</span>
      ${m.author ? `<span class="g-attr-link">作者 ${escText(m.author)}${m.source ? ` · ${escText(m.source)}` : ''}</span>` : ''}
    </li>`,
  )
  .join('\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LazyCraft · 图标图库（@lazycraft/icons）</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%234a3728'/%3E%3Cpath d='M12 4c2.6 3.9 4.7 6.1 4.7 9.1a4.7 4.7 0 11-9.4 0c0-1.9.9-3.5 2.3-5.2.7 1.2 1.4 1.7 2.2 1.7 0-1.9-.4-3.5.2-5.6z' fill='none' stroke='%23e6dcc6' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E" />
<style>
  /* 令牌与 docs/UI原型/index.html、styles.html 的「匠人工坊」保持同源 */
  :root {
    --paper: #e6dcc6; --paper-2: #efe6d3; --paper-3: #dbcfb4;
    --wood: #4a3728; --wood-2: #5a4634; --wood-3: #7a6549;
    --ink: #241a12; --brass: #c08226; --brass-2: #9c6c1b; --brass-weak: #eddfc0;
    --line: #c9b795; --line-2: #b5a077;
    --radius: 7px;
    --shadow-1: inset 0 0 0 1px #fff, 0 1px 0 rgba(92,70,50,.12);
  }
  .serif { font-family: "Songti SC", "Noto Serif SC", Georgia, serif; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    color: var(--ink);
    font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    font-size: 14px; line-height: 1.5;
    background:
      radial-gradient(circle at 22% 10%, rgba(201,138,43,.07), transparent 42%),
      repeating-linear-gradient(0deg, rgba(92,70,50,.022) 0 1px, transparent 1px 4px),
      var(--paper);
    -webkit-font-smoothing: antialiased;
    padding: 20px 24px 44px;
  }
  .g-wrap { max-width: 1720px; margin: 0 auto; }

  /* 手绘图标：黄铜雕刻线 + 白高光，与 index.html 的 svg.i 一致 */
  svg.i { display: block; fill: none; stroke: currentColor; stroke-width: 1.7;
    stroke-linecap: round; stroke-linejoin: round;
    filter: drop-shadow(0 1px 0 rgba(255,255,255,.85)); }
  /* emoji 是文本节点，必须显式回填 fill：否则会继承上面的 fill:none 而被描成空心 */
  .g-ico svg.i text { fill: currentColor; stroke: none; }

  /* 页头 */
  .g-head { display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 12px; padding-bottom: 14px; margin-bottom: 4px;
    border-bottom: 2px solid var(--wood); }
  .g-brand { display: flex; align-items: center; gap: 12px; }
  .brand-mark { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center;
    color: var(--paper-2); background: linear-gradient(145deg,#6b5540,#4a3729);
    border: 1px solid #3a2b1f; box-shadow: inset 0 1px 0 rgba(255,255,255,.2); flex-shrink: 0; }
  .brand-mark svg.i { width: 19px; height: 19px; filter: none; }
  .g-head h1 { font-size: 21px; color: var(--wood); margin: 0; }
  .g-sub { font-size: 12.5px; color: var(--wood-3); }
  .g-stats { display: flex; gap: 8px; flex-wrap: wrap; }
  .g-chip { display: flex; align-items: center; gap: 7px; padding: 5px 12px;
    background: var(--paper-2); border: 1px solid var(--line); border-radius: 6px;
    box-shadow: inset 0 1px 0 #fff; font-size: 12.5px; color: var(--wood-2); }
  .g-chip b { font-variant-numeric: tabular-nums; color: var(--ink); }

  /* 生成提示：图库页是产物，改动一律回源 */
  .g-notice { margin: 12px 0 16px; padding: 9px 13px; font-size: 12.5px; color: var(--wood-2);
    background: var(--brass-weak); border: 1px solid var(--line-2); border-left: 3px solid var(--brass);
    border-radius: 5px; box-shadow: inset 0 1px 0 rgba(255,255,255,.6); }
  .g-notice code { font-family: Consolas, "Courier New", monospace; font-size: 12px;
    background: rgba(255,255,255,.55); padding: 0 4px; border-radius: 3px; }

  /* 过滤条 */
  .g-toolbar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 12px;
    padding: 10px 0; margin-bottom: 6px;
    background: linear-gradient(180deg, var(--paper) 68%, rgba(230,220,198,0)); }
  .g-search { position: relative; flex: 0 1 380px; }
  .g-search input { width: 100%; padding: 8px 11px 8px 33px; border: 1px solid var(--line-2);
    border-radius: 6px; background: var(--paper-2); color: var(--ink); font-size: 13px; outline: none;
    box-shadow: inset 0 1px 2px rgba(92,70,50,.08); }
  .g-search input:focus { border-color: var(--brass); }
  .g-search svg.i { position: absolute; left: 10px; top: 9px; width: 15px; height: 15px;
    color: var(--wood-3); filter: none; }
  .g-visible { font-size: 12.5px; color: var(--wood-3); }
  .g-visible b { color: var(--ink); font-variant-numeric: tabular-nums; }

  /* 分组 */
  .g-section { background: var(--paper-2); border: 1px solid var(--line); border-radius: var(--radius);
    box-shadow: var(--shadow-1); padding: 15px 17px 17px; margin-bottom: 16px; }
  .g-sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .g-sec-head h2 { font-size: 16px; color: var(--wood); margin: 0;
    background-image: linear-gradient(90deg, var(--brass) 0%, rgba(192,130,38,.4) 62%, transparent 100%);
    background-size: 100% 3px; background-position: 0 100%; background-repeat: no-repeat;
    padding-bottom: 6px; }
  .g-sec-key { font-family: Consolas, "Courier New", monospace; font-size: 11.5px; font-weight: 400;
    color: var(--wood-3); letter-spacing: 0; }
  .g-sec-count { font-size: 12px; color: var(--brass-2); font-weight: 600;
    font-variant-numeric: tabular-nums; white-space: nowrap; }
  .g-sec-note { font-size: 12px; color: var(--wood-3); margin: 8px 0 12px; }

  .g-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(214px, 1fr)); gap: 9px; }
  .g-card { display: flex; align-items: center; gap: 10px; min-width: 0;
    padding: 8px 10px; background: var(--paper-2); border: 1px solid var(--line);
    border-radius: 6px; box-shadow: var(--shadow-1); }
  .g-card:hover { border-color: var(--brass); }
  .g-card[hidden] { display: none; }
  .g-ico { width: 42px; height: 42px; flex-shrink: 0; display: grid; place-items: center;
    background: var(--paper-3); border: 1px solid var(--line-2); border-radius: 6px;
    color: var(--wood-2); box-shadow: inset 0 1px 0 rgba(255,255,255,.5); overflow: hidden; }
  .g-ico svg.i { width: 26px; height: 26px; }
  .g-img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .g-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .g-name { font-family: Consolas, "Courier New", monospace; font-size: 12px; font-weight: 600;
    color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .g-tags { display: flex; align-items: center; gap: 6px; }
  .g-tag { font-style: normal; font-size: 10.5px; padding: 1px 6px; border-radius: 4px;
    background: var(--brass-weak); border: 1px solid var(--line-2); color: var(--brass-2); }
  .g-order { font-size: 10.5px; color: var(--wood-3); font-variant-numeric: tabular-nums; }
  .g-note { font-size: 10.5px; color: var(--wood-3); white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; }

  /* 署名区 */
  .g-attr { background: var(--paper-2); border: 1px solid var(--line); border-radius: var(--radius);
    box-shadow: var(--shadow-1); padding: 15px 17px 17px; }
  .g-attr h2 { font-size: 16px; color: var(--wood); margin: 0 0 10px; }
  .g-attr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 12px; }
  .g-attr-box { border: 1px solid var(--line); border-radius: 6px; padding: 11px 13px;
    background: #fffdf8; }
  .g-attr-box h3 { font-family: "Songti SC", serif; font-size: 13.5px; color: var(--wood);
    margin: 0 0 7px; }
  .g-attr-box ul { list-style: none; margin: 0; padding: 0; }
  .g-attr-box li { display: flex; flex-direction: column; gap: 1px; padding: 7px 0; font-size: 12px; }
  .g-attr-box li + li { border-top: 1px dashed var(--line); }
  .g-attr-box b { color: var(--ink); font-family: Consolas, "Courier New", monospace; font-size: 12px; }
  .g-lic { color: var(--brass-2); font-size: 11.5px; }
  .g-attr-credit { color: var(--wood-2); }
  .g-attr-link { color: var(--wood-3); font-size: 11px; word-break: break-all; }
  .g-attr-foot { font-size: 11.5px; color: var(--wood-3); margin: 11px 0 0; }
</style>
</head>
<body>
<div class="g-wrap">

  <header class="g-head">
    <div class="g-brand">
      <span class="brand-mark"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#ui.flame-brand"/></svg></span>
      <div>
        <h1 class="serif">图标图库</h1>
        <div class="g-sub">数据源 @lazycraft/icons · 本体全部真实图标，便于逐个体检 / 修改</div>
      </div>
    </div>
    <div class="g-stats">
      <span class="g-chip">手绘 <b>${handCount}</b></span>
      <span class="g-chip">emoji <b>${EMOJI_ICONS.length}</b></span>
      <span class="g-chip">位图 <b>${RASTER_ICONS.length}</b></span>
      <span class="g-chip">合计 <b>${totalCount}</b></span>
    </div>
  </header>

  <div class="g-notice">
    本页由 <code>scripts/gen-icon-gallery.mjs</code> 从 <code>@lazycraft/icons</code> 构建产物生成，<b>勿手改</b>。
    图标增删或改形状后，重新运行 <code>node scripts/gen-icon-gallery.mjs</code> 即可刷新。
    想精修图标请改 <code>packages/icons/src/catalog.ts</code>（全站引用自动生效）。
  </div>

  <div class="g-toolbar">
    <label class="g-search">
      <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#ui.search"/></svg>
      <input id="g-filter" type="search" placeholder="按名过滤，如 skill. / mining / demo" autocomplete="off" />
    </label>
    <span class="g-visible">显示 <b id="g-visible">${totalCount}</b> / ${totalCount} 枚</span>
  </div>

${sprite}

${handSections.join('\n')}

${formatSection}

  <footer class="g-attr">
    <h2 class="serif">署名 / 许可（对应 docs/06 §九）</h2>
    <div class="g-attr-grid">
      <div class="g-attr-box">
        <h3>外部图标库（仅供 DLC 引用，本体当前未使用）</h3>
        <ul>
${externalRows}
        </ul>
      </div>
      <div class="g-attr-box">
        <h3>位图素材（随包发布，许可随素材登记）</h3>
        <ul>
${materialRows}
        </ul>
      </div>
    </div>
    <p class="g-attr-foot">
      本体手绘图标为项目自有（SPDX <b>${escText(LAZYCRAFT_LICENSE_SPDX)}</b>），无需外部署名。
      禁止无许可来源的位图进入仓库：构建期缺 <code>license</code> 即失败（packages/icons 的 validate）。
      外部库真实素材的构建期抽取脚本与本地表仍待补齐（见 docs/07 §三）。
    </p>
  </footer>

</div>

<script>
(function () {
  var input = document.getElementById('g-filter');
  var out = document.getElementById('g-visible');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.g-card'));
  var sections = Array.prototype.slice.call(document.querySelectorAll('.g-section'));
  var total = cards.length;

  function apply() {
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (card) {
      var hit = !q || card.getAttribute('data-name').toLowerCase().indexOf(q) !== -1;
      card.hidden = !hit;
      if (hit) shown += 1;
    });
    sections.forEach(function (sec) {
      var visible = sec.querySelectorAll('.g-card:not([hidden])').length;
      sec.hidden = visible === 0;
      var badge = sec.querySelector('[data-count]');
      if (badge) badge.textContent = q ? visible + ' / ' + sec.getAttribute('data-total') : sec.getAttribute('data-total') + ' 枚';
    });
    out.textContent = String(shown);
  }

  input.addEventListener('input', apply);
  apply();
})();
</script>
</body>
</html>
`;

writeFileSync(OUT_FILE, html, 'utf8');
console.log(
  `[icon-gallery] 已生成 ${OUT_FILE.replace(REPO_ROOT + '\\', '')}：` +
    `手绘 ${handCount} + emoji ${EMOJI_ICONS.length} + 位图 ${RASTER_ICONS.length} = ${totalCount} 枚`,
);
