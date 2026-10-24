// True-scale pattern printing. Pieces are tiled over printer pages at 1:1 (1 SVG unit = 1 cm).
// Page 1 is a cover sheet with a test square, cutting list and an assembly map.
import { pieceSVG, placedBox, cutText, esc } from './render.js';

export const PAPERS = {
  a4: { w: 21, h: 29.7, label: 'A4' },
  letter: { w: 21.59, h: 27.94, label: 'US Letter' },
  a0: { w: 84.1, h: 118.9, label: 'A0 (copy shop)' },
  roll: { w: 91.44, h: 0, label: '36" roll (copy shop)' },
};
const MARGIN = 1; // cm of white margin around the printed area on each page

export function tiles(pieces, { paper = 'a4', landscape = false, skipBlank = true } = {}) {
  const boxes = pieces.map(placedBox);
  const x0 = Math.min(...boxes.map((b) => b.x)) - 0.5, y0 = Math.min(...boxes.map((b) => b.y)) - 0.5;
  const W = Math.max(...boxes.map((b) => b.x + b.w)) + 0.5 - x0, H = Math.max(...boxes.map((b) => b.y + b.h)) + 0.5 - y0;
  let { w: PW, h: PH } = PAPERS[paper];
  if (!PH) PH = H + 2 * MARGIN; // roll paper: one page as long as the pattern
  if (landscape && PAPERS[paper].h) [PW, PH] = [PH, PW];
  const pw = PW - 2 * MARGIN, ph = PH - 2 * MARGIN, cols = Math.max(1, Math.ceil(W / pw)), rows = Math.max(1, Math.ceil(H / ph));
  const list = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const t = { r, c, x: x0 + c * pw, y: y0 + r * ph, code: `${String.fromCharCode(65 + (r % 26))}${c + 1}` };
    t.blank = !boxes.some((b) => b.x < t.x + pw && b.x + b.w > t.x && b.y < t.y + ph && b.y + b.h > t.y);
    t.print = !(skipBlank && t.blank);
    list.push(t);
  }
  return { PW, PH, pw, ph, cols, rows, x0, y0, list, printed: list.filter((t) => t.print).length };
}

// Marks drawn on every tile: trim frame, page code, half-circles to match across page joins.
function tileMarks(T, t) {
  const { pw, ph } = T, g = 'fill="none" stroke="#777" stroke-width="0.02"';
  const code = (r, c) => (r >= 0 && c >= 0 && r < T.rows && c < T.cols ? `${String.fromCharCode(65 + (r % 26))}${c + 1}` : '');
  let s = `<rect x="${t.x}" y="${t.y}" width="${pw}" height="${ph}" ${g} stroke-dasharray=".4 .25"/>`;
  s += `<text x="${t.x + pw / 2}" y="${t.y + ph / 2}" font-size="5" fill="#000" fill-opacity=".06" text-anchor="middle" dominant-baseline="central" font-weight="700">${t.code}</text>`;
  s += `<text x="${t.x + 0.3}" y="${t.y + 0.7}" font-size=".55" fill="#555">${t.code}</text>`;
  const nb = [[code(t.r - 1, t.c), t.x + pw / 2, t.y, 0, 1.1], [code(t.r + 1, t.c), t.x + pw / 2, t.y + ph, 0, -0.5], [code(t.r, t.c - 1), t.x, t.y + ph / 2, 1, 0], [code(t.r, t.c + 1), t.x + pw, t.y + ph / 2, -1, 0]];
  for (const [n, x, y, dx, dy] of nb) {
    if (!n) continue;
    s += `<circle cx="${x}" cy="${y}" r=".6" ${g} stroke-width=".03"/>`;
    s += `<text x="${x + dx * 1.2}" y="${y + dy}" font-size=".45" fill="#555" text-anchor="${dx > 0 ? 'start' : dx < 0 ? 'end' : 'middle'}" dominant-baseline="central">${n}</text>`;
  }
  return s;
}

export function printHTML(g, { paper = 'a4', landscape = false, skipBlank = true, profileName = '', metric = true, notions = [] } = {}) {
  const T = tiles(g.pieces, { paper, landscape, skipBlank });
  const sub = `${g.name}${profileName ? ' · ' + profileName : ''}`;
  const art = g.pieces.map((p) => `<g transform="translate(${p.pos.x},${p.pos.y})">${pieceSVG(p, { print: true, sub })}</g>`).join('');
  const sq = metric ? { w: '10cm', vb: 10, label: '10 cm × 10 cm' } : { w: '4in', vb: 10.16, label: '4 in × 4 in' };
  const mapW = 17, mapScale = Math.min(mapW / (T.cols * T.pw), 9 / (T.rows * T.ph));
  const pagesTxt = `${T.printed} pattern page${T.printed === 1 ? '' : 's'} + this cover`;
  const cover = `<div class="page cover">
    <h1>${esc(g.name)}</h1>
    <p class="meta">${esc(profileName ? `Measurements: ${profileName}` : '')} · ${PAPERS[paper].label}${landscape ? ' landscape' : ''} · ${pagesTxt}</p>
    <div class="row">
      <div class="sq"><svg style="width:${sq.w};height:${sq.w}" viewBox="0 0 ${sq.vb} ${sq.vb}"><rect x=".01" y=".01" width="${sq.vb - 0.02}" height="${sq.vb - 0.02}" fill="none" stroke="#000" stroke-width=".04"/>
        <text x="${sq.vb / 2}" y="${sq.vb / 2}" font-size=".7" text-anchor="middle" dominant-baseline="central">${sq.label}</text></svg>
        <p><b>Test square.</b> Measure it before printing the rest. If it isn't exactly ${sq.label}, print again at <b>100% / Actual size</b> (turn off "Fit to page").</p></div>
      <div class="how"><h2>Putting the pages together</h2><ol>
        <li>Print every page at 100% (actual size).</li>
        <li>Lay the pages out in order: letters are rows, numbers are columns (A1 is top left).</li>
        <li>Trim the left and top margin of each page along the dashed line (not on row A or column 1).</li>
        <li>Overlap each trimmed edge onto the dashed line of its neighbour, match the half circles, and tape.</li>
        <li>Cut on the solid outer line. The dashed inner line is the stitching line.</li></ol>
        <h2>Cutting list</h2><table>${g.pieces.map((p) => `<tr><td>${esc(p.name)}</td><td>${cutText(p)}</td></tr>`).join('')}</table>
        ${notions.length ? `<h2>You'll also need</h2><p>${notions.map(esc).join(' · ')}</p>` : ''}
      </div>
    </div>
    <h2>Page map</h2>
    <svg class="map" style="width:${T.cols * T.pw * mapScale}cm;height:${T.rows * T.ph * mapScale}cm" viewBox="${T.x0} ${T.y0} ${T.cols * T.pw} ${T.rows * T.ph}">
      ${T.list.map((t) => `<rect x="${t.x}" y="${t.y}" width="${T.pw}" height="${T.ph}" fill="${t.print ? '#fff' : '#eee'}" stroke="#999" stroke-width="${0.6 / mapScale / 37.8}"/>`).join('')}
      <use href="#art"/>
      ${T.list.map((t) => `<text x="${t.x + T.pw / 2}" y="${t.y + T.ph / 2}" font-size="${Math.min(T.pw, T.ph) / 3}" text-anchor="middle" dominant-baseline="central" fill="${t.print ? '#c03a6b' : '#bbb'}" fill-opacity=".8" font-weight="700">${t.code}</text>`).join('')}
    </svg>
    ${skipBlank && T.printed < T.list.length ? '<p class="meta">Grey pages are empty and are not printed. Leave a gap for them when taping.</p>' : ''}
  </div>`;
  const pages = T.list.filter((t) => t.print).map((t) => `<div class="page"><svg class="tile" style="width:${T.pw}cm;height:${T.ph}cm" viewBox="${t.x} ${t.y} ${T.pw} ${T.ph}"><use href="#art"/>${tileMarks(T, t)}</svg></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(g.name)} pattern</title><style>
    @page { size: ${T.PW}cm ${T.PH}cm; margin: 0 }
    * { box-sizing: border-box }
    body { margin: 0; font-family: "Segoe UI", Helvetica, Arial, sans-serif; color: #111 }
    .page { width: ${T.PW}cm; height: ${T.PH}cm; position: relative; overflow: hidden; break-after: page }
    .page:last-child { break-after: auto }
    .tile { position: absolute; left: ${MARGIN}cm; top: ${MARGIN}cm; font-family: inherit }
    .cover { padding: 1.4cm 1.5cm; font-size: 10pt }
    h1 { margin: 0 0 .1cm; font-size: 20pt } h2 { font-size: 11pt; margin: .4cm 0 .15cm }
    .meta { color: #555; margin: 0 0 .3cm } .row { display: flex; gap: .8cm; align-items: flex-start }
    .sq { flex: none; width: ${sq.w} } .sq svg { display: block } .how { flex: 1 } ol { margin: 0; padding-left: .5cm } li { margin: .08cm 0 }
    table { border-collapse: collapse } td { padding: .05cm .4cm .05cm 0; border-bottom: 1px solid #ddd }
    .map { display: block }
  </style></head><body>
  <svg width="0" height="0" style="position:absolute"><defs><g id="art">${art}</g></defs></svg>
  ${cover}${pages}</body></html>`;
}
