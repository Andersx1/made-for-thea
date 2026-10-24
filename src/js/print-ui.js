// Print tab: paper settings, page preview, and PDF output.
import { S, commit, garment, profileOf, arrange } from './store.js';
import { PAPERS, tiles, printHTML } from './print.js';
import { pieceSVG, esc } from './render.js';
import { isMetric } from './units.js';
import { stepsFor } from './steps.js';
import * as io from './io.js';
import { openProjector } from './projector.js';

// Try packing 1–6 pages wide and keep the arrangement that prints the fewest pages.
function fewestPages(g, o, pw) {
  let best = null;
  for (let n = 1; n <= 6; n++) {
    const c = structuredClone(g);
    arrange(c, n * pw - 1, { rotate: true, gap: 1.5 });
    const pages = tiles(c.pieces, o).printed;
    if (!best || pages < best.pages) best = { pages, pieces: c.pieces };
  }
  return best.pieces;
}

export function renderPrint(el) {
  const g = garment();
  if (!g || !g.pieces.length) { el.innerHTML = '<div class="empty">Create a garment in <b>Design</b> first.</div>'; return; }
  const o = (S.project.print ||= { paper: /-US$/.test(navigator.language) ? 'letter' : 'a4', landscape: false, skipBlank: true });
  const T = tiles(g.pieces, o), copyShop = !PAPERS[o.paper].h || o.paper === 'a0';
  el.innerHTML = `<div class="printwrap">
    <aside class="opts">
      <h3>Print the pattern</h3>
      <label class="row"><span>Paper</span><select data-f="paper">${Object.entries(PAPERS).map(([k, p]) => `<option value="${k}" ${k === o.paper ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
      ${PAPERS[o.paper].h ? `<label class="row"><span>Orientation</span><select data-f="landscape"><option value="">Portrait</option><option value="1" ${o.landscape ? 'selected' : ''}>Landscape</option></select></label>` : ''}
      <label class="row"><span>Skip empty pages</span><input type="checkbox" data-f="skipBlank" ${o.skipBlank ? 'checked' : ''}></label>
      <p class="stat"><b>${T.printed}</b> page${T.printed === 1 ? '' : 's'} + 1 cover page${copyShop ? '' : ` (${T.cols} across × ${T.rows} down)`}</p>
      ${copyShop ? '' : `<h4>Use less paper</h4><p class="tip">Re-arranges the pieces (turning some sideways) to print on the fewest pages.</p>
        <div class="btns"><button data-a="pack">Arrange for fewest pages</button></div>`}
      <div class="btns"><button class="primary big" data-a="pdf">${io.isApp ? 'Save as PDF' : 'Open print view'}</button></div>
      <h4>No printer?</h4><p class="tip">Use a projector mounted above the table to shine the pattern straight onto the fabric. Calibrate once with the 10 cm square.</p>
      <div class="btns"><button data-a="projector">📽 Projector mode</button></div>
      <ul class="tip"><li>Print at <b>100% / Actual size</b>, never "Fit to page".</li><li>Measure the test square on the cover page first.</li><li>The cover page shows how the pages tape together.</li></ul>
    </aside>
    <section class="pv"><svg class="preview" viewBox="${T.x0 - 2} ${T.y0 - 2} ${T.cols * T.pw + 4} ${T.rows * T.ph + 4}">
      ${T.list.map((t) => `<rect class="${t.print ? 'paper' : 'blank'}" x="${t.x}" y="${t.y}" width="${T.pw}" height="${T.ph}" fill="${t.print ? '#fff' : '#eeeaf1'}" stroke="#cfc8d7" stroke-width="${T.pw / 150}"/>`).join('')}
      ${g.pieces.map((p) => `<g transform="translate(${p.pos.x},${p.pos.y})">${pieceSVG(p, { k: T.pw / 200 })}</g>`).join('')}
      ${T.list.map((t) => `<text x="${t.x + T.pw / 2}" y="${t.y + T.ph / 2}" font-size="${Math.min(T.pw, T.ph) / 4}" text-anchor="middle" dominant-baseline="central" fill="${t.print ? '#c03a6b' : '#bbb'}" fill-opacity=".45" font-weight="700" pointer-events="none">${t.code}</text>`).join('')}
    </svg></section></div>`;
  el.onchange = (e) => {
    const f = e.target.dataset.f;
    if (f === 'paper') o.paper = e.target.value;
    if (f === 'landscape') o.landscape = !!e.target.value;
    if (f === 'skipBlank') o.skipBlank = e.target.checked;
    commit();
  };
  el.onclick = async (e) => {
    if (e.target.dataset.a === 'projector') openProjector();
    if (e.target.dataset.a === 'pack') { g.pieces = fewestPages(g, o, T.pw); commit(); }
    if (e.target.dataset.a === 'pdf') {
      e.target.disabled = true;
      try {
        await io.makePDF(printHTML(g, { ...o, profileName: profileOf(g).name, metric: isMetric(), notions: stepsFor(g).notions }), `${g.name} pattern`);
      } finally { e.target.disabled = false; }
    }
  };
}
