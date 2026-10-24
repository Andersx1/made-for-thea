// Pattern-piece geometry. A piece outline is a closed path of `nodes`; segs[i] runs from
// nodes[i] to nodes[i+1] (wrapping) and is straight, or a cubic curve when it has c1/c2.
// Each seg carries its own seam allowance `sa` (cm); `fold: true` marks a cut-on-fold edge.

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const nextI = (p, i) => (i + 1) % p.nodes.length;

export function bez(a, c1, c2, b, t) {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

export function segPts(p, i, n = 24) {
  const a = p.nodes[i], b = p.nodes[nextI(p, i)], s = p.segs[i];
  if (!s.c1) return [a, b];
  const out = [];
  for (let k = 0; k <= n; k++) out.push(bez(a, s.c1, s.c2, b, k / n));
  return out;
}

export function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; }
export const segLen = (p, i) => polyLen(segPts(p, i, 96));
export function outline(p, n) { const o = []; p.segs.forEach((s, i) => o.push(...segPts(p, i, n).slice(0, -1))); return o; }
export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}
export function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function lineX(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y }, den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}
// Outward unit normal sign for this piece's winding.
export const outSign = (p) => (signedArea(outline(p)) > 0 ? 1 : -1);

// Cutting line: every edge pushed out by its own seam allowance, corners mitred
// (bevelled if a mitre would spike out more than 4× the allowance).
export function offsetOutline(p) {
  const sg = outSign(p), subs = [];
  p.segs.forEach((s, i) => {
    const q = segPts(p, i), d = s.sa || 0;
    for (let k = 1; k < q.length; k++) {
      const a = q[k - 1], b = q[k], L = dist(a, b);
      if (L < 1e-6) continue;
      const nx = sg * (b.y - a.y) / L, ny = -sg * (b.x - a.x) / L;
      subs.push({ a: { x: a.x + nx * d, y: a.y + ny * d }, b: { x: b.x + nx * d, y: b.y + ny * d }, d, at: a });
    }
  });
  const out = [];
  subs.forEach((Q, j) => {
    const P = subs[(j - 1 + subs.length) % subs.length], r = lineX(P.a, P.b, Q.a, Q.b);
    // Where the allowance changes between nearly straight edges the offset lines meet far away; bevel instead.
    if (r && dist(r, Q.at) <= Math.max(P.d, Q.d) * (Math.abs(P.d - Q.d) < 1e-9 ? 4 : 1.5) + 0.01) out.push(r);
    else out.push(P.b, Q.a);
  });
  return out;
}

function projSeg(q, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2)), pt = { x: a.x + u * dx, y: a.y + u * dy };
  return { u, pt, d: dist(q, pt) };
}
// Closest point on the seam line: segment index, curve parameter t, point, and local direction.
export function nearestSeg(p, q) {
  let best = null;
  p.segs.forEach((s, i) => {
    const n = s.c1 ? 48 : 1, pts = segPts(p, i, n);
    for (let k = 1; k < pts.length; k++) {
      const r = projSeg(q, pts[k - 1], pts[k]);
      if (!best || r.d < best.d) best = { i, d: r.d, pt: r.pt, t: (k - 1 + r.u) / n, dir: { a: pts[k - 1], b: pts[k] } };
    }
  });
  return best;
}

// Insert a node at parameter t on seg i (de Casteljau split for curves).
export function splitSeg(p, i, t) {
  const a = p.nodes[i], b = p.nodes[nextI(p, i)], s = p.segs[i];
  if (!s.c1) { p.nodes.splice(i + 1, 0, lerp(a, b, t)); p.segs.splice(i + 1, 0, { ...s }); return; }
  const ab = lerp(a, s.c1, t), bc = lerp(s.c1, s.c2, t), cd = lerp(s.c2, b, t), abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), m = lerp(abc, bcd, t);
  p.nodes.splice(i + 1, 0, m);
  p.segs.splice(i, 1, { ...s, c1: ab, c2: abc }, { ...s, c1: bcd, c2: cd });
}
export function deleteNode(p, i) {
  const n = p.nodes.length;
  if (n <= 3) return false;
  const pi = (i - 1 + n) % n, s0 = p.segs[pi], s1 = p.segs[i], m = { ...s0 };
  if (s0.c1 && s1.c1) { m.c1 = s0.c1; m.c2 = s1.c2; } else { delete m.c1; delete m.c2; }
  p.nodes.splice(i, 1);
  p.segs.splice(i, 1);
  p.segs[pi > i ? pi - 1 : pi] = m;
  return true;
}

// Apply a point transform to everything on a piece.
export function mapPiece(p, f) {
  p.nodes = p.nodes.map(f);
  p.segs.forEach((s) => { if (s.c1) { s.c1 = f(s.c1); s.c2 = f(s.c2); } });
  (p.marks || []).forEach((m) => { m.pts = m.pts.map(f); });
  p.notches = (p.notches || []).map(f);
  if (p.grain) p.grain = { a: f(p.grain.a), b: f(p.grain.b) };
}
export function rotate90(p) {
  const b = bbox(outline(p)), c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  mapPiece(p, (q) => ({ x: c.x - (q.y - c.y), y: c.y + (q.x - c.x) }));
}
export function flipX(p) {
  const b = bbox(outline(p)), cx = b.x + b.w / 2;
  mapPiece(p, (q) => ({ x: 2 * cx - q.x, y: q.y }));
}

// Circular arc as cubic segments of at most 90°.
export function arcSegs(c, r, a0, a1) {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9)), da = (a1 - a0) / n, k = 4 / 3 * Math.tan(da / 4), out = [];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + i * da, t1 = t0 + da;
    const p0 = { x: c.x + r * Math.cos(t0), y: c.y + r * Math.sin(t0) }, p1 = { x: c.x + r * Math.cos(t1), y: c.y + r * Math.sin(t1) };
    out.push({ c1: { x: p0.x - k * r * Math.sin(t0), y: p0.y + k * r * Math.cos(t0) }, c2: { x: p1.x + k * r * Math.sin(t1), y: p1.y - k * r * Math.cos(t1) }, to: p1 });
  }
  return out;
}

// Outline builder: path(x,y).L(x,y,sa).C(c1,c2,to,sa).A(centre,r,a0,a1,sa).Z(sa) → {nodes, segs}
export function path(x, y) {
  const nodes = [{ x, y }], segs = [];
  const api = {
    L(x, y, sa = 1.5, ex = {}) { segs.push({ sa, ...ex }); nodes.push({ x, y }); return api; },
    C(c1, c2, to, sa = 1.5, ex = {}) { segs.push({ sa, c1: { ...c1 }, c2: { ...c2 }, ...ex }); nodes.push({ x: to.x, y: to.y }); return api; },
    A(c, r, a0, a1, sa = 1.5, ex = {}) { for (const s of arcSegs(c, r, a0, a1)) api.C(s.c1, s.c2, s.to, sa, ex); return api; },
    Z(sa = 1.5, ex = {}) {
      if (nodes.length > 1 && dist(nodes[0], nodes[nodes.length - 1]) < 1e-6) nodes.pop();
      else segs.push({ sa, ...ex });
      return { nodes, segs };
    },
  };
  return api;
}

// First point where a polyline crosses the given y (or x).
export function atY(pts, y) {
  for (let k = 1; k < pts.length; k++) { const a = pts[k - 1], b = pts[k]; if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) return lerp(a, b, (y - a.y) / (b.y - a.y)); }
  return null;
}
export function atX(pts, x) {
  for (let k = 1; k < pts.length; k++) { const a = pts[k - 1], b = pts[k]; if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) return lerp(a, b, (x - a.x) / (b.x - a.x)); }
  return null;
}
