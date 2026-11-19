// Seams sewn by hand in the Pattern editor. An edge (seg) carries a mark, `sew`; edges with the same
// mark are sewn to each other, on the same piece or on different ones. `twin` on a mark means the edge
// is sewn to its own mirror image (a centre seam on a piece cut twice or on the fold).
// The 3D view reads the marks in sim/garment.js ("seams of your own").
import { segLen, nearestSeg, dist } from './geom.js';

const newMark = () => Math.random().toString(36).slice(2, 8);
const COLOURS = ['#e11d48', '#0284c7', '#d97706', '#059669', '#7c3aed', '#db2777', '#0d9488', '#ea580c'];
export const sewColour = (n) => COLOURS[n % COLOURS.length];
export const sewLetter = (n) => String.fromCharCode(65 + n % 26) + (n >= 26 ? Math.floor(n / 26) : '');

// Every mark and the edges that carry it: Map(mark → [{ p (the piece), segs: [seg numbers] }]).
// Neighbouring segs with the same mark are one edge (an edge with a point added along it is still one).
export function sewEdges(g) {
  const out = new Map();
  for (const p of g.pieces) {
    const n = p.segs.length, seen = new Set();
    for (let i = 0; i < n; i++) {
      const id = p.segs[i].sew;
      if (!id || seen.has(i)) continue;
      let a = i; // walk back to where this edge starts, then forward to its end
      for (let k = 0; k < n && p.segs[(a - 1 + n) % n].sew === id; k++) a = (a - 1 + n) % n;
      const segs = [];
      for (let j = a; segs.length < n && p.segs[j].sew === id; j = (j + 1) % n) { segs.push(j); seen.add(j); }
      if (!out.has(id)) out.set(id, []);
      out.get(id).push({ p, segs });
    }
  }
  return out;
}

const clear = (s) => { delete s.sew; delete s.twin; };
// Drop marks that no longer lead anywhere (the other piece was deleted or reset).
export function cleanSews(g) {
  for (const edges of sewEdges(g).values()) if (edges.length < 2 && !edges[0].p.segs[edges[0].segs[0]].twin) for (const i of edges[0].segs) clear(edges[0].p.segs[i]);
}
export function unsew(g, p, i) { clear(p.segs[i]); p.edited = true; cleanSews(g); }
// Sew edge i of piece p to edge j of piece q. An edge that's already sewn brings the other into its
// seam, so one long edge (a waistband, a collar) can be sewn to several edges in turn.
export function sewTo(g, p, i, q, j) {
  const s = p.segs[i], t = q.segs[j];
  if (s === t) return;
  if (s.twin) clear(s);
  if (t.twin) clear(t);
  if (s.sew && !t.sew) t.sew = s.sew; else if (t.sew) s.sew = t.sew; else s.sew = t.sew = newMark();
  p.edited = q.edited = true;
  cleanSews(g);
}
// Sew an edge to its own mirror image.
export function sewTwin(g, p, i) { clear(p.segs[i]); Object.assign(p.segs[i], { sew: newMark(), twin: true }); p.edited = true; cleanSews(g); }

// How many times an edge is cut: twice on the fold or as a pair, else once.
const times = (p) => (p.cut?.fold || p.segs.some((s) => s.fold) || (p.cut?.n || 1) >= 2 ? 2 : 1);
// Length of an edge along the stitching line, less any darts and pleats that close on it.
function edgeLen(e) {
  let L = e.segs.reduce((a, i) => a + segLen(e.p, i), 0);
  for (const mk of e.p.marks || []) {
    const pleat = mk.type === 'pleat' && mk.pts.length === 2;
    if (!pleat && !(mk.type === 'dart' && mk.pts.length === 3)) continue;
    const A = mk.pts[0], B = mk.pts[pleat ? 1 : 2], a = nearestSeg(e.p, A), b = nearestSeg(e.p, B);
    if (a.d < 0.3 && b.d < 0.3 && e.segs.includes(a.i) && e.segs.includes(b.i)) L -= dist(A, B);
  }
  return L;
}
// For the seam check: each hand-sewn seam, its two sides' lengths, and whether one will be gathered onto the other.
export function sewChecks(g) {
  const out = [];
  [...sewEdges(g)].forEach(([, edges], n) => {
    if (edges.length < 2) return;
    // One side is a single edge; with more than two edges, the sewn-on piece's edge is sewn to all the others.
    const lone = (edges.length > 2 && edges.find((e) => e.p.role === 'attach')) || edges[0], rest = edges.filter((e) => e !== lone);
    const same = rest.every((e) => e.p === lone.p), k = (e) => (same ? 1 : times(e.p));
    const a = edgeLen(lone) * k(lone), b = rest.reduce((t, e) => t + edgeLen(e) * k(e), 0), names = [...new Set(rest.map((e) => e.p.name))].join(' + ');
    out.push({ label: `Seam ${sewLetter(n)}: ${lone.p.name} to ${same ? 'itself' : names}`, a, b, diff: a - b, ok: Math.abs(a - b) <= 1, free: true });
  });
  return out;
}
