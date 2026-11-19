// Turns a pattern piece (its stitching line) into a triangle mesh of fabric.
// Boundary points are spaced evenly along each edge (so seams can be matched by name),
// interior points sit on a triangular lattice, and Delaunay triangulation joins them.
// Darts are cut out of the mesh; their two legs come back as chains to be sewn shut.
import { segPts, polyLen, lerp, dist } from '../geom.js';

function along(q, s) { // point at arc length s along polyline q
  for (let k = 1; k < q.length; k++) { const L = dist(q[k - 1], q[k]); if (s <= L || k === q.length - 1) return lerp(q[k - 1], q[k], L ? Math.min(1, s / L) : 0); s -= L; }
  return q[q.length - 1];
}
function arcOf(q, p) { // arc position of the point on polyline q closest to p, and its distance
  let best = { d: Infinity, s: 0 }, s0 = 0;
  for (let k = 1; k < q.length; k++) {
    const a = q[k - 1], b = q[k], L = dist(a, b), t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (L * L))) : 0, d = dist(p, lerp(a, b, t));
    if (d < best.d) best = { d, s: s0 + t * L };
    s0 += L;
  }
  return best;
}
export function inPoly(poly, x, y) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; }
function segDist(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); }
const polyArea = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };

// Bowyer–Watson Delaunay triangulation. Points go in from left to right, so a triangle whose circle lies
// wholly to the left of the point going in can never be undone by a later one and is set aside: each point
// is then checked against the triangles near the advancing front only, not all of them.
export function delaunay(pts) {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), mx = Math.min(...xs), my = Math.min(...ys), d = Math.max(Math.max(...xs) - mx, Math.max(...ys) - my) * 20;
  const P = [...pts, { x: mx - d, y: my - d }, { x: mx + 2 * d, y: my - d }, { x: mx - d, y: my + 2 * d }], n = pts.length;
  const circ = (a, b, c) => { const A = P[a], B = P[b], C = P[c], D = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y)); const ux = ((A.x ** 2 + A.y ** 2) * (B.y - C.y) + (B.x ** 2 + B.y ** 2) * (C.y - A.y) + (C.x ** 2 + C.y ** 2) * (A.y - B.y)) / D, uy = ((A.x ** 2 + A.y ** 2) * (C.x - B.x) + (B.x ** 2 + B.y ** 2) * (A.x - C.x) + (C.x ** 2 + C.y ** 2) * (B.x - A.x)) / D; return { x: ux, y: uy, r2: (A.x - ux) ** 2 + (A.y - uy) ** 2 }; };
  const tri = (t) => { const c = circ(...t); return { t, c, right: c.x + Math.sqrt(c.r2) }; }, order = pts.map((_, i) => i).sort((a, b) => P[a].x - P[b].x), settled = [];
  let tris = [tri([n, n + 1, n + 2])];
  for (const i of order) {
    const p = P[i], bad = [], keep = [];
    for (const T of tris) { if (T.right < p.x - 1e-9) settled.push(T); else ((p.x - T.c.x) ** 2 + (p.y - T.c.y) ** 2 < T.c.r2 ? bad : keep).push(T); }
    const edges = new Map();
    for (const { t } of bad) for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) { const k = a < b ? `${a},${b}` : `${b},${a}`; edges.set(k, edges.has(k) ? null : [a, b]); }
    for (const e of edges.values()) if (e) keep.push(tri([e[0], e[1], i]));
    tris = keep;
  }
  return [...settled, ...tris].map((T) => T.t).filter((t) => t.every((v) => v < n));
}

// Mirror a cut-on-fold piece across its fold edge into the full piece. Each seg gets side +1
// (the drafted half) or -1 (the mirrored half). Pieces without a fold are returned as they are.
export function unfold(p) {
  const f = p.segs.findIndex((s) => s.fold);
  if (f < 0) return { ...p, segs: p.segs.map((s) => ({ ...s, side: 1 })) };
  const n = p.nodes.length, A = [], S = [];
  for (let k = 1; k <= n; k++) A.push(p.nodes[(f + k) % n]);
  for (let k = 1; k < n; k++) S.push(p.segs[(f + k) % n]);
  const a = A[n - 1], b = A[0], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  const R = (q) => { const t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2, fx = a.x + t * dx, fy = a.y + t * dy; return { x: 2 * fx - q.x, y: 2 * fy - q.y }; };
  const nodes = [...A], segs = S.map((s) => ({ ...s, side: 1 }));
  for (let k = n - 2; k >= 1; k--) nodes.push(R(A[k]));
  for (let k = n - 2; k >= 0; k--) { const s = S[k]; segs.push(s.c1 ? { ...s, c1: R(s.c2), c2: R(s.c1), side: -1 } : { ...s, side: -1 }); }
  const marks = (p.marks || []).flatMap((mk) => (mk.type === 'dart' || mk.type === 'pleat' ? [mk, { ...mk, pts: mk.pts.map(R).reverse() }] : [mk]));
  return { ...p, nodes, segs, marks, unfolded: true, flip: R };
}

// h = target edge length (cm). Returns { pts (2D, cm), tris, runs: [{name, side, sew, twin, idx[]}] one per seg,
// darts: [[leg1 idx[], leg2 idx[]]], tucks: [{ a, b, ties }] pleats, dartEnds: Set of "a|b" boundary pairs that close together }.
export function meshPiece(p, h = 2) {
  const darts = (p.marks || []).filter((mk) => mk.type === 'dart' && (mk.pts.length === 3 || mk.pts.length === 5)).map((mk) => {
    const P = mk.pts;
    return P.length === 3 ? { poly: [P[0], P[1], P[2]], legs: [[P[0], P[1]], [P[2], P[1]]], ends: [P[0], P[2]] } : { poly: [P[0], P[1], P[2], P[3]], legs: [[P[0], P[1], P[2]], [P[0], P[3], P[2]]], ends: [] };
  });
  // A pleat is two points on an edge that are brought together: the cloth between them stays (it folds),
  // but for sewing the edge is as if that stretch weren't there. Returned as tucks: [{ a, b, ties }]: the two
  // points, and for each edge point between them the spot on the edge it is stitched flat against.
  const pleats = (p.marks || []).filter((mk) => mk.type === 'pleat' && mk.pts.length === 2);
  // Boundary, with the V-dart ends and the pleat ends forced onto it.
  const pts = [], runs = [], endIdx = new Map(), endRun = new Map();
  p.segs.forEach((s, i) => {
    const q = segPts(p, i, 48), L = polyLen(q), n = Math.max(1, Math.round(L / h)), forced = [];
    darts.forEach((D, di) => D.ends.forEach((e, k) => { const r = arcOf(q, e); if (r.d < 0.3 && r.s > 1e-3 && r.s < L - 1e-3) forced.push({ s: r.s, key: `${di}:${k}` }); }));
    pleats.forEach((mk, pi) => mk.pts.forEach((e, k) => { const r = arcOf(q, e); if (r.d < 0.3 && r.s > 1e-3 && r.s < L - 1e-3) { forced.push({ s: r.s, key: `p${pi}:${k}` }); endRun.set(`p${pi}:${k}`, i); } }));
    const at = [];
    for (let k = 0; k < n; k++) { const s = L * k / n; if (k === 0 || !forced.some((f) => Math.abs(f.s - s) < h * 0.45)) at.push({ s }); }
    at.push(...forced); at.sort((a, b) => a.s - b.s);
    const idx = [];
    for (const a of at) { if (a.key) endIdx.set(a.key, pts.length); idx.push(pts.length); pts.push(along(q, a.s)); }
    runs.push({ name: s.name || '', side: s.side ?? 1, sew: s.sew, twin: !!s.twin, open: !!s.open, idx });
  });
  runs.forEach((r, i) => r.idx.push(runs[(i + 1) % runs.length].idx[0])); // each run ends where the next begins
  // Pleats: the edge's points between the two ends leave the edge (they're no longer sewn or pinned with it).
  const tucks = [];
  pleats.forEach((mk, pi) => {
    const a = endIdx.get(`p${pi}:0`), b = endIdx.get(`p${pi}:1`), ri = endRun.get(`p${pi}:0`);
    if (a === undefined || b === undefined || ri !== endRun.get(`p${pi}:1`)) return; // both ends on one edge
    const idx = runs[ri].idx, ia = idx.indexOf(a), ib = idx.indexOf(b), lo = Math.min(ia, ib), hi = Math.max(ia, ib);
    // The first point is folded onto the second, so the cloth between doubles back under the edge on the first
    // point's far side: a point d cm into the pleat (from either end) lies against the edge d cm beyond the first point.
    const S = [0]; for (let k = 1; k < idx.length; k++) S.push(S[k - 1] + dist(pts[idx[k - 1]], pts[idx[k]]));
    const D = Math.abs(S[ib] - S[ia]), away = ia < ib ? -1 : 1, ties = [];
    for (let k = lo + 1; k < hi; k++) {
      const u = Math.abs(S[k] - S[ia]), at = Math.max(S[0], Math.min(S[S.length - 1], S[ia] + away * Math.min(u, D - u)));
      let j = away < 0 ? Math.max(0, ia - 1) : ia; // the edge link [j, j + 1] beyond the first point that holds that spot
      while (away < 0 ? j > 0 && S[j] > at : j < idx.length - 2 && S[j + 1] < at) j += away;
      ties.push([idx[k], idx[j], idx[j + 1], Math.max(0, Math.min(1, (at - S[j]) / ((S[j + 1] - S[j]) || 1)))]);
    }
    idx.splice(lo + 1, hi - lo - 1);
    tucks.push({ a, b, ties });
  });
  const nb = pts.length, poly = pts.slice(0, nb);
  // A dart drawn a hair short of (or past) a curved edge starts where its ends landed on the edge;
  // otherwise the triangle beside that corner counts as inside the dart and leaves a hole.
  darts.forEach((D, di) => D.ends.forEach((e, k) => { const i = endIdx.get(`${di}:${k}`); if (i !== undefined) D.legs[k][0] = D.poly[k * 2] = pts[i]; }));
  // Dart legs: shared end/tip points, evenly spaced points between.
  const legChains = [];
  darts.forEach((D, di) => {
    const L = polyLen(D.legs[0]), n = Math.max(2, Math.round(L / (h * 0.8))), tip = pts.length;
    const share = D.ends.length ? [] : [tip, tip + 1];
    if (D.ends.length) pts.push(D.legs[0][D.legs[0].length - 1]); else pts.push(D.legs[0][0], D.legs[0][D.legs[0].length - 1]);
    const chains = D.legs.map((leg, k) => {
      const c = [D.ends.length ? (endIdx.get(`${di}:${k}`) ?? -1) : share[0]], LL = polyLen(leg);
      // Even spacing, but the bend of a diamond dart's leg (at the waist) is always a point.
      const bend = leg.length === 3 ? dist(leg[0], leg[1]) : -1, jb = bend > 0 ? Math.round(n * bend / LL) : -1;
      for (let j = 1; j < n; j++) { c.push(pts.length); pts.push(j === jb ? leg[1] : along(leg, LL * j / n)); }
      c.push(D.ends.length ? tip : share[1]);
      return c;
    });
    if (chains.every((c) => c[0] >= 0)) legChains.push(chains);
  });
  const fixed = pts.length;
  // Interior lattice, kept clear of the boundary, the darts and their legs.
  const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const inDart = (x, y) => darts.some((D) => inPoly(D.poly, x, y) && D.poly.every((a, i) => segDist({ x, y }, a, D.poly[(i + 1) % D.poly.length]) > 0.01));
  for (let row = 0, y = y0 + h * 0.5; y < y1; y += h * 0.866, row++) for (let x = x0 + (row % 2 ? h / 2 : 0); x < x1; x += h) {
    // A little deterministic jitter, so folds don't line up with the lattice directions.
    const r1 = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453, r2 = Math.sin(x * 39.346 + y * 11.135) * 24634.6345;
    const q = { x: x + (r1 - Math.floor(r1) - 0.5) * h * 0.35, y: y + (r2 - Math.floor(r2) - 0.5) * h * 0.35 };
    if (!inPoly(poly, q.x, q.y) || inDart(q.x, q.y)) continue;
    let ok = true;
    for (let i = 0; i < nb && ok; i++) if (segDist(q, poly[i], poly[(i + 1) % nb]) < h * 0.55) ok = false;
    for (const D of darts) for (const leg of D.legs) for (let k = 1; k < leg.length && ok; k++) if (segDist(q, leg[k - 1], leg[k]) < h * 0.55) ok = false;
    for (let i = nb; i < fixed && ok; i++) if (dist(q, pts[i]) < h * 0.5) ok = false;
    if (ok) pts.push(q);
  }
  const adjacent = (a, b) => a < nb && b < nb && (Math.abs(a - b) === 1 || Math.abs(a - b) === nb - 1);
  const tris = delaunay(pts).filter((t) => {
    const A = pts[t[0]], B = pts[t[1]], C = pts[t[2]];
    if (Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y)) < h * h * 1e-3) return false; // sliver
    const cx = (A.x + B.x + C.x) / 3, cy = (A.y + B.y + C.y) / 3;
    if (!inPoly(poly, cx, cy) || inDart(cx, cy)) return false;
    for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) if (!adjacent(a, b)) { const mid = lerp(pts[a], pts[b], 0.5); if (!inPoly(poly, mid.x, mid.y) || inDart(mid.x, mid.y)) return false; }
    return true;
  });
  // Drop points no triangle uses (e.g. on the base of a dart) from the seam runs.
  const used = new Uint8Array(pts.length);
  for (const t of tris) for (const v of t) used[v] = 1;
  for (const r of runs) r.idx = r.idx.filter((v) => used[v]);
  const dartEnds = new Set();
  for (const [A, B] of legChains) if (A[0] !== B[0]) { dartEnds.add(`${A[0]}|${B[0]}`); dartEnds.add(`${B[0]}|${A[0]}`); }
  for (const { a, b } of tucks) { dartEnds.add(`${a}|${b}`); dartEnds.add(`${b}|${a}`); } // along the edge, a pleat's two ends are the same spot
  return { pts, tris, runs, darts: legChains.map(([A, B]) => [A.filter((v) => used[v]), B.filter((v) => used[v])]), dartEnds, tucks, used, area: polyArea(poly) };
}
