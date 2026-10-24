// Fabric tab: how to lay the pieces on the fabric and how much to buy.
import { S, commit, garment, profileOf } from './store.js';
import { WIDTHS, GROUP_NAMES, groupOf, instances, pack, lengthOf, toBuy } from './layout.js';
import { pts, esc } from './render.js';
import { isMetric, fmt } from './units.js';
import * as io from './io.js';

const COLORS = ['#f4c7b4', '#c9dcef', '#cfe3c8', '#f6e3a8', '#e2d1ec', '#f2cfd8', '#cde8e4', '#ead8c4'];
const amount = (cm) => (isMetric() ? `${(cm / 100).toFixed(1)} m` : `${(cm / 91.44).toFixed(2).replace(/0$/, '')} yd`);
let drag = null;

function compute(g, opt, group) {
  const pieces = g.pieces.filter((p) => groupOf(p, g.type) === group);
  const usable = (opt.folded ? opt.width / 2 : opt.width) - 1; // keep clear of the selvedges
  const placed = pack(instances(pieces, { folded: opt.folded }), usable);
  const key = `${group}|${opt.width}|${opt.folded}`, moved = g.layoutMoves?.key === key ? g.layoutMoves.pos : {};
  for (const r of placed) if (moved[r.id]) Object.assign(r, moved[r.id]);
  return { placed, usable, key, len: lengthOf(placed) };
}

function fabricSVG(res, opt, { interactive = true } = {}) {
  const W = opt.folded ? opt.width / 2 : opt.width, L = Math.max(res.len + 10, 50), pad = 6;
  const colorOf = {}; let ci = 0;
  return `<svg class="fabric" viewBox="${-pad} ${-pad} ${W + pad * 2} ${L + pad * 2}" ${interactive ? '' : `style="width:100%;max-height:17cm"`}>
    <rect class="paper" x="0" y="0" width="${W}" height="${L}" fill="#fbfafc" stroke="#bdb5c7" stroke-width="0.3"/>
    <line x1="${W}" y1="0" x2="${W}" y2="${L}" stroke="#bdb5c7" stroke-width="1" stroke-dasharray="2 1.2"/>
    <text class="lbl" x="${W + 2}" y="${L / 2}" font-size="2.6" fill="#7b7486" transform="rotate(90 ${W + 2} ${L / 2})" text-anchor="middle">selvedge${opt.folded ? 's' : ''}</text>
    ${opt.folded ? `<line x1="0" y1="0" x2="0" y2="${L}" stroke="#2563eb" stroke-width="0.6" stroke-dasharray="3 1.5"/><text x="-2" y="${L / 2}" font-size="2.6" fill="#2563eb" transform="rotate(-90 -2 ${L / 2})" text-anchor="middle">fold</text>`
      : `<text class="lbl" x="-2" y="${L / 2}" font-size="2.6" fill="#7b7486" transform="rotate(-90 -2 ${L / 2})" text-anchor="middle">selvedge</text>`}
    ${res.placed.map((r) => {
      const c = colorOf[r.pid] ||= COLORS[ci++ % COLORS.length];
      return `<g ${interactive ? `data-inst="${r.id}"` : ''} transform="translate(${r.x},${r.y})" style="cursor:${interactive ? 'move' : 'default'}">
        ${r.polys.map((poly) => `<polygon points="${pts(poly)}" fill="${c}" stroke="${r.tooWide ? '#b42318' : '#5f5869'}" stroke-width="0.35"/>`).join('')}
        <text x="${r.w / 2}" y="${r.h / 2}" font-size="${Math.max(1.6, Math.min(4, r.w / 9))}" text-anchor="middle" dominant-baseline="central" fill="#241f2b" pointer-events="none">${esc(r.name)}${r.single ? ' (1 layer)' : ''}</text></g>`;
    }).join('')}
    <text class="lbl" x="${W / 2}" y="${L + 4}" font-size="3" text-anchor="middle" fill="#5f5869">${esc(fmt(res.len))} used</text>
  </svg>`;
}

export function renderLayout(el) {
  const g = garment();
  if (!g || !g.pieces.length) { el.innerHTML = '<div class="empty">Create a garment in <b>Design</b> first.</div>'; return; }
  const widths = WIDTHS[isMetric() ? 'metric' : 'imperial'];
  const opt = (S.project.fabric ||= { width: widths[2][0], folded: true });
  if (!widths.some((w) => w[0] === opt.width)) opt.width = widths[2][0];
  const groups = [...new Set(g.pieces.map((p) => groupOf(p, g.type)))];
  if (!groups.includes(S.layoutGroup)) S.layoutGroup = groups[0];
  const res = compute(g, opt, S.layoutGroup), buy = toBuy(res.len, isMetric());
  const tooWide = res.placed.filter((r) => r.tooWide);
  const interfacing = g.pieces.filter((p) => /facing|waistband|band/i.test(p.name) && !/pocket facing/i.test(p.name)).map((p) => p.name);
  el.innerHTML = `<div class="printwrap">
    <aside class="opts">
      <h3>Fabric & cutting layout</h3>
      <label class="row"><span>Fabric width</span><select data-f="width">${widths.map(([v, l]) => `<option value="${v}" ${v === opt.width ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="row"><span>Folded in half</span><input type="checkbox" data-f="folded" ${opt.folded ? 'checked' : ''}></label>
      ${groups.length > 1 ? `<div class="btns">${groups.map((gr) => `<button data-group="${gr}" class="${gr === S.layoutGroup ? 'primary' : ''}">${GROUP_NAMES[gr]}</button>`).join('')}</div>` : ''}
      <div class="buy"><small>${GROUP_NAMES[S.layoutGroup]}: buy</small><b>${amount(buy)}</b><small>of ${widths.find((w) => w[0] === opt.width)[1]} wide fabric (layout uses ${amount(res.len)})</small></div>
      ${tooWide.length ? `<div class="warn">⚠ ${tooWide.map((r) => esc(r.name)).join(', ')} ${tooWide.length > 1 ? "don't" : "doesn't"} fit across ${opt.folded ? 'the folded' : 'this'} fabric${opt.folded ? '. Try it unfolded, or a wider fabric.' : '. Join two widths, or use wider fabric.'}</div>` : ''}
      ${interfacing.length && S.layoutGroup === 'main' ? `<p class="tip"><b>Interfacing:</b> ${interfacing.map(esc).join(', ')}.</p>` : ''}
      <ul class="tip">
        <li>Pieces are placed with their grainline along the selvedge, all facing the same way, so this works for one-way prints and napped fabrics too.</li>
        ${opt.folded ? '<li>Fold the fabric lengthwise, selvedges together. Pieces on the blue line go on the fold. Everything else cuts a mirrored pair through both layers.</li>' : '<li>Single layer: cut each piece separately and flip the pattern over for the mirror pieces.</li>'}
        <li>Drag pieces to rearrange them. The amount updates.</li>
        <li>Allow extra fabric to match large checks or stripes.</li>
      </ul>
      <div class="btns"><button data-a="reset">Re-arrange</button><button data-a="print">${io.isApp ? 'Save layout as PDF' : 'Print layout'}</button></div>
    </aside>
    <section class="pv">${fabricSVG(res, opt)}</section></div>`;
  const svg = el.querySelector('svg.fabric');
  const toW = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  svg.onpointerdown = (e) => {
    const gEl = e.target.closest('[data-inst]');
    if (!gEl) return;
    const r = res.placed.find((x) => x.id === gEl.dataset.inst), m = toW(e);
    svg.setPointerCapture(e.pointerId);
    drag = { r, gEl, dx: m.x - r.x, dy: m.y - r.y };
  };
  svg.onpointermove = (e) => {
    if (!drag) return;
    const m = toW(e), W = res.usable;
    drag.r.x = drag.r.onFold ? 0 : Math.max(0, Math.min(W - drag.r.w, m.x - drag.dx)); drag.r.y = Math.max(0, m.y - drag.dy);
    drag.gEl.setAttribute('transform', `translate(${drag.r.x},${drag.r.y})`); drag.moved = true;
  };
  svg.onpointerup = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) return;
    if (g.layoutMoves?.key !== res.key) g.layoutMoves = { key: res.key, pos: {} };
    g.layoutMoves.pos[d.r.id] = { x: d.r.x, y: d.r.y };
    commit();
  };
  el.onchange = (e) => {
    const f = e.target.dataset.f;
    if (f === 'width') opt.width = +e.target.value;
    if (f === 'folded') opt.folded = e.target.checked;
    commit();
  };
  el.onclick = (e) => {
    const gr = e.target.dataset.group, a = e.target.dataset.a;
    if (gr) { S.layoutGroup = gr; renderLayout(el); }
    if (a === 'reset') { g.layoutMoves = null; commit(); }
    if (a === 'print') {
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(g.name)} layout</title>
        <style>@page{size:29.7cm 21cm;margin:1.2cm} body{font-family:"Segoe UI",Helvetica,Arial,sans-serif;margin:0} h1{font-size:16pt;margin:0 0 .2cm} p{margin:0 0 .3cm;color:#444}</style></head><body>
        <h1>${esc(g.name)}: cutting layout</h1><p>${GROUP_NAMES[S.layoutGroup]}: buy <b>${amount(buy)}</b> of ${widths.find((w) => w[0] === opt.width)[1]} fabric, ${opt.folded ? 'folded in half lengthwise' : 'single layer'}. Measurements: ${esc(profileOf(g).name)}.</p>
        ${fabricSVG(res, opt, { interactive: false })}</body></html>`;
      io.makePDF(html, `${g.name} layout`);
    }
  };
}
