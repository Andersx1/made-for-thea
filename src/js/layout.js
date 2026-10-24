// Cutting layout: turns pattern pieces into the shapes actually laid on fabric (grainline along
// the selvedge, fold pieces against the fold, mirror pairs), packs them, and reports the length.
import { offsetOutline, bbox } from './geom.js';

export const WIDTHS = { metric: [[110, '110 cm'], [140, '140 cm'], [150, '150 cm']], imperial: [[114.3, '45"'], [147.3, '58"'], [152.4, '60"']] };

export function groupOf(p, type) {
  if (/lining/i.test(p.name)) return 'lining';
  if ((type === 'trousers' || type === 'jeans') && /pocket bag/i.test(p.name)) return 'pocketing';
  return 'main';
}
export const GROUP_NAMES = { main: 'Main fabric', lining: 'Lining', pocketing: 'Pocketing' };

// Cutting outline rotated so the grain (or the fold edge) runs down the fabric length (+y).
function oriented(p) {
  const fi = p.segs.findIndex((s) => s.fold);
  const a = fi >= 0 ? p.nodes[fi] : p.grain.a, b = fi >= 0 ? p.nodes[(fi + 1) % p.nodes.length] : p.grain.b;
  const ang = Math.PI / 2 - Math.atan2(b.y - a.y, b.x - a.x), c = Math.cos(ang), s = Math.sin(ang);
  const R = (q) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c });
  return { pts: offsetOutline(p).map(R), foldX: fi >= 0 ? R(a).x : null };
}
const shift = (pts, dx, dy) => pts.map((q) => ({ x: q.x + dx, y: q.y + dy }));
const mirror = (pts, x0) => pts.map((q) => ({ x: 2 * x0 - q.x, y: q.y }));

// Shapes to cut. folded = fabric folded lengthwise (two layers, fold on the left).
export function instances(pieces, { folded }) {
  const out = [];
  for (const p of pieces) {
    const { pts, foldX } = oriented(p), n = p.cut?.n || 1;
    if (foldX != null) {
      let poly = pts, fx = foldX;
      const b = bbox(poly);
      if (folded) {
        if (fx > b.x + b.w / 2) { poly = mirror(poly, 0); fx = -fx; } // put the fold edge on the left
        poly = shift(poly, -fx, -bbox(poly).y);
        for (let k = 0; k < n; k++) out.push({ id: `${p.id}#${k}`, pid: p.id, name: p.name, polys: [poly], onFold: true });
      } else {
        const both = [poly, mirror(poly, fx)], bb = bbox(both.flat());
        for (let k = 0; k < n; k++) out.push({ id: `${p.id}#${k}`, pid: p.id, name: p.name, polys: both.map((q) => shift(q, -bb.x, -bb.y)) });
      }
    } else {
      const b = bbox(pts), base = shift(pts, -b.x, -b.y);
      const count = folded ? Math.ceil(n / 2) : n;
      for (let k = 0; k < count; k++) {
        const flip = !folded && p.cut?.mirror && k % 2 === 1;
        out.push({ id: `${p.id}#${k}`, pid: p.id, name: p.name, polys: [flip ? mirror(base, b.w / 2) : base], single: folded && n % 2 === 1 && k === count - 1 });
      }
    }
  }
  for (const i of out) { const b = bbox(i.polys.flat()); i.w = b.w; i.h = b.h; }
  return out;
}

// Bottom-left strip packing across the usable fabric width. Fold pieces go against the fold (x = 0).
export function pack(insts, width, gap = 1.5) {
  const placed = [], items = [...insts].sort((a, b) => (b.onFold - a.onFold) || b.w * b.h - a.w * a.h);
  const free = (x, y, w, h) => x + w <= width + 1e-6 && placed.every((r) => x >= r.x + r.w + gap - 1e-6 || x + w + gap <= r.x + 1e-6 || y >= r.y + r.h + gap - 1e-6 || y + h + gap <= r.y + 1e-6);
  for (const it of items) {
    let best = null;
    const xs = it.onFold ? [0] : [0, ...placed.map((r) => r.x + r.w + gap)];
    for (const y of [0, ...placed.map((r) => r.y + r.h + gap)]) for (const x of xs)
      if ((!best || y < best.y || (y === best.y && x < best.x)) && free(x, y, it.w, it.h)) best = { x, y };
    it.tooWide = !best;
    const at = best || { x: 0, y: Math.max(0, ...placed.map((r) => r.y + r.h + gap)) };
    placed.push({ ...it, ...at });
  }
  return placed;
}
export const lengthOf = (placed) => Math.max(0, ...placed.map((r) => r.y + r.h));
// Shop length: +10% for straightening and shrinkage, rounded up to 10 cm (or ¼ yd).
export const toBuy = (len, metric) => (metric ? Math.ceil(len * 1.1 / 10 - 1e-9) * 10 : Math.ceil(len * 1.1 / 22.86 - 1e-9) * 22.86);
