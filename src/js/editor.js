// Pattern editor: pan/zoom, move pieces, drag points and curve handles, add/delete points,
// per-edge seam allowance, notches, rotate/flip/duplicate. Edited pieces stop following
// the Design options until reset.
import { S, commit, garment, regen, arrange, uid, profileOf } from './store.js';
import { TYPES } from './garments/index.js';
import { pieceSVG, pts, esc } from './render.js';
import * as G from './geom.js';
import { fmt, parseLen } from './units.js';
import { seamChecks } from './seamcheck.js';
import { ROLES, EDGES } from './sim/garment.js';
import { rect } from './garments/common.js';

const ACC = '#c03a6b';
let view = null, sel = { p: null, node: null, seg: null, notch: null }, drag = null, svg = null, lastG = null, lastPt = null;
const clearSel = () => { sel = { p: null, node: null, seg: null, notch: null }; };
const piece = () => garment()?.pieces.find((p) => p.id === sel.p);
const local = (p, m) => ({ x: m.x - p.pos.x, y: m.y - p.pos.y });

function toWorld(e) { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - view.tx) / view.s, y: (e.clientY - r.top - view.ty) / view.s }; }
function fit() {
  const g = garment(), r = svg.getBoundingClientRect();
  const bs = g.pieces.map((p) => { const b = G.bbox(G.offsetOutline(p)); return { x: b.x + p.pos.x, y: b.y + p.pos.y, w: b.w, h: b.h }; });
  if (!bs.length) { view = { s: 4, tx: r.width / 2, ty: r.height / 2 }; return; }
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y)), x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
  const s = Math.min((r.width - 80) / (x1 - x0), (r.height - 80) / (y1 - y0), 20);
  view = { s, tx: r.width / 2 - (x0 + x1) / 2 * s, ty: r.height / 2 - (y0 + y1) / 2 * s };
}

function grid(k) {
  const r = svg.getBoundingClientRect(), x0 = -view.tx / view.s, y0 = -view.ty / view.s, w = r.width / view.s, h = r.height / view.s;
  const minor = view.s > 6 ? 1 : 5;
  return `<defs><pattern id="gm" width="${minor}" height="${minor}" patternUnits="userSpaceOnUse"><path d="M${minor} 0H0V${minor}" fill="none" stroke="#ebe7f0" stroke-width="${k}"/></pattern>
    <pattern id="gM" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#dbd5e2" stroke-width="${k}"/></pattern></defs>
    <rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#gm)"/><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#gM)"/>`;
}

function overlay(p, k) {
  let o = '';
  const dot = (q, attrs, r = 5) => `<circle cx="${q.x}" cy="${q.y}" r="${r * k}" ${attrs}/>`;
  p.segs.forEach((s, i) => {
    o += `<polyline data-seg="${i}" points="${pts(G.segPts(p, i))}" fill="none" stroke="transparent" stroke-width="${12 * k}" style="cursor:pointer"/>`;
  });
  if (sel.seg != null && p.segs[sel.seg]) {
    const q = G.segPts(p, sel.seg), mid = q[Math.floor(q.length / 2)];
    o += `<polyline points="${pts(q)}" fill="none" stroke="${ACC}" stroke-width="${3 * k}" pointer-events="none"/>`;
    o += `<text x="${mid.x}" y="${mid.y - 8 * k}" font-size="${12 * k}" text-anchor="middle" fill="${ACC}" stroke="#fff" stroke-width="${3 * k}" paint-order="stroke" pointer-events="none">${esc(fmt(G.segLen(p, sel.seg)))}</text>`;
  }
  const handles = new Set();
  if (sel.seg != null && p.segs[sel.seg]?.c1) handles.add(`${sel.seg}:1`).add(`${sel.seg}:2`);
  if (sel.node != null) { const n = p.nodes.length, pi = (sel.node - 1 + n) % n; if (p.segs[pi]?.c2) handles.add(`${pi}:2`); if (p.segs[sel.node]?.c1) handles.add(`${sel.node}:1`); }
  for (const h of handles) {
    const [i, w] = h.split(':').map(Number), s = p.segs[i], c = w === 1 ? s.c1 : s.c2, end = w === 1 ? p.nodes[i] : p.nodes[G.nextI(p, i)];
    o += `<line x1="${end.x}" y1="${end.y}" x2="${c.x}" y2="${c.y}" stroke="${ACC}" stroke-width="${k}" pointer-events="none"/>` + dot(c, `fill="${ACC}" data-h="${h}" style="cursor:move"`, 4);
  }
  (p.marks || []).forEach((m, j) => { if (m.type === 'dart') m.pts.forEach((q, i) => { o += `<rect x="${q.x - 3 * k}" y="${q.y - 3 * k}" width="${6 * k}" height="${6 * k}" fill="#fff" stroke="#5f5869" stroke-width="${k}" data-mk="${j}:${i}" style="cursor:move"/>`; }); });
  (p.notches || []).forEach((q, j) => { o += dot(q, `fill="${sel.notch === j ? ACC : '#fff'}" stroke="#2563eb" stroke-width="${1.5 * k}" data-notch="${j}" style="cursor:move"`, 3.5); });
  p.nodes.forEach((q, i) => { o += dot(q, `fill="${sel.node === i ? ACC : '#fff'}" stroke="${ACC}" stroke-width="${1.5 * k}" data-node="${i}" style="cursor:move"`); });
  return o;
}

function draw() {
  const g = garment(), k = 1 / view.s, p = piece();
  let o = `<g transform="translate(${view.tx},${view.ty}) scale(${view.s})">${grid(k)}`;
  for (const q of g.pieces) o += `<g transform="translate(${q.pos.x},${q.pos.y})">${pieceSVG(q, { k, selected: q.id === sel.p })}</g>`;
  if (p) o += `<g transform="translate(${p.pos.x},${p.pos.y})">${overlay(p, k)}</g>`;
  svg.innerHTML = o + '</g>';
}

function markEdited(p) { p.edited = true; }
function bind() {
  svg.onwheel = (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, s2 = Math.min(60, Math.max(0.5, view.s * Math.exp(-e.deltaY * 0.0015)));
    view.tx = mx - (mx - view.tx) * s2 / view.s; view.ty = my - (my - view.ty) * s2 / view.s; view.s = s2; draw();
  };
  svg.oncontextmenu = (e) => e.preventDefault();
  svg.onpointerdown = (e) => {
    const m = toWorld(e), t = e.target, d = t.dataset, p = piece();
    svg.setPointerCapture(e.pointerId);
    if (e.button !== 0 || e.altKey) { drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty }; return; }
    if (p && d.h) { const [i, w] = d.h.split(':').map(Number); drag = { mode: 'handle', i, w }; return; }
    if (p && d.node != null) { sel.node = +d.node; sel.seg = null; sel.notch = null; drag = { mode: 'node', i: +d.node }; draw(); props(); return; }
    if (p && d.mk) { const [j, i] = d.mk.split(':').map(Number); drag = { mode: 'mark', j, i }; return; }
    if (p && d.notch != null) { sel.notch = +d.notch; sel.node = null; drag = { mode: 'notch', j: +d.notch }; draw(); props(); return; }
    if (p && d.seg != null) { sel.seg = +d.seg; sel.node = null; sel.notch = null; lastPt = local(p, m); draw(); props(); return; }
    const pid = t.closest('[data-p]')?.dataset.p;
    if (pid) {
      if (sel.p !== pid) { clearSel(); sel.p = pid; } else { sel.node = sel.seg = sel.notch = null; }
      drag = { mode: 'move', start: m, orig: { ...piece().pos } }; draw(); props(); return;
    }
    clearSel(); drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty }; draw(); props();
  };
  svg.onpointermove = (e) => {
    if (!drag) return;
    const p = piece(), m = toWorld(e);
    drag.moved = true;
    if (drag.mode === 'pan') { view.tx = drag.tx + e.clientX - drag.sx; view.ty = drag.ty + e.clientY - drag.sy; }
    else if (drag.mode === 'move') p.pos = { x: drag.orig.x + m.x - drag.start.x, y: drag.orig.y + m.y - drag.start.y };
    else {
      const l = local(p, m);
      if (drag.mode === 'node') {
        const n = p.nodes[drag.i], dx = l.x - n.x, dy = l.y - n.y, N = p.nodes.length, ps = p.segs[(drag.i - 1 + N) % N], ns = p.segs[drag.i];
        n.x = l.x; n.y = l.y; // curve handles travel with their point so the curve keeps its shape
        if (ps.c2) { ps.c2.x += dx; ps.c2.y += dy; }
        if (ns.c1) { ns.c1.x += dx; ns.c1.y += dy; }
      } else if (drag.mode === 'handle') p.segs[drag.i][drag.w === 1 ? 'c1' : 'c2'] = l;
      else if (drag.mode === 'mark') p.marks[drag.j].pts[drag.i] = l;
      else if (drag.mode === 'notch') p.notches[drag.j] = G.nearestSeg(p, l).pt;
      markEdited(p);
    }
    draw();
  };
  svg.onpointerup = svg.onpointercancel = () => { const d = drag; drag = null; if (d?.moved && d.mode !== 'pan') commit(); };
  svg.ondblclick = (e) => {
    const p = piece(), d = e.target.dataset;
    if (!p || d.seg == null) return;
    const ns = G.nearestSeg(p, local(p, toWorld(e)));
    G.splitSeg(p, ns.i, ns.t); markEdited(p);
    sel.node = ns.i + 1; sel.seg = null; commit();
  };
}

export function editorKey(e) {
  const p = piece();
  if (e.key === 'Escape') { clearSel(); draw(); props(); return true; }
  if (!p || (e.key !== 'Delete' && e.key !== 'Backspace')) return false;
  if (sel.node != null) { if (G.deleteNode(p, sel.node)) { markEdited(p); sel.node = null; commit(); } return true; }
  if (sel.notch != null) { p.notches.splice(sel.notch, 1); sel.notch = null; markEdited(p); commit(); return true; }
  return false;
}

// ---------- side panel ----------
function seamPanel(g) {
  const checks = seamChecks(g, profileOf(g).m);
  if (!checks.length) return '';
  return `<h4>Seam check</h4><table class="seams">${checks.map((c) => `<tr class="${c.ok ? 'ok' : 'bad'}"><td>${c.ok ? '✓' : '⚠'}</td><td>${esc(c.label)}<small>${esc(fmt(c.a))} vs ${esc(fmt(c.b))} (${c.diff >= 0 ? '+' : ''}${esc(fmt(c.diff))})</small></td></tr>`).join('')}</table>
    ${checks.some((c) => !c.ok) ? '<p class="tip">⚠ means these edges will not sew together neatly. If you edited a piece, adjust the matching piece too, or reset it.</p>' : '<p class="tip">Edges that sew together match.</p>'}`;
}
const field = (label, f, value, extra = '') => `<label class="row"><span>${label}</span><input data-f="${f}" value="${esc(value)}" ${extra}></label>`;
function props() {
  const el = document.getElementById('edp'), g = garment(), p = piece();
  if (!el) return;
  if (!p) {
    el.innerHTML = `<h3>${esc(g.name)}</h3><p class="tip">Click a piece to select it. Drag to move it. Scroll to zoom; drag empty space to pan.</p>
      <div class="plist">${g.pieces.map((q) => `<button class="pitem" data-sel="${q.id}">${esc(q.name)}<small>${q.edited ? 'edited · ' : ''}${q.cut.n}×</small></button>`).join('')}</div>
      <div class="btns"><button data-a="newp">＋ New piece</button><button data-a="arrange">Tidy layout</button><button data-a="fit">Zoom to fit</button>${(g.removed || []).length ? '<button data-a="restore">Restore deleted pieces</button>' : ''}</div>
      ${seamPanel(g)}
      <h4>Editing</h4><ul class="tip"><li>＋ New piece starts your own piece as a rectangle: drag its corners and add points to shape it.</li><li>Select a piece, then drag its round points to reshape it.</li><li>Click an edge to set its seam allowance or see its length.</li><li>Double-click an edge to add a point. Select a point and press Delete to remove it.</li><li>Orange squares on curves are handles that bend the curve.</li><li>Ctrl/⌘+Z undoes anything.</li></ul>`;
    return;
  }
  let h = `<h3>${esc(p.name)}</h3>`;
  if (p.edited && !p.custom) h += `<p class="badge">Edited by hand. It won't change when you change the design options. <button data-a="reset">Reset to drafted</button></p>`;
  h += field('Name', 'piecename', p.name) + `<label class="row"><span>Cut</span><input type="number" min="1" data-f="pcut" value="${p.cut.n}"></label>`
    + `<label class="row"><span>Mirror pairs</span><input type="checkbox" data-f="pmirror" ${p.cut.mirror ? 'checked' : ''}></label>`
    + (p.custom ? `<label class="row"><span>In 3D</span><select data-f="prole"><option value="">Not shown</option>${Object.entries(ROLES).map(([k, [n]]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      ${p.role ? '<p class="tip">Click each edge that sews to another piece and choose what it is. Cut 2 (or put the centre on the fold) for a full front or back.</p>' : ''}` : '')
    + `<div class="btns"><button data-a="rot">⟳ Rotate 90°</button><button data-a="flip">⇋ Flip</button><button data-a="dup">Duplicate</button><button data-a="delp" class="danger">Delete piece</button></div>`
    + `<h4>Seam allowance</h4><div class="inline"><input data-f="allsa" value="${esc(fmt(p.segs.find((s) => !s.fold)?.sa ?? 1.5))}"><button data-a="allsa">Set on all edges</button></div>`;
  if (sel.seg != null && p.segs[sel.seg]) {
    const s = p.segs[sel.seg];
    h += `<h4>Selected edge</h4><p class="stat">Length <b>${esc(fmt(G.segLen(p, sel.seg)))}</b> (stitching line)</p>`
      + (s.fold ? '' : field('Seam allowance', 'sa', fmt(s.sa)))
      + (p.custom && ROLES[p.role] && !s.fold ? `<label class="row"><span>Sews to</span><select data-f="sname"><option value="">Nothing (hem or open edge)</option>${EDGES[ROLES[p.role][1]].map(([k, n]) => `<option value="${k}" ${s.name === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : '')
      + `<div class="btns"><button data-a="curve">${s.c1 ? 'Make straight' : 'Make curved'}</button><button data-a="fold">${s.fold ? 'Not on fold' : 'Place on fold'}</button><button data-a="notch">Add notch here</button></div>`;
  }
  if (sel.node != null) h += `<h4>Selected point</h4><div class="btns"><button data-a="delnode" class="danger">Delete point</button></div>`;
  if (sel.notch != null) h += `<h4>Selected notch</h4><div class="btns"><button data-a="delnotch" class="danger">Delete notch</button></div>`;
  h += `<p class="tip">Total stitching line: ${esc(fmt(p.segs.reduce((a, s, i) => a + G.segLen(p, i), 0)))}</p>`;
  el.innerHTML = h;
}

function action(a) {
  const g = garment(), p = piece();
  const A = {
    arrange: () => { arrange(g); fit(); },
    fit: () => { fit(); draw(); return true; },
    restore: () => { g.removed = []; regen(g); },
    reset: () => { p.edited = false; regen(g); },
    rot: () => { G.rotate90(p); p.turns = ((p.turns || 0) + 1) % 4; },
    flip: () => { G.flipX(p); p.flipped = !p.flipped; },
    newp: () => { const c = rect(`own-${uid()}`, 'New piece', 30, 40); Object.assign(c, { id: uid(), custom: true, edited: true, pos: { x: -view.tx / view.s + 20, y: -view.ty / view.s + 20 } }); g.pieces.push(c); clearSel(); sel.p = c.id; },
    dup: () => { const c = structuredClone(p); Object.assign(c, { id: uid(), key: `${p.key}-copy-${uid()}`, custom: true, edited: true, name: `${p.name} (copy)`, pos: { x: p.pos.x + 5, y: p.pos.y + 5 } }); g.pieces.push(c); sel.p = c.id; },
    delp: () => { if (!confirm(`Delete "${p.name}"?`)) return true; if (!p.custom) (g.removed ||= []).push(p.key); g.pieces = g.pieces.filter((q) => q !== p); clearSel(); },
    allsa: () => { const v = parseLen(document.querySelector('[data-f="allsa"]').value); if (!(v >= 0)) return true; p.segs.forEach((s) => { if (!s.fold) s.sa = v; }); markEdited(p); },
    curve: () => {
      const s = p.segs[sel.seg], a = p.nodes[sel.seg], b = p.nodes[G.nextI(p, sel.seg)];
      if (s.c1) { delete s.c1; delete s.c2; } else { s.c1 = G.lerp(a, b, 1 / 3); s.c2 = G.lerp(a, b, 2 / 3); }
      markEdited(p);
    },
    fold: () => { const s = p.segs[sel.seg]; s.fold = !s.fold; if (s.fold) { s.sa = 0; p.segs.forEach((x, i) => { if (i !== sel.seg) x.fold = false; }); } else s.sa = 1.5; p.cut.fold = s.fold; markEdited(p); },
    notch: () => { const q = lastPt && G.nearestSeg(p, lastPt).i === sel.seg ? G.nearestSeg(p, lastPt).pt : G.segPts(p, sel.seg, 2)[1]; (p.notches ||= []).push(q); markEdited(p); },
    delnode: () => { if (G.deleteNode(p, sel.node)) { markEdited(p); sel.node = null; } },
    delnotch: () => { p.notches.splice(sel.notch, 1); sel.notch = null; markEdited(p); },
  };
  if (A[a] && !A[a]()) commit();
}

export function renderPattern(el) {
  const g = garment();
  if (!g) { el.innerHTML = '<div class="empty">Create a garment in <b>Design</b> first.</div>'; return; }
  if (lastG !== g.id) { view = null; clearSel(); lastG = g.id; }
  if (sel.p && !piece()) clearSel();
  el.innerHTML = `<div class="editor"><div class="canvas"><svg id="ed"></svg>
    <div class="legend"><span><i class="l-cut"></i>Cutting line</span><span><i class="l-seam"></i>Stitching line</span><span><i class="l-fold"></i>Fold</span><span>${esc(profileOf(g).name)} · ${esc(TYPES[g.type].name)}</span></div></div>
    <aside class="props" id="edp"></aside></div>`;
  svg = el.querySelector('#ed');
  bind();
  if (!view) fit();
  draw(); props();
  const P = el.querySelector('#edp');
  P.onclick = (e) => {
    const b = e.target.closest('[data-a],[data-sel]');
    if (!b) return;
    if (b.dataset.sel) { clearSel(); sel.p = b.dataset.sel; draw(); props(); return; }
    action(b.dataset.a);
  };
  P.onchange = (e) => {
    const f = e.target.dataset.f, p = piece();
    if (!p || !f || f === 'allsa') return;
    if (f === 'piecename') { p.name = e.target.value || p.name; p.renamed = true; }
    if (f === 'pcut') { p.cut.n = Math.max(1, Math.round(+e.target.value) || 1); markEdited(p); }
    if (f === 'prole') p.role = e.target.value || undefined;
    if (f === 'sname') p.segs[sel.seg].name = e.target.value;
    if (f === 'pmirror') { p.cut.mirror = e.target.checked; markEdited(p); }
    if (f === 'sa') { const v = parseLen(e.target.value); if (!(v >= 0)) { props(); return; } p.segs[sel.seg].sa = v; markEdited(p); }
    commit();
  };
}
