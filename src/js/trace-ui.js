// Trace tab: photo of a paper pattern → set the scale → click around a piece → editable pattern piece.
import { S, commit, garment, uid } from './store.js';
import { toCm, traceShape } from './trace-geom.js';
import { piece } from './garments/common.js';
import { bbox } from './geom.js';
import { placedBox, esc } from './render.js';
import { fmt, parseLen, isMetric } from './units.js';

const ACC = '#c03a6b';
let T = { mode: 'idle', pts: [], cal: [], view: null, gid: null, finishing: false };

function loadImage(file) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 2200 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res({ image: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height });
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

function canvasSVG(g) {
  const t = g.trace, v = T.view, k = 1 / v.s;
  let o = `<g transform="translate(${v.tx},${v.ty}) scale(${v.s})"><image href="${t.image}" width="${t.w}" height="${t.h}"/>`;
  const dot = (p, c, r = 5) => `<circle cx="${p.x}" cy="${p.y}" r="${r * k}" fill="${c}" stroke="#fff" stroke-width="${1.5 * k}"/>`;
  const cal = t.cal;
  if (cal?.mode === 'scale' && cal.a) o += `<line x1="${cal.a.x}" y1="${cal.a.y}" x2="${cal.b.x}" y2="${cal.b.y}" stroke="#16a34a" stroke-width="${2 * k}"/>${dot(cal.a, '#16a34a')}${dot(cal.b, '#16a34a')}`;
  if (cal?.mode === 'rect' && cal.corners) o += `<polygon points="${cal.corners.map((p) => `${p.x},${p.y}`).join(' ')}" fill="#16a34a" fill-opacity=".08" stroke="#16a34a" stroke-width="${2 * k}"/>${cal.corners.map((p) => dot(p, '#16a34a')).join('')}`;
  if (T.cal.length) o += `<polyline points="${T.cal.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${ACC}" stroke-width="${2 * k}"/>${T.cal.map((p) => dot(p, ACC)).join('')}`;
  if (T.pts.length) {
    const sh = traceShape(T.pts, { smooth: g.trace.smooth !== false });
    const d = T.pts.length > 2 && T.finishing ? `M${sh.nodes[0].x},${sh.nodes[0].y}` + sh.segs.map((s, i) => { const b = sh.nodes[(i + 1) % sh.nodes.length]; return s.c1 ? `C${s.c1.x},${s.c1.y} ${s.c2.x},${s.c2.y} ${b.x},${b.y}` : `L${b.x},${b.y}`; }).join('') + 'Z' : `M${T.pts.map((p) => `${p.x},${p.y}`).join('L')}`;
    o += `<path d="${d}" fill="${T.finishing ? ACC : 'none'}" fill-opacity=".15" stroke="#2563eb" stroke-width="${2 * k}"/>`;
    T.pts.forEach((p, i) => { o += p.corner ? `<rect x="${p.x - 4 * k}" y="${p.y - 4 * k}" width="${8 * k}" height="${8 * k}" fill="#2563eb" stroke="#fff" stroke-width="${1.5 * k}"/>` : dot(p, i === 0 ? ACC : '#2563eb', i === 0 ? 7 : 4); });
  }
  return o + '</g>';
}

export function renderTrace(el) {
  const g = garment();
  if (!g) { el.innerHTML = '<div class="empty">Create a garment first (or choose <b>Traced pattern</b> on the Design tab).</div>'; return; }
  if (T.gid !== g.id) T = { mode: 'idle', pts: [], cal: [], view: null, gid: g.id, finishing: false };
  const t = (g.trace ||= { smooth: true, hasSA: true });
  const scaled = !!toCm(t.cal), traced = g.pieces.filter((p) => p.traced);
  const how = { scale: 'Click both ends of a known length (a ruler, or a marked line on the pattern).', rect: 'Click the 4 corners of a rectangle you know the size of (a sheet of paper or cutting-mat square): top-left, top-right, bottom-right, bottom-left.', trace: 'Click along the edge of the piece. Shift+click for a sharp corner. Click the first point (orange) to close it.', idle: '' }[T.mode];
  el.innerHTML = `<div class="trace"><div class="tcanvas">${t.image ? '<svg id="tr"></svg>' : '<div class="empty">Choose a photo or scan of the paper pattern to start.<br><small>Lay it flat and photograph it from straight above in good light, with a ruler or a sheet of paper next to it.</small></div>'}
      ${how ? `<div class="legend">${esc(how)}</div>` : ''}</div>
    <aside class="opts">
      <h3>Trace a paper pattern</h3>
      <h4>1 · Photo or scan</h4>
      <div class="btns"><button data-a="photo">${t.image ? 'Change photo…' : 'Choose photo…'}</button></div>
      <input type="file" accept="image/*" hidden data-f="file">
      <h4>2 · Set the scale ${scaled ? '✓' : ''}</h4>
      ${t.image ? `<div class="btns"><button data-a="mode-scale" class="${T.mode === 'scale' ? 'primary' : ''}">Ruler (2 points)</button><button data-a="mode-rect" class="${T.mode === 'rect' ? 'primary' : ''}">Rectangle (4 corners)</button></div>` : '<p class="tip">After choosing a photo.</p>'}
      ${T.mode === 'scale' && T.cal.length === 2 ? `<label class="row"><span>That length is</span><input data-f="real" placeholder="${isMetric() ? '30 cm' : '12"'}"></label><div class="btns"><button class="primary" data-a="set-scale">Set scale</button></div>` : ''}
      ${T.mode === 'rect' && T.cal.length === 4 ? `<div class="btns"><button data-a="preset-a4">A4</button><button data-a="preset-letter">Letter</button></div>
        <label class="row"><span>Width</span><input data-f="rw"></label><label class="row"><span>Height</span><input data-f="rh"></label><div class="btns"><button class="primary" data-a="set-rect">Set scale</button></div>` : ''}
      ${scaled ? `<p class="tip">Scale set${t.cal.mode === 'rect' ? ', and the photo angle is corrected' : ''}. Check it: measure a known length on the pattern after tracing.</p>` : ''}
      <h4>3 · Trace pieces</h4>
      ${scaled ? `${T.mode === 'trace' ? `<p class="stat">${T.pts.length} points</p><div class="btns"><button data-a="undo-pt">Undo point</button><button data-a="cancel">Cancel</button>${T.pts.length > 2 ? '<button data-a="close" class="primary">Close shape</button>' : ''}</div>` : '<div class="btns"><button class="primary" data-a="mode-trace">Trace a piece</button></div>'}
        <label class="row"><span>Smooth curves</span><input type="checkbox" data-f="smooth" ${t.smooth !== false ? 'checked' : ''}></label>
        <label class="row"><span>Edge includes seam allowance</span><input type="checkbox" data-f="hasSA" ${t.hasSA ? 'checked' : ''}></label>` : '<p class="tip">After setting the scale.</p>'}
      ${T.finishing ? `<div class="note"><label class="row"><span>Piece name</span><input data-f="tname" value="Piece ${traced.length + 1}"></label>
        <label class="row"><span>Cut</span><input type="number" min="1" data-f="pcut" value="2"></label><label class="row"><span>Mirror pairs</span><input type="checkbox" data-f="pmirror" checked></label>
        <div class="btns"><button class="primary" data-a="add">Add to pattern</button><button data-a="cancel">Discard</button></div></div>` : ''}
      ${traced.length ? `<h4>Traced pieces</h4><ul class="tip">${traced.map((p) => `<li>${esc(p.name)} (cut ${p.cut.n})</li>`).join('')}</ul><div class="btns"><button data-a="go-pattern">Open in Pattern editor →</button></div>` : ''}
    </aside></div>`;
  const svg = el.querySelector('#tr');
  if (svg) {
    const r = svg.getBoundingClientRect();
    if (!T.view) { const s = Math.min((r.width - 40) / t.w, (r.height - 40) / t.h); T.view = { s, tx: (r.width - t.w * s) / 2, ty: (r.height - t.h * s) / 2 }; }
    const draw = () => { svg.innerHTML = canvasSVG(g); };
    draw();
    const toImg = (e) => { const b = svg.getBoundingClientRect(); return { x: (e.clientX - b.left - T.view.tx) / T.view.s, y: (e.clientY - b.top - T.view.ty) / T.view.s }; };
    let pan = null;
    svg.onwheel = (e) => { e.preventDefault(); const b = svg.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top, s2 = Math.max(0.02, Math.min(20, T.view.s * Math.exp(-e.deltaY * 0.0015))); T.view.tx = mx - (mx - T.view.tx) * s2 / T.view.s; T.view.ty = my - (my - T.view.ty) * s2 / T.view.s; T.view.s = s2; draw(); };
    svg.oncontextmenu = (e) => e.preventDefault();
    svg.onpointerdown = (e) => {
      svg.setPointerCapture(e.pointerId);
      if (e.button !== 0 || T.mode === 'idle' || T.finishing) { pan = { x: e.clientX, y: e.clientY, tx: T.view.tx, ty: T.view.ty, moved: false }; return; }
      const p = toImg(e);
      if (T.mode === 'trace') {
        const f = T.pts[0];
        if (T.pts.length > 2 && Math.hypot(p.x - f.x, p.y - f.y) * T.view.s < 12) { T.finishing = true; return renderTrace(el); }
        T.pts.push({ ...p, corner: e.shiftKey });
        return renderTrace(el);
      }
      const max = T.mode === 'scale' ? 2 : 4;
      if (T.cal.length >= max) T.cal = [];
      T.cal.push(p); renderTrace(el);
    };
    svg.onpointermove = (e) => { if (!pan) return; T.view.tx = pan.tx + e.clientX - pan.x; T.view.ty = pan.ty + e.clientY - pan.y; draw(); };
    svg.onpointerup = () => { pan = null; };
  }
  el.onchange = async (e) => {
    const f = e.target.dataset.f;
    if (f === 'file' && e.target.files[0]) { Object.assign(t, await loadImage(e.target.files[0])); t.cal = null; T.view = null; T.cal = []; T.pts = []; T.mode = 'scale'; commit(); }
    if (f === 'smooth') { t.smooth = e.target.checked; commit(); }
    if (f === 'hasSA') { t.hasSA = e.target.checked; commit(); }
  };
  el.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a, val = (f) => el.querySelector(`[data-f="${f}"]`)?.value;
    if (!a) return;
    if (a === 'photo') el.querySelector('[data-f="file"]').click();
    if (a.startsWith('mode-')) { T.mode = a.slice(5); T.cal = []; T.pts = []; T.finishing = false; renderTrace(el); }
    if (a === 'preset-a4' || a === 'preset-letter') { const [w, h] = a === 'preset-a4' ? [21, 29.7] : [21.59, 27.94]; el.querySelector('[data-f="rw"]').value = fmt(w); el.querySelector('[data-f="rh"]').value = fmt(h); }
    if (a === 'set-scale') { const real = parseLen(val('real')); if (real > 0) { t.cal = { mode: 'scale', a: T.cal[0], b: T.cal[1], real }; T.cal = []; T.mode = 'idle'; commit(); } }
    if (a === 'set-rect') { const w = parseLen(val('rw')), h = parseLen(val('rh')); if (w > 0 && h > 0) { t.cal = { mode: 'rect', corners: T.cal, w, h }; T.cal = []; T.mode = 'idle'; commit(); } }
    if (a === 'undo-pt') { T.pts.pop(); renderTrace(el); }
    if (a === 'close') { T.finishing = true; renderTrace(el); }
    if (a === 'cancel') { T.pts = []; T.finishing = false; T.mode = 'idle'; renderTrace(el); }
    if (a === 'add') {
      const map = toCm(t.cal), pts = T.pts.map((p) => ({ ...map(p), corner: p.corner }));
      const shape = traceShape(pts, { smooth: t.smooth !== false, sa: t.hasSA ? 0 : 1.5 }), b = bbox(shape.nodes);
      const n = Math.max(1, Math.round(+val('pcut') || 1));
      const p = piece(`trace-${uid()}`, val('tname') || 'Traced piece', shape, { cut: { n, mirror: el.querySelector('[data-f="pmirror"]').checked && n > 1 },
        marks: t.hasSA ? [{ type: 'text', pts: [{ x: b.x + b.w / 2, y: b.y + b.h * 0.75 }], text: 'seam allowance included' }] : [] });
      const right = g.pieces.length ? Math.max(...g.pieces.map((q) => { const bb = placedBox(q); return bb.x + bb.w; })) + 5 : 0;
      Object.assign(p, { id: uid(), custom: true, edited: true, traced: true, pos: { x: right - b.x, y: -b.y } });
      g.pieces.push(p); T.pts = []; T.finishing = false; T.mode = 'trace'; commit();
    }
    if (a === 'go-pattern') { S.tab = 'pattern'; commit(); }
  };
}
