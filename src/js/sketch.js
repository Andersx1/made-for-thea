// Sketch board: front/back croquis drawn from the measurements, with pen (pressure sensitive),
// marker, fill (colour or fabric photo), text and eraser on layers. Everything is vector and
// saved in the project. Board units are cm.
import { S, commit, garment, profileOf, uid } from './store.js';
import { esc } from './render.js';
import * as io from './io.js';

const BW = 150, BH = 195;
let tool = 'pen', color = '#2d2622', size = 0.5, paint = null, live = null;
const COLORS = ['#2d2622', '#c2410c', '#d97706', '#65a30d', '#0f766e', '#2563eb', '#7c3aed', '#db2777', '#ffffff'];

function board() {
  const b = (S.project.sketch ||= { layers: [{ id: uid(), name: 'Sketch', visible: true, items: [] }], swatches: [], croquis: true });
  if (!b.layers.some((l) => l.id === b.active)) b.active = b.layers[b.layers.length - 1].id;
  return b;
}

// Smooth open path through points (Catmull-Rom).
const smooth = (p) => p.length < 3 ? `M${p.map((q) => `${q[0]},${q[1]}`).join('L')}` : `M${p[0][0]},${p[0][1]}` + p.slice(0, -1).map((a, i) => {
  const p0 = p[Math.max(0, i - 1)], b = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
  return `C${a[0] + (b[0] - p0[0]) / 6},${a[1] + (b[1] - p0[1]) / 6} ${b[0] - (p3[0] - a[0]) / 6},${b[1] - (p3[1] - a[1]) / 6} ${b[0]},${b[1]}`;
}).join('');

// Croquis silhouette from the measurements (front view half-widths), standing on y = BH - 5.
function croquis(m, cx) {
  const floor = BH - 5, Y = (h) => floor - h, half = (C) => C * 0.183; // half-width of an ellipse with width:depth ≈ 1.35
  const nape = m.waistToFloor + m.backLength, sh = nape - 4, under = nape - m.armholeDepth - 3, bust = nape - Math.sqrt(Math.max(1, m.shoulderToBust ** 2 - 4));
  const waist = m.waistToFloor, hip = waist - m.waistToHip, crotch = waist - m.crotchDepth, knee = waist - m.waistToKnee;
  const lx = half(m.hip) * 0.48, r = (c) => c / (2 * Math.PI);
  const right = [[r(m.neck) * 1.05, nape + 6], [r(m.neck) * 1.1, nape], [m.shoulderWidth / 2 - 1, sh], [half(m.highBust) + 0.5, under], [half(m.bust), bust], [half(m.underbust), bust - 9],
    [half(m.waist), waist], [half(m.highHip), (waist + hip) / 2], [half(m.hip), hip], [lx + r(m.thigh) * 1.05, crotch - 2], [lx + r(m.knee), knee], [lx + r(m.calf), knee - 12], [lx + r(m.ankle), 9], [lx + r(m.ankle) + 1, 0]];
  const inner = [[lx - r(m.ankle), 0], [lx - r(m.ankle), 9], [lx - r(m.calf) * 0.9, knee - 12], [lx - r(m.knee) * 0.8, knee], [lx - r(m.thigh) * 0.85, crotch - 4], [0.6, crotch]];
  const side = (sg) => [...right, ...inner].map(([x, y]) => [cx + sg * x, Y(y)]);
  const body = `${smooth(side(1).slice(0, right.length))}L${side(1).slice(right.length).map((q) => q.join(',')).join('L')}L${[...side(-1).slice(right.length)].reverse().map((q) => q.join(',')).join('L')}L${[...side(-1).slice(0, right.length)].reverse().map((q) => q.join(',')).join('L')}Z`;
  const arm = (sg) => { const x0 = cx + sg * (m.shoulderWidth / 2 - 2), wr = Y(sh - m.armLength); return `M${x0},${Y(sh)}Q${x0 + sg * 6},${Y(sh) + 3} ${x0 + sg * 5.5},${Y(sh) + 14}L${x0 + sg * 6.5},${wr}L${x0 + sg * 2.5},${wr}L${x0 + sg * 1.2},${Y(sh) + 16}Z`; };
  return `<g fill="#f1edf3" stroke="#cdc5d5" stroke-width="0.25"><path d="${body}"/><path d="${arm(1)}"/><path d="${arm(-1)}"/><ellipse cx="${cx}" cy="${Y(nape + 15)}" rx="8.5" ry="11"/></g>`;
}

function itemSVG(it, b) {
  if (it.type === 'stroke') { // pen: each segment's width follows the pen pressure
    if (it.pts.length === 1) return `<circle cx="${it.pts[0][0]}" cy="${it.pts[0][1]}" r="${it.size * 0.5}" fill="${it.color}"/>`;
    return `<g stroke="${it.color}" stroke-linecap="round">${it.pts.slice(1).map((q, i) => { const p = it.pts[i]; return `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke-width="${it.size * (0.35 + (p[2] + q[2]) * 0.45)}"/>`; }).join('')}</g>`;
  }
  if (it.type === 'marker') return `<path d="${smooth(it.pts)}" fill="none" stroke="${it.color}" stroke-opacity=".35" stroke-width="${it.size * 3}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (it.type === 'fill') return `<path d="${smooth(it.pts)}Z" fill="${it.swatch != null && b.swatches[it.swatch] ? `url(#sw${it.swatch})` : it.color}" fill-opacity=".9"/>`;
  if (it.type === 'text') return `<text x="${it.x}" y="${it.y}" font-size="${it.size}" fill="${it.color}" font-family="system-ui, sans-serif">${esc(it.text)}</text>`;
  return '';
}

function boardSVG(b, m, extra = '') {
  const defs = b.swatches.map((s, i) => `<pattern id="sw${i}" patternUnits="userSpaceOnUse" width="12" height="12"><image href="${s}" width="12" height="12" preserveAspectRatio="xMidYMid slice"/></pattern>`).join('');
  return `<defs>${defs}</defs><rect class="paper" width="${BW}" height="${BH}" fill="#fff"/>
    ${b.croquis ? `${croquis(m, 38)}${croquis(m, 112)}<text x="38" y="${BH - 1}" font-size="2.6" text-anchor="middle" fill="#a99c8c">front</text><text x="112" y="${BH - 1}" font-size="2.6" text-anchor="middle" fill="#a99c8c">back</text>` : ''}
    ${b.layers.filter((l) => l.visible).map((l) => `<g>${l.items.map((it) => itemSVG(it, b)).join('')}</g>`).join('')}${extra}`;
}

const near = (it, x, y, r) => {
  if (it.type === 'text') return x >= it.x - r && x <= it.x + it.text.length * it.size * 0.55 + r && y >= it.y - it.size - r && y <= it.y + r;
  return it.pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < r + (it.size || 0));
};

function loadSwatch(file) {
  return new Promise((res) => { const img = new Image(); img.onload = () => { const k = Math.min(1, 300 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.85)); URL.revokeObjectURL(img.src); }; img.src = URL.createObjectURL(file); });
}

export function renderSketch(el) {
  const b = board(), g = garment(), m = (g ? profileOf(g) : S.project.profiles[0]).m, active = b.layers.find((l) => l.id === b.active);
  const T = (id, label, tip) => `<button data-tool="${id}" class="${tool === id ? 'primary' : ''}" title="${tip}">${label}</button>`;
  el.innerHTML = `<div class="sketch"><div class="sboard"><svg viewBox="0 0 ${BW} ${BH}" preserveAspectRatio="xMidYMid meet">${boardSVG(b, m)}</svg></div>
    <aside class="opts">
      <h3>Sketch</h3>
      <div class="btns tools">${T('pen', '✏️ Pen', 'Draw (pressure sensitive with a pen tablet)')}${T('marker', '🖍 Marker', 'Wide see-through colour')}${T('fill', '🪣 Fill', 'Draw a closed shape to fill it with colour or fabric')}${T('text', '🔤 Text', 'Click to add a note')}${T('erase', '🧽 Erase', 'Drag over anything to remove it')}</div>
      <div class="swrow">${COLORS.map((c) => `<button class="sw ${paint == null && color === c ? 'on' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}<input type="color" data-f="color" value="${color}" title="Any colour"></div>
      <label class="row"><span>Size</span><input type="range" min="0.15" max="3" step="0.05" data-f="size" value="${size}"></label>
      <h4>Fabrics</h4>
      <div class="swrow">${b.swatches.map((s, i) => `<button class="sw fab ${paint === i ? 'on' : ''}" data-swatch="${i}" style="background-image:url(${s})" title="Fill with this fabric"></button>`).join('')}<button data-a="addswatch" title="Add a fabric photo">＋</button></div>
      <p class="tip">Pick a fabric, then use Fill to colour in a shape with it.</p>
      <input type="file" accept="image/*" hidden data-f="file">
      <h4>Layers</h4>
      <div class="layers">${[...b.layers].reverse().map((l) => `<div class="layer ${l.id === b.active ? 'on' : ''}" data-layer="${l.id}"><input type="checkbox" data-vis="${l.id}" ${l.visible ? 'checked' : ''} title="Show"><span>${esc(l.name)}</span><small>${l.items.length}</small></div>`).join('')}</div>
      <div class="btns"><button data-a="addlayer">＋ Layer</button><button data-a="renamelayer">Rename</button>${b.layers.length > 1 ? '<button data-a="dellayer" class="danger">Delete</button>' : ''}<button data-a="clearlayer">Clear</button></div>
      <label class="row"><span>Show figures</span><input type="checkbox" data-f="croquis" ${b.croquis ? 'checked' : ''}></label>
      <p class="tip">Figures are drawn from ${esc((g ? profileOf(g) : S.project.profiles[0]).name)}'s measurements.</p>
      <div class="btns"><button data-a="export">Export picture</button></div>
    </aside></div>`;
  const svg = el.querySelector('svg');
  const toB = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(svg.getScreenCTM().inverse()); return [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100]; };
  const redraw = (extra = '') => { svg.innerHTML = boardSVG(b, m, extra); };
  svg.onpointerdown = (e) => {
    if (!active.visible) { active.visible = true; }
    const [x, y] = toB(e), pr = e.pressure || 0.5;
    if (tool === 'text') { const t = prompt('Note:'); if (t) { active.items.push({ type: 'text', x, y, text: t, color, size: size * 4 + 2 }); commit(); } return; }
    svg.setPointerCapture(e.pointerId);
    if (tool === 'erase') { live = { erase: true }; eraseAt(x, y); return; }
    live = { type: tool === 'pen' ? 'stroke' : tool, pts: [[x, y, pr]], color, size, ...(tool === 'fill' && paint != null ? { swatch: paint } : {}) };
  };
  const eraseAt = (x, y) => { const n = active.items.length; active.items = active.items.filter((it) => !near(it, x, y, size)); if (active.items.length !== n) { live.changed = true; redraw(); } };
  svg.onpointermove = (e) => {
    if (!live) return;
    const [x, y] = toB(e);
    if (live.erase) return eraseAt(x, y);
    const l = live.pts[live.pts.length - 1];
    if (Math.hypot(x - l[0], y - l[1]) < 0.25) return;
    live.pts.push([x, y, e.pressure || 0.5]);
    redraw(itemSVG(live, b) + (live.type === 'fill' ? `<path d="${smooth(live.pts)}" fill="none" stroke="#999" stroke-dasharray=".8 .6" stroke-width=".2"/>` : ''));
  };
  svg.onpointerup = () => {
    if (!live) return;
    const it = live; live = null;
    if (it.erase) { if (it.changed) commit(); return; }
    if (it.type === 'fill' && it.pts.length < 3) return redraw();
    active.items.push(it); commit();
  };
  el.onclick = async (e) => {
    const t = e.target.closest('[data-tool],[data-color],[data-swatch],[data-a],[data-layer]');
    if (!t || e.target.dataset.vis) return;
    const d = t.dataset;
    if (d.tool) tool = d.tool;
    if (d.color) { color = d.color; paint = null; }
    if (d.swatch != null) { paint = +d.swatch; tool = 'fill'; }
    if (d.layer) b.active = d.layer;
    if (d.a === 'addswatch') return el.querySelector('[data-f="file"]').click();
    if (d.a === 'addlayer') { const l = { id: uid(), name: `Layer ${b.layers.length + 1}`, visible: true, items: [] }; b.layers.push(l); b.active = l.id; commit(); return; }
    if (d.a === 'renamelayer') { const n = prompt('Layer name:', active.name); if (n) { active.name = n; commit(); } return; }
    if (d.a === 'dellayer' && confirm(`Delete layer "${active.name}"?`)) { b.layers = b.layers.filter((l) => l !== active); commit(); return; }
    if (d.a === 'clearlayer' && confirm(`Clear everything on "${active.name}"?`)) { active.items = []; commit(); return; }
    if (d.a === 'export') return exportPNG(b, m);
    renderSketch(el);
  };
  el.onchange = async (e) => {
    const f = e.target.dataset.f, v = e.target.dataset.vis;
    if (v) { b.layers.find((l) => l.id === v).visible = e.target.checked; commit(); return; }
    if (f === 'color') { color = e.target.value; paint = null; renderSketch(el); }
    if (f === 'size') size = +e.target.value;
    if (f === 'croquis') { b.croquis = e.target.checked; commit(); }
    if (f === 'file' && e.target.files[0]) { b.swatches.push(await loadSwatch(e.target.files[0])); paint = b.swatches.length - 1; tool = 'fill'; commit(); }
  };
}

function exportPNG(b, m) {
  const k = 8, src = `<svg xmlns="http://www.w3.org/2000/svg" width="${BW * k}" height="${BH * k}" viewBox="0 0 ${BW} ${BH}">${boardSVG(b, m)}</svg>`;
  const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = BW * k; c.height = BH * k; c.getContext('2d').drawImage(img, 0, 0); c.toBlob((bl) => io.download(bl, `${S.project.name} sketch.png`)); };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
}
