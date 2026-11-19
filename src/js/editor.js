// Pattern editor: pan/zoom, move pieces, drag points and curve handles, add/delete points,
// per-edge seam allowance, notches, rotate/flip/duplicate. Edited pieces stop following
// the Design options until reset.
import { S, commit, emit, garment, regen, arrange, uid, profileOf } from './store.js';
import { TYPES } from './garments/index.js';
import { pieceSVG, pts, esc, placedBox } from './render.js';
import * as G from './geom.js';
import { fmt, parseLen } from './units.js';
import { seamChecks } from './seamcheck.js';
import { ROLES, EDGES, isPatch, simType } from './sim/garment.js';
import { mount3D, nudge3D } from './view3d.js';
import { rect, piece as newPiece } from './garments/common.js';
import { traceShape } from './trace-geom.js';
import { sewEdges, sewChecks, sewTo, sewTwin, unsew, cleanSews, sewColour, sewLetter } from './sews.js';

const ACC = '#c03a6b';
// Body guide: her measurements at true size beside the pieces, as a half front (centre line on the left).
let guide = true;
const guideRows = (m) => { const w = m.backLength; return [['Shoulder ½', 0, m.shoulderWidth / 2], ['Bust ¼', m.armholeDepth + 3, m.bust / 4], ['Waist ¼', w, m.waist / 4], ['Hip ¼', w + m.waistToHip, m.hip / 4], ['Knee', w + m.waistToKnee, 0], ['Floor', w + m.waistToFloor, 0]]; };
const guideX = (m) => -Math.max(m.bust, m.hip) / 4 - 15;
function guideSVG(m, k) {
  const cx = guideX(m), rows = guideRows(m), floor = rows[5][1], t = (x, y, txt, a = 'start') => `<text x="${x}" y="${y}" font-size="${11 * k}" text-anchor="${a}">${esc(txt)}</text>`;
  let o = `<g class="guide" pointer-events="none"><line x1="${cx}" y1="${-2}" x2="${cx}" y2="${floor}" stroke-dasharray="${4 * k} ${3 * k}" stroke-width="${k}"/>`
    + t(cx, -3, `Body guide · ${profileOf(garment()).name} · centre line`);
  for (const [name, y, w] of rows) {
    o += w ? `<line x1="${cx}" y1="${y}" x2="${cx + w}" y2="${y}" stroke-width="${1.5 * k}"/><line x1="${cx + w}" y1="${y - 1}" x2="${cx + w}" y2="${y + 1}" stroke-width="${1.5 * k}"/>` + t(cx + 1, y - 0.6, `${name} ${fmt(w)}`)
      : `<line x1="${cx - 2}" y1="${y}" x2="${cx + 2}" y2="${y}" stroke-width="${1.5 * k}"/>` + t(cx - 3, y, name, 'end');
  }
  return o + '</g>';
}
// What each named edge sews to, in one colour per join (a side seam sews to the other side seams).
const JOIN = { side: '#2563eb', shoulder: '#16a34a', armhole: '#d97706', cap: '#d97706', centre: '#7c3aed', princess: '#0891b2', underarm: '#0d9488', hem: '#db2777', waist: '#db2777', inseam: '#65a30d' };
// Seams sewn by hand (any piece) are lettered A, B, C…, one colour each; they take over from a named join.
function joinsSVG(q, k, marks) {
  const label = q.custom && ROLES[q.role] ? Object.fromEntries(EDGES[ROLES[q.role][1]]) : null;
  return q.segs.map((s, i) => {
    const n = s.sew ? marks.indexOf(s.sew) : -1, col = n >= 0 ? sewColour(n) : label && JOIN[s.name];
    if (!col) return '';
    const P = G.segPts(q, i), mid = P[P.length >> 1], text = n >= 0 ? `${sewLetter(n)}${s.twin ? ' ⇋' : ''}` : label[s.name] || s.name;
    return `<polyline points="${pts(P)}" fill="none" stroke="${col}" stroke-width="${4 * k}" stroke-linecap="round" opacity=".85" pointer-events="none"/>`
      + `<text x="${mid.x}" y="${mid.y}" font-size="${(n >= 0 ? 13 : 10) * k}" font-weight="${n >= 0 ? 700 : 400}" text-anchor="middle" dominant-baseline="central" fill="${col}" stroke="#fff" stroke-width="${3 * k}" paint-order="stroke" pointer-events="none">${esc(text)}</text>`;
  }).join('');
}
// Pieces that can be sewn flat onto another: your own with "Pocket or patch" chosen, and drafted patch pockets.
const pocketish = (g, p) => (p.custom ? p.role === 'patch' : ['patchpocket', 'backpocket', 'coin'].includes(p.key) || (p.key === 'pocket' && g.type === 'jacket'));
let split = typeof innerWidth === 'number' && innerWidth >= 1250; // the 3D view beside the pattern (on to start with where there's room)
let pause = 0; // timer: a drag that rests a moment updates the 3D view
let picking = null; // choosing what an edge sews to: { p: piece id, seg } of the edge that was selected
let drawing = null; // points clicked so far while drawing a new piece: [{x, y, corner}]
let view = null, sel = { p: null, node: null, seg: null, notch: null }, drag = null, svg = null, lastG = null, lastPt = null;
const clearSel = () => { sel = { p: null, node: null, seg: null, notch: null }; };
const piece = () => garment()?.pieces.find((p) => p.id === sel.p);
const g0 = garment;
const local = (p, m) => ({ x: m.x - p.pos.x, y: m.y - p.pos.y });

function toWorld(e) { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - view.tx) / view.s, y: (e.clientY - r.top - view.ty) / view.s }; }
function fit() {
  const g = garment(), r = svg.getBoundingClientRect();
  const bs = g.pieces.map((p) => { const b = G.bbox(G.offsetOutline(p)); return { x: b.x + p.pos.x, y: b.y + p.pos.y, w: b.w, h: b.h }; });
  if (guide) { const m = profileOf(g).m, cx = guideX(m); bs.push({ x: cx - 12, y: -6, w: -cx + 12, h: guideRows(m)[5][1] + 8 }); }
  if (!bs.length) { view = { s: 10, tx: 40, ty: 40 }; return; }
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
  (p.marks || []).forEach((m, j) => { if (m.type === 'dart' || m.type === 'pleat') m.pts.forEach((q, i) => { o += `<rect x="${q.x - 3 * k}" y="${q.y - 3 * k}" width="${6 * k}" height="${6 * k}" fill="#fff" stroke="#5f5869" stroke-width="${k}" data-mk="${j}:${i}" style="cursor:move"/>`; }); });
  (p.notches || []).forEach((q, j) => { o += dot(q, `fill="${sel.notch === j ? ACC : '#fff'}" stroke="#2563eb" stroke-width="${1.5 * k}" data-notch="${j}" style="cursor:move"`, 3.5); });
  p.nodes.forEach((q, i) => { o += dot(q, `fill="${sel.node === i ? ACC : '#fff'}" stroke="${ACC}" stroke-width="${1.5 * k}" data-node="${i}" style="cursor:move"`); });
  return o;
}

function draw() {
  const g = garment(), k = 1 / view.s, p = piece();
  let o = `<g transform="translate(${view.tx},${view.ty}) scale(${view.s})">${grid(k)}`;
  if (guide) o += guideSVG(profileOf(g).m, k);
  const marks = [...sewEdges(g).keys()];
  for (const q of g.pieces) o += `<g transform="translate(${q.pos.x},${q.pos.y})">${pieceSVG(q, { k, selected: q.id === sel.p })}${joinsSVG(q, k, marks)}</g>`;
  // Pockets and patches show as a dashed outline on the piece they're sewn onto; drag it to place the pocket.
  for (const q of g.pieces) {
    const h = isPatch(q) && g.pieces.find((x) => x.id === q.on.p);
    if (!h) continue;
    const ol = G.outline(q), b = G.bbox(ol);
    o += `<g transform="translate(${h.pos.x + q.on.x - b.x},${h.pos.y + q.on.y - b.y})"><polygon data-on="${q.id}" points="${pts(ol)}" fill="${ACC}" fill-opacity=".1" stroke="${ACC}" stroke-width="${1.5 * k}" stroke-dasharray="${5 * k} ${3 * k}" style="cursor:move"/>`
      + `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2}" font-size="${10 * k}" text-anchor="middle" dominant-baseline="central" fill="${ACC}" stroke="#fff" stroke-width="${3 * k}" paint-order="stroke" pointer-events="none">${esc(q.name)}</text></g>`;
  }
  if (p) o += `<g transform="translate(${p.pos.x},${p.pos.y})">${overlay(p, k)}</g>`;
  // Choosing what an edge sews to: every other edge lights up and can be clicked.
  if (picking) for (const q of g.pieces) o += `<g transform="translate(${q.pos.x},${q.pos.y})">${q.segs.map((sg, i) => (sg.fold || (q.id === picking.p && i === picking.seg) ? '' : `<polyline data-pick="${q.id}:${i}" points="${pts(G.segPts(q, i))}" fill="none" stroke="${ACC}" stroke-opacity=".22" stroke-width="${12 * k}" stroke-linecap="round" style="cursor:crosshair"/>`)).join('')}</g>`;
  if (drawing?.length) {
    const sh = traceShape(drawing), n = drawing.length;
    const d = `M${drawing[0].x},${drawing[0].y}` + sh.segs.slice(0, n - 1).map((sg, i) => { const b = drawing[i + 1]; return sg.c1 ? `C${sg.c1.x},${sg.c1.y} ${sg.c2.x},${sg.c2.y} ${b.x},${b.y}` : `L${b.x},${b.y}`; }).join('');
    o += `<path d="${d}" fill="none" stroke="${ACC}" stroke-width="${2 * k}" pointer-events="none"/>`;
    drawing.forEach((q, i) => { o += q.corner ? `<rect x="${q.x - 4 * k}" y="${q.y - 4 * k}" width="${8 * k}" height="${8 * k}" fill="${ACC}" stroke="#fff" stroke-width="${1.5 * k}" pointer-events="none"/>` : `<circle cx="${q.x}" cy="${q.y}" r="${(i ? 4 : 6) * k}" fill="${ACC}" stroke="#fff" stroke-width="${1.5 * k}" pointer-events="none"/>`; });
  }
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
    if (picking) { // the edge clicked is sewn to the selected one; a click anywhere else cancels
      const from = g0().pieces.find((q) => q.id === picking.p), [qid, i] = (d.pick || '').split(':'), to = g0().pieces.find((q) => q.id === qid);
      const seg = picking.seg; picking = null;
      if (from && to) { sewTo(g0(), from, seg, to, +i); commit(); } else { draw(); props(); }
      return;
    }
    if (drawing) { // click = corner, Shift+click = a point the edge curves through; snapped to 0.5 cm
      const q = { x: Math.round(m.x * 2) / 2, y: Math.round(m.y * 2) / 2, corner: !e.shiftKey }, f = drawing[0];
      if (drawing.length > 2 && Math.hypot(q.x - f.x, q.y - f.y) * view.s < 8) return finishDrawing();
      drawing.push(q); draw(); props(); return;
    }
    if (d.on) { const q = g0().pieces.find((x) => x.id === d.on); drag = { mode: 'on', q, start: m, orig: { ...q.on } }; return; } // a pocket's outline on its host
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
    else if (drag.mode === 'on') Object.assign(drag.q.on, { x: Math.round((drag.orig.x + m.x - drag.start.x) * 2) / 2, y: Math.round((drag.orig.y + m.y - drag.start.y) * 2) / 2 }); // to the half centimetre
    else if (drag.mode === 'move') p.pos = { x: drag.orig.x + m.x - drag.start.x, y: drag.orig.y + m.y - drag.start.y };
    else {
      const l = local(p, m);
      if (drag.mode === 'node') {
        const n = p.nodes[drag.i], dx = l.x - n.x, dy = l.y - n.y, N = p.nodes.length, ps = p.segs[(drag.i - 1 + N) % N], ns = p.segs[drag.i];
        n.x = l.x; n.y = l.y; // curve handles travel with their point so the curve keeps its shape
        if (ps.c2) { ps.c2.x += dx; ps.c2.y += dy; }
        if (ns.c1) { ns.c1.x += dx; ns.c1.y += dy; }
      } else if (drag.mode === 'handle') p.segs[drag.i][drag.w === 1 ? 'c1' : 'c2'] = l;
      else if (drag.mode === 'mark') { const mk = p.marks[drag.j]; mk.pts[drag.i] = mk.type === 'pleat' || (mk.type === 'dart' && mk.pts.length === 3 && drag.i !== 1) ? G.nearestSeg(p, l).pt : l; } // the ends of a dart or pleat stay on the edge
      else if (drag.mode === 'notch') p.notches[drag.j] = G.nearestSeg(p, l).pt;
      markEdited(p);
    }
    draw();
    // The 3D view beside it follows the edit whenever the drag pauses for a moment (and when it ends).
    clearTimeout(pause);
    if (split && drag.mode !== 'pan' && drag.mode !== 'move') pause = setTimeout(() => { if (drag) nudge3D(garment()); }, 250);
  };
  svg.onpointerup = svg.onpointercancel = () => { const d = drag; drag = null; clearTimeout(pause); if (d?.moved && d.mode !== 'pan') commit(); };
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
  if (drawing) {
    if (e.key === 'Escape') drawing = null;
    else if (e.key === 'Enter') { finishDrawing(); return true; }
    else if (e.key === 'Backspace' || e.key === 'Delete') drawing.pop();
    else return false;
    draw(); props(); return true;
  }
  if (picking) { if (e.key !== 'Escape') return false; picking = null; draw(); props(); return true; }
  if (e.key === 'Escape') { clearSel(); draw(); props(); return true; }
  if (!p || (e.key !== 'Delete' && e.key !== 'Backspace')) return false;
  if (sel.node != null) { if (G.deleteNode(p, sel.node)) { markEdited(p); sel.node = null; commit(); } return true; }
  if (sel.notch != null) { p.notches.splice(sel.notch, 1); sel.notch = null; markEdited(p); commit(); return true; }
  return false;
}

function finishDrawing() {
  if (drawing.length < 3) return;
  const g = garment(), c = newPiece(`own-${uid()}`, 'New piece', traceShape(drawing));
  Object.assign(c, { id: uid(), custom: true, edited: true, pos: { x: 0, y: 0 } });
  g.pieces.push(c); drawing = null; clearSel(); sel.p = c.id; commit();
}

// ---------- side panel ----------
function seamPanel(g) {
  const checks = [...seamChecks(g, profileOf(g).m), ...sewChecks(g)];
  if (!checks.length) return '';
  // A seam sewn by hand whose two sides differ isn't a mistake: the longer side is gathered or eased on.
  const row = (c) => (c.free && !c.ok ? `<tr class="ok"><td>〰</td><td>${esc(c.label)}<small>${esc(fmt(c.a))} vs ${esc(fmt(c.b))}: the longer side gathers by ${esc(fmt(Math.abs(c.diff)))}</small></td></tr>`
    : `<tr class="${c.ok ? 'ok' : 'bad'}"><td>${c.ok ? '✓' : '⚠'}</td><td>${esc(c.label)}<small>${esc(fmt(c.a))} vs ${esc(fmt(c.b))} (${c.diff >= 0 ? '+' : ''}${esc(fmt(c.diff))})</small></td></tr>`);
  return `<h4>Seam check</h4><table class="seams">${checks.map(row).join('')}</table>
    ${checks.some((c) => !c.ok && !c.free) ? '<p class="tip">⚠ means these edges will not sew together neatly. If you edited a piece, adjust the matching piece too, or reset it.</p>' : '<p class="tip">Edges that sew together match.</p>'}`;
}
// What the selected edge is sewn to by hand, and the buttons to sew or unsew it.
function sewPanel(g, p, s) {
  const all = sewEdges(g), n = s.sew ? [...all.keys()].indexOf(s.sew) : -1, twinable = p.cut.fold || p.cut.n >= 2 || p.segs.some((x) => x.fold);
  const others = n >= 0 ? [...new Set(all.get(s.sew).filter((e) => !e.segs.includes(sel.seg) || e.p !== p).map((e) => (e.p === p ? 'another edge of this piece' : e.p.name)))] : [];
  return `<h4>Sewn by hand</h4>${n < 0 ? '<p class="tip">Sew this edge to any other edge, on any piece.</p>'
    : `<p class="stat"><b style="color:${sewColour(n)}">Seam ${sewLetter(n)}</b>: ${s.twin ? 'sewn to its mirror image' : `sewn to ${esc(others.join(', ') || 'nothing yet')}`}</p>`}
    <div class="btns"><button data-a="pick" class="${n < 0 ? 'primary' : ''}">🧵 Sew to another edge…</button>${twinable && !s.twin ? '<button data-a="twin" title="A centre seam: this edge is sewn to the same edge on the mirrored copy">Sew to its mirror image</button>' : ''}${n >= 0 ? '<button data-a="unsew">Unsew</button>' : ''}</div>`;
}
const field = (label, f, value, extra = '') => `<label class="row"><span>${label}</span><input data-f="${f}" value="${esc(value)}" ${extra}></label>`;
function props() {
  const el = document.getElementById('edp'), g = garment(), p = piece();
  if (!el) return;
  if (drawing) {
    el.innerHTML = `<h3>Draw a piece</h3><ul class="tip"><li>Click to place each corner. Edges between corners are straight.</li><li><b>Shift+click</b> places a point the edge curves smoothly through. Put one between two corners to scoop or round that edge.</li><li>Click the first point (or press Enter) to close the shape.</li><li>Backspace removes the last point; Esc cancels.</li><li>Points snap to ½ cm. Draw the stitching line; the seam allowance is added around it.</li></ul>
      <p class="stat">${drawing.length} points</p><div class="btns">${drawing.length > 2 ? '<button class="primary" data-a="drawdone">Finish shape</button>' : ''}${drawing.length ? '<button data-a="drawundo">Undo point</button>' : ''}<button data-a="drawcancel">Cancel</button></div>`;
    return;
  }
  if (picking) {
    el.innerHTML = `<h3>Sew to another edge</h3><p class="tip">Click the edge this one sews to, on this piece or any other. The two get the same letter and colour.</p>
      <ul class="tip"><li>If the edges are different lengths, the longer one is gathered onto the shorter.</li><li>To sew one long edge (a waistband, collar or ruffle) to several edges, sew each of them to it in turn.</li><li>Esc, or a click anywhere else, cancels.</li></ul><div class="btns"><button data-a="pickcancel">Cancel</button></div>`;
    return;
  }
  if (!p) {
    el.innerHTML = `<h3>${esc(g.name)}</h3><p class="tip">Click a piece to select it. Drag to move it. Scroll to zoom; drag empty space to pan.</p>
      <div class="plist">${g.pieces.map((q) => `<button class="pitem" data-sel="${q.id}">${esc(q.name)}<small>${q.edited ? 'edited · ' : ''}${q.cut.n}×</small></button>`).join('')}</div>
      <div class="btns"><button data-a="draw" class="primary">✏️ Draw a piece</button><button data-a="newp">＋ Rectangle</button><button data-a="split">${split ? 'Hide the 3D view' : 'Show 3D beside'}</button><button data-a="guide">${guide ? 'Hide' : 'Show'} body guide</button><button data-a="arrange">Tidy layout</button><button data-a="fit">Zoom to fit</button>${(g.removed || []).length ? '<button data-a="restore">Restore deleted pieces</button>' : ''}</div>
      ${seamPanel(g)}
      <h4>Size</h4><p class="tip">The body guide shows ${esc(profileOf(g).name)}'s measurements at true size. Each line is a quarter of the measurement: the width one front piece needs when you cut 2, so the pair goes halfway round. Add 1–4 cm for ease. Bodices start at the top line (neck); skirts and trousers start at the waist line.</p>
      <h4>Editing</h4><ul class="tip"><li>✏️ Draw a piece: click around a shape of your own. ＋ Rectangle starts from a rectangle instead.</li><li>Select a piece, then drag its round points to reshape it.</li><li>Click an edge to set its seam allowance, see its length, add a dart or pleat, or sew it to another edge.</li><li>Double-click an edge to add a point. Select a point and press Delete to remove it.</li><li>Orange squares on curves are handles that bend the curve.</li><li>Ctrl/⌘+Z undoes anything.</li></ul>`;
    return;
  }
  let h = `<h3>${esc(p.name)}</h3>`;
  if (p.edited && !p.custom) h += `<p class="badge">Edited by hand. It won't change when you change the design options. <button data-a="reset">Reset to drafted</button></p>`;
  h += field('Name', 'piecename', p.name) + `<label class="row"><span>Cut</span><input type="number" min="1" data-f="pcut" value="${p.cut.n}"></label>`
    + `<label class="row"><span>Mirror pairs</span><input type="checkbox" data-f="pmirror" ${p.cut.mirror ? 'checked' : ''}></label>`
    + (p.custom ? `<label class="row"><span>In 3D</span><select data-f="prole"><option value="">Not shown</option>${Object.entries(ROLES).map(([k, [n]]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      ${p.role === 'patch' ? '' : p.role === 'attach' ? `<p class="tip">A sewn-on piece has no place of its own on the body: in 3D it starts along whatever it is sewn to. Click one of its edges and choose <b>Sew to another edge</b>. Cut 2 for a pair (cuffs, two collar halves).</p><label class="row"><span>Other way round</span><input type="checkbox" data-f="prev" ${p.rev ? 'checked' : ''}></label>`
    : p.role ? '<p class="tip">Click each edge that sews to another piece and choose under <b>Sews to</b> what it is. Edges with the same name are sewn together: the front’s side seam to the back’s side seam, a shoulder to a shoulder, a sleeve cap into the armhole, a bodice bottom to a skirt waist. A centre seam is sewn to the centre seam of the mirrored copy. Named edges are coloured: same colour, sewn together. Cut 2 (or put the centre on the fold) for a full front or back. Any other edge can be sewn by hand: click it and choose <b>Sew to another edge</b>.</p>' : ''}` : '')
    + (pocketish(g, p) ? `<label class="row"><span>Sewn onto</span><select data-f="pon"><option value="">${p.custom ? 'Choose a piece…' : 'Not shown in 3D'}</option>${g.pieces.filter((q) => q !== p && !pocketish(g, q)).map((q) => `<option value="${q.id}" ${p.on?.p === q.id ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}</select></label>
      <p class="tip">${p.on ? 'Its dashed outline is on that piece: drag the outline to where the pocket goes. Rotate or flip the pocket here and it turns there too. Cut 2 puts one on each side. Click the pocket’s top edge and choose <b>Leave open</b> so the opening isn’t stitched down.' : 'A pocket or patch lies flat on another piece. Choose which, then drag its outline into place on that piece.'}</p>` : '')
    + `<div class="btns"><button data-a="rot">⟳ Rotate 90°</button><button data-a="flip">⇋ Flip</button><button data-a="dup">Duplicate</button>${(p.marks || []).some((mk) => mk.type === 'dart' || mk.type === 'pleat') ? '<button data-a="deldart">Remove last dart or pleat</button>' : ''}<button data-a="delp" class="danger">Delete piece</button></div>`
    + `<h4>Seam allowance</h4><div class="inline"><input data-f="allsa" value="${esc(fmt(p.segs.find((s) => !s.fold)?.sa ?? 1.5))}"><button data-a="allsa">Set on all edges</button></div>`;
  if (sel.seg != null && p.segs[sel.seg]) {
    const s = p.segs[sel.seg];
    h += `<h4>Selected edge</h4><p class="stat">Length <b>${esc(fmt(G.segLen(p, sel.seg)))}</b> (stitching line)</p>`
      + (s.fold ? '' : field('Seam allowance', 'sa', fmt(s.sa)))
      + (p.custom && ROLES[p.role] && EDGES[ROLES[p.role][1]].length && !s.fold ? `<label class="row"><span>Sews to</span><select data-f="sname"><option value="">Nothing (hem or open edge)</option>${EDGES[ROLES[p.role][1]].map(([k, n]) => `<option value="${k}" ${s.name === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : '')
      + `<div class="btns"><button data-a="curve">${s.c1 ? 'Make straight' : 'Make curved'}</button><button data-a="fold">${s.fold ? 'Not on fold' : 'Place on fold'}</button><button data-a="notch">Add notch here</button>${s.fold ? '' : '<button data-a="dart">Add dart here</button><button data-a="pleat">Add pleat here</button>'}${pocketish(g, p) && !s.fold ? `<button data-a="opening">${s.open ? 'Stitch this edge down' : 'Leave open (pocket opening)'}</button>` : ''}</div>`
      + (s.fold ? '' : sewPanel(g, p, s));
  }
  if (sel.node != null) h += `<h4>Selected point</h4><div class="btns"><button data-a="delnode" class="danger">Delete point</button></div>`;
  if (sel.notch != null) h += `<h4>Selected notch</h4><div class="btns"><button data-a="delnotch" class="danger">Delete notch</button></div>`;
  h += `<p class="tip">Total stitching line: ${esc(fmt(p.segs.reduce((a, s, i) => a + G.segLen(p, i), 0)))}</p>`;
  el.innerHTML = h;
}

function action(a) {
  const g = garment(), p = piece();
  // Where a dart or pleat goes on the selected edge: where it was clicked (or its middle), with its two ends `half` cm either side.
  const spot = (half) => {
    const at = lastPt && G.nearestSeg(p, lastPt).i === sel.seg ? G.nearestSeg(p, lastPt) : G.nearestSeg(p, G.segPts(p, sel.seg, 2)[1]);
    const { a: u, b: v } = at.dir, L = G.dist(u, v) || 1, t = { x: (v.x - u.x) / L, y: (v.y - u.y) / L }, sg = G.outSign(p), end = (k) => G.nearestSeg(p, { x: at.pt.x + t.x * k, y: at.pt.y + t.y * k }), e0 = end(-half), e1 = end(half);
    if (e0.i !== sel.seg || e1.i !== sel.seg || G.dist(e0.pt, e1.pt) < half * 1.6) { alert('There is no room for that here. Click further from the ends of the edge, then try again.'); return null; }
    return { at: at.pt, e0: e0.pt, e1: e1.pt, inw: { x: -sg * t.y, y: sg * t.x } };
  };
  const A = {
    arrange: () => { arrange(g); fit(); },
    fit: () => { fit(); draw(); return true; },
    restore: () => { g.removed = []; regen(g); },
    reset: () => { p.edited = false; regen(g); },
    rot: () => { G.rotate90(p); p.turns = ((p.turns || 0) + 1) % 4; },
    flip: () => { G.flipX(p); p.flipped = !p.flipped; },
    guide: () => { guide = !guide; fit(); draw(); props(); return true; },
    split: () => { split = !split; view = null; emit(); return true; }, // laid out afresh, with or without the 3D view
    draw: () => { drawing = []; clearSel(); draw(); props(); return true; },
    drawdone: () => { finishDrawing(); return true; },
    drawundo: () => { drawing.pop(); draw(); props(); return true; },
    drawcancel: () => { drawing = null; draw(); props(); return true; },
    newp: () => { // beside the other pieces, top at the guide's neck line
      const c = rect(`own-${uid()}`, 'New piece', 30, 40), right = g.pieces.length ? Math.max(...g.pieces.map((q) => { const bb = placedBox(q); return bb.x + bb.w; })) + 5 : 5;
      Object.assign(c, { id: uid(), custom: true, edited: true, pos: { x: right, y: 0 } }); g.pieces.push(c); clearSel(); sel.p = c.id;
    },
    pick: () => { picking = { p: p.id, seg: sel.seg }; draw(); props(); return true; },
    pickcancel: () => { picking = null; draw(); props(); return true; },
    twin: () => sewTwin(g, p, sel.seg),
    unsew: () => unsew(g, p, sel.seg),
    dart: () => { // a V dart 2.5 cm wide and 9 cm long where the edge was clicked (or at its middle); drag its three squares to reshape it
      const sp = spot(1.25);
      if (sp) { (p.marks ||= []).push({ type: 'dart', pts: [sp.e0, { x: sp.at.x + sp.inw.x * 9, y: sp.at.y + sp.inw.y * 9 }, sp.e1] }); markEdited(p); }
      return !sp;
    },
    pleat: () => { // a pleat taking up 4 cm: its two squares are folded onto each other; drag them to make it deeper or move it
      const sp = spot(2);
      if (sp) { (p.marks ||= []).push({ type: 'pleat', pts: [sp.e0, sp.e1] }); markEdited(p); }
      return !sp;
    },
    opening: () => { const sg = p.segs[sel.seg]; if (sg.open) delete sg.open; else sg.open = true; markEdited(p); },
    deldart: () => { p.marks.splice(p.marks.findLastIndex((mk) => mk.type === 'dart' || mk.type === 'pleat'), 1); markEdited(p); },
    dup: () => { const c = structuredClone(p); c.segs.forEach((x) => { delete x.sew; delete x.twin; }); Object.assign(c, { id: uid(), key: `${p.key}-copy-${uid()}`, custom: true, edited: true, name: `${p.name} (copy)`, pos: { x: p.pos.x + 5, y: p.pos.y + 5 } }); g.pieces.push(c); sel.p = c.id; },
    delp: () => { if (!confirm(`Delete "${p.name}"?`)) return true; if (!p.custom) (g.removed ||= []).push(p.key); g.pieces = g.pieces.filter((q) => q !== p); clearSel(); },
    allsa: () => { const v = parseLen(document.querySelector('[data-f="allsa"]').value); if (!(v >= 0)) return true; p.segs.forEach((s) => { if (!s.fold) s.sa = v; }); markEdited(p); },
    curve: () => {
      const s = p.segs[sel.seg], a = p.nodes[sel.seg], b = p.nodes[G.nextI(p, sel.seg)];
      if (s.c1) { delete s.c1; delete s.c2; } else { // bow the edge into the piece (a scoop); drag the handles to reshape or bow it out
        const cx = p.nodes.reduce((t, q) => t + q.x, 0) / p.nodes.length, cy = p.nodes.reduce((t, q) => t + q.y, 0) / p.nodes.length;
        let nx = -(b.y - a.y), ny = b.x - a.x; if (nx * (cx - (a.x + b.x) / 2) + ny * (cy - (a.y + b.y) / 2) < 0) { nx = -nx; ny = -ny; }
        const bow = (q) => ({ x: q.x + nx * 0.25, y: q.y + ny * 0.25 });
        s.c1 = bow(G.lerp(a, b, 1 / 3)); s.c2 = bow(G.lerp(a, b, 2 / 3));
      }
      markEdited(p);
    },
    fold: () => { const s = p.segs[sel.seg]; s.fold = !s.fold; if (s.fold) { s.sa = 0; p.segs.forEach((x, i) => { if (i !== sel.seg) x.fold = false; }); } else s.sa = 1.5; p.cut.fold = s.fold; markEdited(p); },
    notch: () => { const q = lastPt && G.nearestSeg(p, lastPt).i === sel.seg ? G.nearestSeg(p, lastPt).pt : G.segPts(p, sel.seg, 2)[1]; (p.notches ||= []).push(q); markEdited(p); },
    delnode: () => { if (G.deleteNode(p, sel.node)) { markEdited(p); sel.node = null; } },
    delnotch: () => { p.notches.splice(sel.notch, 1); sel.notch = null; markEdited(p); },
  };
  if (A[a] && !A[a]()) { // a seam whose other piece has gone is unpicked, and a pocket whose piece has gone comes off
    cleanSews(g);
    for (const q of g.pieces) if (q.on && !g.pieces.some((h) => h.id === q.on.p)) delete q.on;
    commit();
  }
}

export function renderPattern(el) {
  const g = garment();
  if (!g) { el.innerHTML = '<div class="empty">Create a garment in <b>Design</b> first.</div>'; return; }
  if (lastG !== g.id) { view = null; clearSel(); drawing = picking = null; lastG = g.id; }
  if (picking && !g.pieces.some((q) => q.id === picking.p)) picking = null;
  if (sel.p && !piece()) clearSel();
  el.innerHTML = `<div class="editor${split ? ' split' : ''}"><div class="canvas"><svg id="ed"></svg>
    <div class="legend"><span><i class="l-cut"></i>Cutting line</span><span><i class="l-seam"></i>Stitching line</span><span><i class="l-fold"></i>Fold</span><span>${esc(profileOf(g).name)} · ${esc(TYPES[g.type].name)}</span></div></div>
    ${split ? '<div class="mini3d"></div>' : ''}<aside class="props" id="edp"></aside></div>`;
  svg = el.querySelector('#ed');
  bind();
  if (!view) fit();
  draw(); props();
  if (split) { // the garment as it is now, sewn up and draped; it re-drapes from where it hangs as the pattern changes
    const box = el.querySelector('.mini3d');
    if (simType(g)) mount3D(box, g); else box.innerHTML = '<div class="empty">This garment has no 3D view yet. For your own pieces, choose what each one is under "In 3D".</div>';
  }
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
    if (f === 'prole') { p.role = e.target.value || undefined; if (p.role !== 'patch') delete p.on; }
    if (f === 'pon') { // onto the middle of the piece to start with
      const h = g.pieces.find((q) => q.id === e.target.value);
      if (h) { const hb = G.bbox(G.outline(h)), pb = G.bbox(G.outline(p)); p.on = { p: h.id, x: Math.round(hb.x + (hb.w - pb.w) / 2), y: Math.round(hb.y + (hb.h - pb.h) / 2) }; } else delete p.on;
      markEdited(p);
    }
    if (f === 'prev') p.rev = e.target.checked;
    if (f === 'sname') p.segs[sel.seg].name = e.target.value;
    if (f === 'pmirror') { p.cut.mirror = e.target.checked; markEdited(p); }
    if (f === 'sa') { const v = parseLen(e.target.value); if (!(v >= 0)) { props(); return; } p.segs[sel.seg].sa = v; markEdited(p); }
    commit();
  };
}
