// Draws one pattern piece as SVG in piece coordinates (cm). Used by the editor, previews and print.
import { offsetOutline, outline, segPts, bbox, nearestSeg, outSign, dist, lerp } from './geom.js';

const f2 = (n) => +n.toFixed(3);
export const pts = (a) => a.map((q) => `${f2(q.x)},${f2(q.y)}`).join(' ');
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function cutText(p) {
  const c = p.cut || { n: 1 };
  return `Cut ${c.n}${c.fold ? ' on fold' : ''}${c.mirror && c.n > 1 && !c.fold ? ' (mirror pairs)' : ''}`;
}

// A notch: short line crossing the cutting line toward the seam.
export function notchLine(p, q) {
  const ns = nearestSeg(p, q);
  if (!ns) return null;
  const { a, b } = ns.dir, L = dist(a, b) || 1, sg = outSign(p), n = { x: sg * (b.y - a.y) / L, y: -sg * (b.x - a.x) / L };
  const sa = p.segs[ns.i].sa || 0;
  return [{ x: ns.pt.x + n.x * sa, y: ns.pt.y + n.y * sa }, { x: ns.pt.x + n.x * (sa - 0.7), y: ns.pt.y + n.y * (sa - 0.7) }];
}

function arrow(tip, from, s, attrs) {
  const L = dist(tip, from) || 1, u = { x: (tip.x - from.x) / L, y: (tip.y - from.y) / L }, n = { x: -u.y, y: u.x };
  const a = { x: tip.x - u.x * s + n.x * s * 0.5, y: tip.y - u.y * s + n.y * s * 0.5 }, b = { x: tip.x - u.x * s - n.x * s * 0.5, y: tip.y - u.y * s - n.y * s * 0.5 };
  return `<polyline points="${pts([a, tip, b])}" ${attrs}/>`;
}
const readable = (deg) => (deg > 90 || deg < -90 ? deg + 180 : deg);

// opts: k = cm per screen px (editor), print = black-and-white print styling, selected, sub = small extra label line
export function pieceSVG(p, { k = 0.1, print = false, selected = false, sub = '' } = {}) {
  const SW = print
    ? { cut: 0.06, seam: 0.025, mark: 0.035, dash: '.35 .2', fold: '1 .25 .2 .25' }
    : { cut: 1.6 * k, seam: 1 * k, mark: 1.3 * k, dash: `${5 * k} ${4 * k}`, fold: `${10 * k} ${3 * k} ${2 * k} ${3 * k}` };
  const ink = print ? '#000' : '#3a3242', seam = outline(p), b = bbox(seam);
  let s = `<polygon ${print ? '' : `data-p="${p.id}" class="paper${selected ? ' sel' : ''}"`} points="${pts(offsetOutline(p))}" fill="${print ? 'none' : selected ? '#fcecf2' : '#fffdfb'}" stroke="${print ? '#000' : selected ? '#c03a6b' : ink}" stroke-width="${SW.cut}" stroke-linejoin="round"/>`;
  p.segs.forEach((sg, i) => {
    s += `<polyline points="${pts(segPts(p, i))}" fill="none" stroke="${sg.fold ? '#2563eb' : print ? '#555' : '#9c94a6'}" stroke-width="${sg.fold ? SW.cut : SW.seam}" stroke-dasharray="${sg.fold ? SW.fold : SW.dash}" pointer-events="none"/>`;
  });
  const g = `fill="none" stroke="${ink}" stroke-width="${SW.mark}" stroke-linejoin="round" pointer-events="none"`;
  const fs = Math.max(0.7, Math.min(2.2, Math.min(b.w, b.h) / 9));
  for (const m of p.marks || []) {
    if (m.type === 'text') s += `<text x="${f2(m.pts[0].x)}" y="${f2(m.pts[0].y)}" font-size="${fs * 0.55}" text-anchor="middle" fill="${ink}" pointer-events="none">${esc(m.text)}</text>`;
    else if (m.type === 'button') s += `<circle cx="${f2(m.pts[0].x)}" cy="${f2(m.pts[0].y)}" r="0.6" ${g}/>`;
    else s += `<polyline points="${pts(m.pts)}" ${g}${m.type === 'dash' ? ` stroke-dasharray="${SW.dash}"` : ''}/>`;
  }
  for (const q of p.notches || []) { const l = notchLine(p, q); if (l) s += `<line x1="${f2(l[0].x)}" y1="${f2(l[0].y)}" x2="${f2(l[1].x)}" y2="${f2(l[1].y)}" ${g} stroke-width="${SW.cut}"/>`; }
  const fi = p.segs.findIndex((x) => x.fold);
  if (fi >= 0) { // "place on fold" bracket instead of a grainline
    const a = p.nodes[fi], c = p.nodes[(fi + 1) % p.nodes.length], L = dist(a, c), u = { x: (c.x - a.x) / L, y: (c.y - a.y) / L }, sg = outSign(p);
    const inw = { x: -sg * u.y, y: sg * u.x }, off = Math.max(1.2, Math.min(3, b.w * 0.15, b.h * 0.15));
    const p0 = lerp(a, c, 0.12), p1 = lerp(a, c, 0.88), q0 = { x: p0.x + inw.x * off, y: p0.y + inw.y * off }, q1 = { x: p1.x + inw.x * off, y: p1.y + inw.y * off };
    const mid = lerp(q0, q1, 0.5), tp = { x: mid.x + inw.x * fs * 0.8, y: mid.y + inw.y * fs * 0.8 };
    s += `<polyline points="${pts([p0, q0, q1, p1])}" ${g}/>${arrow(p0, q0, fs * 0.5, g)}${arrow(p1, q1, fs * 0.5, g)}`;
    s += `<text transform="translate(${f2(tp.x)},${f2(tp.y)}) rotate(${f2(readable(Math.atan2(u.y, u.x) * 180 / Math.PI))})" font-size="${fs * 0.55}" text-anchor="middle" dominant-baseline="central" fill="${ink}" pointer-events="none">PLACE ON FOLD</text>`;
  } else if (p.grain) {
    const { a, b: c } = p.grain;
    s += `<line x1="${f2(a.x)}" y1="${f2(a.y)}" x2="${f2(c.x)}" y2="${f2(c.y)}" ${g}/>${arrow(a, c, fs * 0.5, g)}${arrow(c, a, fs * 0.5, g)}`;
  }
  const at = p.labelAt || { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  s += `<text x="${f2(at.x)}" y="${f2(at.y)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${ink}" pointer-events="none">${esc(p.name)}`
    + `<tspan x="${f2(at.x)}" dy="${fs * 1.25}" font-size="${fs * 0.72}" font-weight="400">${cutText(p)}</tspan>`
    + (sub ? `<tspan x="${f2(at.x)}" dy="${fs * 1.05}" font-size="${fs * 0.55}" font-weight="400" fill="${print ? '#444' : '#7b7486'}">${esc(sub)}</tspan>` : '') + '</text>';
  return s;
}

// Bounding box of a piece's cutting line in layout coordinates.
export const placedBox = (p) => { const b = bbox(offsetOutline(p)); return { x: b.x + p.pos.x, y: b.y + p.pos.y, w: b.w, h: b.h }; };
