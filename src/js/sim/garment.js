// Builds the cloth model of a garment from its pattern pieces (hand edits included): which pieces
// become fabric, their meshes, where each starts around the body, and the seams, darts and
// waist pins that hold them together. Body coordinates: cm, y up, front +z, her left side +x.
import { meshPiece, unfold } from './mesh.js';
import { rotate90, flipX, deleteNode, dist, bbox, mapPiece, outline } from '../geom.js';
import { sample } from './sdf.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const perim = (a, b) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

// ---------- body proxy: simple shapes for placing pieces before the simulation ----------
const bboxOf = (P, loop) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const i of loop) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i * 3 + k]); hi[k] = Math.max(hi[k], P[i * 3 + k]); } return { lo, hi, c: lo.map((v, k) => (v + hi[k]) / 2), e: lo.map((v, k) => (hi[k] - v) / 2) }; };
const v3 = (P, i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(...a), nrm = (a) => scl(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const interp = (levels, h) => { // levels sorted by h ascending: [{h, ...numbers}]
  if (h <= levels[0].h) return levels[0];
  for (let i = 1; i < levels.length; i++) if (h <= levels[i].h) { const A = levels[i - 1], B = levels[i], t = (h - A.h) / (B.h - A.h), o = {}; for (const k in A) o[k] = mix(A[k], B[k], t); return o; }
  return levels[levels.length - 1];
};

export function bodyProxy(body) {
  const P = body.pos, L = body.loops, M = body.landmarks;
  const ell = (name, h) => { const b = bboxOf(P, L[name]); return { h: h ?? b.c[1], cz: b.c[2], a: b.e[0], b: b.e[2] }; };
  const hip = ell('hips-circ'), bust = ell('bust-circ');
  const torso = [{ ...hip, h: hip.h - 40 }, hip, ell('waist-circ'), ell('underbust-circ'), bust, { ...bust, h: bust.h + 40 }].sort((a, b) => a.h - b.h);
  const limb = (name) => { const b = bboxOf(P, L[name]); return { h: b.c[1], x: b.c[0], z: b.c[2], r: (b.e[0] + b.e[2]) / 2 }; };
  const thigh = limb('thigh-circ');
  const leg = [{ ...limb('ankle-circ'), h: -5 }, limb('ankle-circ'), limb('calf-circ'), limb('knee-circ'), thigh, { ...thigh, h: thigh.h + 30 }].sort((a, b) => a.h - b.h);
  // Arm centre line: from the shoulder joint through the upper arm to the wrist, refined by
  // averaging the arm's vertices in slices along it (the elbow is slightly bent).
  const S = v3(P, M.shoulderL), B = bboxOf(P, L['upperarm-circ']).c, W = bboxOf(P, L['wrist-circ']).c;
  const J = [S[0] - 2, S[1] - 4.5, (S[2] + B[2]) / 2], guess = [J, B, W], cl = [J];
  const at = (poly, t) => { const segs = poly.slice(1).map((q, i) => len(sub(q, poly[i]))), T = segs.reduce((a, b) => a + b) * t; let s = 0; for (let i = 0; i < segs.length; i++) { if (s + segs[i] >= T || i === segs.length - 1) { const u = (T - s) / segs[i]; return { p: add(poly[i], scl(sub(poly[i + 1], poly[i]), u)), d: nrm(sub(poly[i + 1], poly[i])) }; } s += segs[i]; } };
  for (let k = 1; k <= 12; k++) {
    const { p, d } = at(guess, k / 12);
    let c = [0, 0, 0], n = 0;
    for (let i = 0; i < P.length / 3; i++) { if (P[i * 3] < 17) continue; const q = v3(P, i), r = sub(q, p), a = dot(r, d); if (Math.abs(a) < 1.2 && len(sub(r, scl(d, a))) < 7) { c = add(c, q); n++; } }
    cl.push(n > 6 ? scl(c, 1 / n) : p);
  }
  const rB = bboxOf(P, L['upperarm-circ']).e, rW = bboxOf(P, L['wrist-circ']).e, rUp = (rB[0] + rB[2]) / 2, rWr = (rW[0] + rW[2]) / 2;
  const arm = []; let s = 0;
  for (let i = 0; i < cl.length; i++) {
    if (i) s += len(sub(cl[i], cl[i - 1]));
    const u = nrm(sub(cl[Math.min(i + 1, cl.length - 1)], cl[Math.max(i - 1, 0)])), top = nrm(sub([0, 1, 0], scl(u, u[1]))), front = cross(u, top);
    arm.push({ s, p: cl[i], u, top, front });
  }
  const armLen = s;
  for (const a of arm) a.r = a.s < armLen * 0.35 ? rUp * 1.05 : mix(rUp, rWr, (a.s - armLen * 0.35) / (armLen * 0.65));
  return { torso: (h) => interp(torso, h), leg: (h) => interp(leg, h), arm, armLen, M };
}
function armAt(B, s) { // arm frame at arc length s from the shoulder joint (extrapolates past the wrist)
  const A = B.arm;
  let i = 1; while (i < A.length - 1 && A[i].s < s) i++;
  const a = A[i - 1], b = A[i], t = (s - a.s) / ((b.s - a.s) || 1), tt = clamp(t, 0, 1);
  const p = add(a.p, scl(sub(b.p, a.p), t)), mixv = (x, y) => nrm(add(scl(x, 1 - tt), scl(y, tt)));
  return { p, u: mixv(a.u, b.u), top: mixv(a.top, b.top), front: mixv(a.front, b.front), r: mix(a.r, b.r, tt) };
}

// ---------- girth loops: a body section inflated (and fluted for flared or gathered cloth) ----------
// to the garment's girth at that level. loopAt returns [x, z] (relative to the section centre)
// for a signed arc length s measured from the front centre.
const LOOPS = new Map();
function loopTable(a, b, G, cmin, cmax, folds) {
  const key = [a, b, G, cmin, cmax, folds].map((v) => v.toFixed(1)).join('|');
  if (LOOPS.has(key)) return LOOPS.get(key);
  const c = clamp((G - perim(a, b)) / (2 * Math.PI), cmin, cmax), A = a + c, Bb = b + c, n = 96;
  const build = (amp) => {
    const pts = [], S = [0];
    for (let k = 0; k <= n; k++) {
      const th = Math.PI * k / n, nx = Math.sin(th) / A, nz = Math.cos(th) / Bb, nl = Math.hypot(nx, nz), w = amp * (1 - Math.cos(folds * th)) / 2;
      pts.push([A * Math.sin(th) + w * nx / nl, Bb * Math.cos(th) + w * nz / nl]);
      if (k) S.push(S[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    }
    return { pts, S };
  };
  let T = build(0);
  if (T.S[n] * 2 < G * 0.99) { // flutes: solve the amplitude that makes the loop as long as the cloth
    let lo = 0, hi = G;
    for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (build(mid).S[n] * 2 < G) lo = mid; else hi = mid; }
    T = build((lo + hi) / 2);
  }
  if (LOOPS.size > 20000) LOOPS.clear();
  LOOPS.set(key, T);
  return T;
}
function loopAt(T, s) {
  const { pts, S } = T, n = S.length - 1, as = clamp(Math.abs(s), 0, S[n]);
  let i = 1; while (i < n && S[i] < as) i++;
  const t = (as - S[i - 1]) / ((S[i] - S[i - 1]) || 1), x = mix(pts[i - 1][0], pts[i][0], t), z = mix(pts[i - 1][1], pts[i][1], t);
  return [s < 0 ? -x : x, z];
}
const halfLoop = (T) => T.S[T.S.length - 1];

// ---------- which pieces become fabric ----------
const TORSO = ['front', 'back', 'sidefront', 'sideback', 'frontyoke', 'backyoke'];
export function frameOf(type, key) {
  if (key.startsWith('attach:')) return 'attach';
  if (key === 'sleeve' && ['top', 'dress', 'jacket'].includes(type)) return 'sleeve';
  if (type === 'trousers' || type === 'jeans') return ['front', 'back', 'yoke'].includes(key) ? 'legs' : null;
  if (type === 'top' || type === 'jacket') return TORSO.includes(key) ? 'torso' : null;
  if (type === 'dress' && !key.startsWith('skirt')) return TORSO.includes(key) ? 'torso' : null;
  if (type === 'skirt' || type === 'dress') {
    const k = type === 'dress' ? key.slice(5) : key;
    if (k === 'front' || k === 'back') return 'skirt';
    if (k === 'panel') return 'circle';
    if (/^tier\d$/.test(k)) return 'tier';
  }
  return null;
}
// Your own pieces (drawn, traced or duplicated) say which drafted piece they act as in 3D, and
// their edges are named like the drafted ones so the same seam rules sew them.
export const ROLES = {
  'bodice-front': ['Bodice front', 'torso'], 'bodice-back': ['Bodice back', 'torso'], 'bodice-sidefront': ['Side front panel', 'torso'], 'bodice-sideback': ['Side back panel', 'torso'],
  sleeve: ['Sleeve', 'sleeve'], 'skirt-front': ['Skirt front', 'skirt'], 'skirt-back': ['Skirt back', 'skirt'], 'legs-front': ['Trouser front', 'legs'], 'legs-back': ['Trouser back', 'legs'],
  // No place of its own on the body: it starts along the edges it's sewn to (see "seams of your own" in assemble).
  attach: ['Sewn-on piece (collar, cuff, waistband, ruffle…)', 'attach'],
  // Not cloth of its own in 3D: it lies flat on the piece it's sewn onto (p.on), wherever that goes.
  patch: ['Pocket or patch (sewn flat onto a piece)', 'patch'],
};
// A pocket or patch: a piece with a place on another piece, p.on = { p: that piece's id, x, y (its top-left corner there, cm) }.
// Drafted pocket pieces can be given one too.
export const isPatch = (p) => !!p.on?.p && (!p.custom || p.role === 'patch');
export const EDGES = {
  torso: [['side', 'Side seam'], ['shoulder', 'Shoulder'], ['armhole', 'Armhole'], ['centre', 'Centre seam'], ['princess', 'Panel seam'], ['hem', 'Bottom (joins a skirt)']],
  sleeve: [['cap', 'Sleeve cap (armhole)'], ['underarm', 'Underarm seam']],
  skirt: [['side', 'Side seam'], ['centre', 'Centre seam'], ['waist', 'Waist']],
  legs: [['side', 'Side seam'], ['inseam', 'Inside leg'], ['centre', 'Centre / crotch'], ['waist', 'Waist']],
  attach: [], patch: [],
};
// Garments of your own pieces sew up as a top, skirt, dress or trousers depending on the pieces.
export function simType(g) {
  if (g.type !== 'traced' && g.type !== 'custom') return g.type;
  const fam = new Set(g.pieces.filter((p) => ROLES[p.role]).map((p) => ROLES[p.role][1])), top = fam.has('torso') || fam.has('sleeve');
  return top && fam.has('skirt') ? 'dress' : top ? 'top' : fam.has('skirt') ? 'skirt' : fam.has('legs') ? 'trousers' : null;
}
const roleKey = (type, role) => { const k = role.replace(/^\w+-/, ''); return role.startsWith('skirt-') && type === 'dress' ? 'skirt' + k : k; };
// Turn a piece of your own the way drafted pieces lie: waist, shoulder or cap at the top, the side
// seam on the right (+x), and the top at y 0 with the centre at x 0 (sleeves centred on x 0).
function upright(p, frame) {
  const on = (names) => p.segs.flatMap((s, i) => (names.includes(s.name) ? [p.nodes[i], p.nodes[(i + 1) % p.nodes.length]] : []));
  const mean = (a, k) => a.reduce((t, q) => t + q[k], 0) / a.length;
  if (on(['waist', 'shoulder', 'cap']).length) {
    let best = 0, lo = Infinity;
    for (let r = 0; r < 4; r++) { const v = mean(on(['waist', 'shoulder', 'cap']), 'y') - mean(p.nodes, 'y'); if (v < lo) { lo = v; best = r; } rotate90(p); }
    for (let r = 0; r < best; r++) rotate90(p);
  }
  if (frame !== 'sleeve' && on(['side']).length && mean(on(['side']), 'x') < mean(p.nodes, 'x')) flipX(p);
  const b = bbox(p.nodes), dx = frame === 'sleeve' ? b.x + b.w / 2 : b.x;
  mapPiece(p, (q) => ({ x: q.x - dx, y: q.y - b.y }));
}
const faceOf = (key) => (key.includes('back') || key === 'yoke' ? -1 : 1); // +1 front, -1 back

// A copy of the piece in its drafting frame (layout turns and flips undone).
function drafted(p0, extra = []) {
  const p = structuredClone({ key: p0.key, nodes: p0.nodes, segs: p0.segs, marks: [...(p0.marks || []), ...extra], notches: [], grain: p0.grain, cut: p0.cut });
  if (p0.flipped) flipX(p);
  for (let i = 0; i < (4 - (p0.turns || 0)) % 4; i++) rotate90(p);
  return p;
}
// Drop zero-length edges (after clamping), keeping the edge that follows each.
function dropDegenerate(p) {
  const n = p.nodes.length, keep = p.nodes.map((q, k) => dist(q, p.nodes[(k + 1) % n]) > 1e-6);
  p.nodes = p.nodes.filter((_, k) => keep[k]); p.segs = p.segs.filter((_, k) => keep[k]);
}
// Pattern clean-ups that the sewn garment doesn't have: button stands and wrap overlaps are
// trimmed to the centre line (closed), fly extensions removed, slant/scoop pocket corners filled.
function tidy(p, frame, all) {
  if ((frame === 'torso' || frame === 'skirt') && faceOf(p.key) > 0 && p.nodes.some((q) => q.x < -0.3)) {
    const cx = (q) => { if (q) q.x = Math.max(0, q.x); };
    p.nodes.forEach(cx); p.segs.forEach((s) => { cx(s.c1); cx(s.c2); });
    dropDegenerate(p);
    p.segs.forEach((s, i) => { const a = p.nodes[i], b = p.nodes[(i + 1) % p.nodes.length]; if (a.x < 0.01 && b.x < 0.01 && !s.c1 && Math.abs(a.y - b.y) > 0.5) s.name = 'centre'; });
  }
  if (frame === 'legs') {
    let fly = false;
    for (let i; (i = p.segs.findIndex((s) => s.name === 'fly')) > 0;) { deleteNode(p, i); fly = true; }
    if (fly) p.segs[0].name = 'centre'; // the fly extension's top edge now runs down the centre front
    const k = p.segs.findIndex((s) => s.name === 'pocket'), fc = all.find((q) => q.key === 'facing');
    if (k >= 0 && fc) {
      const F = drafted(fc), side = F.segs.find((s) => s.name === 'side' && s.c1), sw = F.nodes[0];
      if (side) { p.nodes.splice(k + 1, 0, { ...sw }); p.segs.splice(k, 1, { name: 'side', sa: 1.5, c1: { ...side.c1 }, c2: { ...side.c2 } }, { name: 'waist', sa: 1 }); }
    }
  }
  if (frame === 'torso' && p.key === 'back' && !p.own && p.segs.length === 4 && !p.segs[0].name) { // shirred back panel
    ['top', 'side', 'hem'].forEach((n, i) => { p.segs[i].name = n; });
    const f = all.find((q) => q.key === 'front'), F = f && drafted(f), sy = F ? Math.min(...F.nodes.filter((_, i) => F.segs[i].name === 'side').map((q) => q.y)) : 20;
    const dy = sy - Math.min(...p.nodes.map((q) => q.y));
    p.nodes.forEach((q) => { q.y += dy; }); p.marks.forEach((mk) => mk.pts.forEach((q) => { q.y += dy; }));
    p.shirred = true;
  }
  if (frame === 'tier' && p.segs.length === 4 && !p.segs[0].name) ['top', 'side', 'bottom', 'side'].forEach((n, i) => { p.segs[i].name = n; });
  return p;
}

// ---------- seams ----------
// Rules per garment type: [A, B] where each side is {keys, names, join?}; B = 'self' pairs chains of
// A among themselves; kind 'loop' matches by angle around the body (gathered waist seams).
const S_ = (keys, names, join = false) => ({ keys, names, join });
function rulesFor(type, o) {
  const R = [];
  const bodice = (pre = '') => {
    const k = (...ks) => ks.map((x) => pre + x);
    R.push([S_(['front', 'sidefront'], ['side'], true), S_(['back', 'sideback'], ['side'], true)]);
    R.push([S_(['front'], ['shoulder']), S_(['back'], ['shoulder'])]);
    R.push([S_(['front'], ['princess']), S_(['sidefront'], ['princess'])], [S_(['back'], ['princess']), S_(['sideback'], ['princess'])]);
    R.push([S_(['back'], ['centre']), 'self'], [S_(['front'], ['centre']), 'self']);
    R.push([S_(['sleeve'], ['capF']), S_(['front', 'sidefront'], ['armhole'], true)], [S_(['sleeve'], ['capB']), S_(['back', 'sideback'], ['armhole'], true)]);
    R.push([S_(['sleeve'], ['underarm']), 'self']);
    return k;
  };
  const skirt = (pre = '') => {
    const k = (x) => pre + x;
    R.push([S_([k('front')], ['side']), S_([k('back')], ['side'])], [S_([k('back')], ['centre']), 'self'], [S_([k('front')], ['centre']), 'self']);
    R.push([S_([k('panel')], ['side']), 'self']);
    for (let i = 0; i < 3; i++) { R.push([S_([k('tier' + i)], ['side']), 'self']); R.push([S_([k('tier' + i)], ['bottom']), S_([k('tier' + (i + 1))], ['top']), 'loop']); }
  };
  if (type === 'top') bodice();
  if (type === 'dress') { bodice(); skirt('skirt'); R.push([S_(['front', 'back', 'sidefront', 'sideback'], ['hem']), S_(['skirtfront', 'skirtback', 'skirtpanel', 'skirttier0'], ['waist', 'top']), 'loop']); }
  if (type === 'skirt') skirt();
  if (type === 'jacket') {
    R.push([S_(['sidefront'], ['side']), S_(['sideback'], ['side'])], [S_(['front'], ['panel']), S_(['sidefront'], ['panel'])], [S_(['back'], ['panel']), S_(['sideback'], ['panel'])]);
    R.push([S_(['frontyoke'], ['yoke']), S_(['front', 'sidefront'], ['yoke'], true)], [S_(['backyoke'], ['yoke']), S_(['back', 'sideback'], ['yoke'], true)]);
    R.push([S_(['frontyoke'], ['shoulder']), S_(['backyoke'], ['shoulder'])], [S_(['front', 'frontyoke'], ['centre']), 'self']);
    R.push([S_(['sleeve'], ['capF']), S_(['frontyoke', 'sidefront'], ['armhole'], true)], [S_(['sleeve'], ['capB']), S_(['backyoke', 'sideback'], ['armhole'], true)], [S_(['sleeve'], ['underarm']), 'self']);
  }
  if (type === 'trousers' || type === 'jeans') {
    R.push([S_(['front'], ['side']), S_(['back', 'yoke'], ['side'], true)], [S_(['front'], ['inseam']), S_(['back'], ['inseam'])]);
    R.push([S_(['front'], ['centre', 'crotch']), 'self'], [S_(['back'], ['centre', 'crotch']), 'self'], [S_(['yoke'], ['centre']), 'self'], [S_(['yoke'], ['yoke']), S_(['back'], ['yoke'])]);
  }
  const pins = { skirt: [['front', 'back', 'panel', 'tier0'], ['waist', 'top']], trousers: [['front', 'back', 'yoke'], ['waist']], jeans: [['front', 'back', 'yoke'], ['waist']] }[type];
  return { rules: R, pins };
}

// For drawing stitch lines a little way in from an edge: for each point on a piece's edge, the
// neighbouring point that lies most squarely inside the piece (inU), and how far in it is (inPerp, cm).
function inward(M) {
  const ring = [...new Set(M.runs.flatMap((r) => r.idx))], n = ring.length, on = new Set(ring), nbr = new Map(ring.map((v) => [v, new Set()]));
  for (const t of M.tris) for (const a of t) if (on.has(a)) for (const b of t) if (b !== a) nbr.get(a).add(b);
  M.inU = new Int32Array(M.pts.length).fill(-1); M.inPerp = new Float32Array(M.pts.length); M.nbr = nbr;
  ring.forEach((v, k) => {
    const a = M.pts[ring[(k - 1 + n) % n]], b = M.pts[ring[(k + 1) % n]], p = M.pts[v], tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
    let best = 0;
    for (const u of nbr.get(v)) {
      const q = M.pts[u], perp = Math.abs((q.x - p.x) * ty - (q.y - p.y) * tx) / tl, score = perp / (dist(p, q) || 1) * (on.has(u) ? 0.5 : 1);
      if (perp > 0.2 && score > best) { best = score; M.inU[v] = u; M.inPerp[v] = perp; }
    }
  });
  return M;
}

// A piece's triangles (as one list of point numbers within the piece), wound so the front of each faces away
// from the body: the inside can then be drawn in another colour, and the piece can stand in as a solid for
// the next garment to lie on. The side is voted on by the whole piece: the skin's direction where it's near
// the body, outward from the body's centre line elsewhere.
export function outward(sys, I, F) {
  const x = sys.x, T = I.pc.mesh.tris, probe = [0, 0, 0, 0];
  let vote = 0;
  for (const [a, b, c] of T) {
    const A = (I.base + a) * 3, B = (I.base + b) * 3, C = (I.base + c) * 3;
    const ux = x[B] - x[A], uy = x[B + 1] - x[A + 1], uz = x[B + 2] - x[A + 2], vx = x[C] - x[A], vy = x[C + 1] - x[A + 1], vz = x[C + 2] - x[A + 2];
    const cx = (x[A] + x[B] + x[C]) / 3, cy = (x[A + 1] + x[B + 1] + x[C + 1]) / 3, cz = (x[A + 2] + x[B + 2] + x[C + 2]) / 3;
    let o = [cx, 0, cz];
    if (sample(F, cx, cy, cz, probe) && probe[0] < F.band - 0.1 && Math.hypot(probe[1], probe[2], probe[3]) > 0.3) o = [probe[1], probe[2], probe[3]];
    const ol = Math.hypot(...o) || 1;
    vote += ((uy * vz - uz * vy) * o[0] + (uz * vx - ux * vz) * o[1] + (ux * vy - uy * vx) * o[2]) / ol;
  }
  return vote < 0 ? T.flatMap(([a, b, c]) => [a, c, b]) : T.flat();
}
// Move every point of the cloth that is inside what it lies on out to just above the surface.
export function liftOut(sys, F) {
  const x = sys.x, probe = [0, 0, 0, 0];
  let moved = 0;
  for (let i = 0; i < sys.N; i++) {
    let qx = x[i * 3], qy = x[i * 3 + 1], qz = x[i * 3 + 2], hit = false;
    for (let it = 0; it < 40; it++) {
      const inGrid = sample(F, qx, qy, qz, probe), d = probe[0], gl = Math.hypot(probe[1], probe[2], probe[3]);
      if (!inGrid || d >= 0.6) break;
      hit = true;
      if (gl > 0.3) { const k = (0.65 - d) / gl; qx += probe[1] * k; qy += probe[2] * k; qz += probe[3] * k; }
      else { const rl = Math.hypot(qx, qz) || 1; qx += qx / rl * 1.5; qz += qz / rl * 1.5; } // too deep to tell which way is out: away from the centre line
    }
    if (hit) { x[i * 3] = qx; x[i * 3 + 1] = qy; x[i * 3 + 2] = qz; moved++; }
  }
  return moved;
}

// Meshing a piece is the slow part of assembling a garment, and after a pattern edit all but one piece are
// as they were, so meshes are kept by what the piece looked like (they are never changed once made).
const MESHES = new Map();
function meshOf(p, h) {
  const key = JSON.stringify([p.nodes, p.segs, (p.marks || []).filter((mk) => mk.type === 'dart' || mk.type === 'pleat'), h]);
  let M = MESHES.get(key);
  if (!M) { M = inward(meshPiece(p, h)); MESHES.set(key, M); if (MESHES.size > 80) MESHES.delete(MESHES.keys().next().value); }
  return M;
}

// ---------- assembly ----------
// Returns { inst: [{key, pts2, tris, base}], x (Float32Array 3N initial positions), uv, mass,
// stretch/bend (Int32 pairs + rest), seams [[i, j0, j1, t]] (i sewn to a spot between j0 and j1), pins [[i, x, y, z]],
// lines / hems (chains of points along each seam and each open edge, for drawing them), inU / inPerp (see inward),
// patches (pockets lying on the cloth: their own little mesh and what each point is tied to) }.
export function assemble(g, m, body, F, { maxPoints = 7000, hMin = 1.6 } = {}) { // hMin: the finest the cloth's points are spaced, cm
  const B = bodyProxy(body), M = B.M;
  const type = simType(g);
  if (!type) return null;
  const { rules, pins: pinRule } = rulesFor(type, g.options);
  const keyOf = (p) => (isPatch(p) || p.role === 'patch' ? null : !p.custom ? p.key : p.role === 'attach' ? `attach:${p.id ?? p.key}` : ROLES[p.role] ? roleKey(type, p.role) : null);
  // Where each pocket sits on its host travels with the host as a mark of three points (a corner and the two
  // directions of the pocket's own drawing), so it is turned, flipped and moved exactly as the host is.
  const patchMarks = (host) => g.pieces.filter((q) => isPatch(q) && q.on.p === host.id && q !== host).map((q) => { const b = bbox(outline(q)), O = { x: q.on.x - b.x, y: q.on.y - b.y }; return { type: 'patch', id: q.id, pts: [O, { x: O.x + 1, y: O.y }, { x: O.x, y: O.y + 1 }] }; });
  const src = g.pieces.filter((p) => { const k = keyOf(p), f = k && frameOf(type, k); return f && (!p.custom || f === ROLES[p.role][1]); });
  let pieces = src.map((p0) => {
    const key = keyOf(p0), f = frameOf(type, key), d = drafted(p0, patchMarks(p0));
    if (p0.custom) { if (f !== 'attach') upright(d, f); d.key = key; d.own = true; }
    return { key, id: p0.id, name: p0.name, frame: f, p: unfold(tidy(d, f, g.pieces)), cut: p0.cut || { n: 1 }, rev: !!p0.rev };
  });
  // Sewn-on pieces come along only if their seams lead, piece by piece, to one that has a place on the body.
  const sewsOf = (pc) => pc.p.segs.map((sg) => sg.sew).filter(Boolean), on = new Set(pieces.filter((pc) => pc.frame !== 'attach'));
  for (let grew = true; grew;) {
    grew = false;
    const ids = new Set([...on].flatMap(sewsOf));
    for (const pc of pieces) if (!on.has(pc) && sewsOf(pc).some((id) => ids.has(id))) { on.add(pc); grew = true; }
  }
  pieces = pieces.filter((pc) => on.has(pc));
  if (!pieces.length) return null;
  // Mesh density from the total fabric area.
  const areaOf = (p) => { let a = 0; const N = p.nodes; for (let i = 0; i < N.length; i++) { const q = N[i], r = N[(i + 1) % N.length]; a += q.x * r.y - r.x * q.y; } return Math.abs(a / 2); };
  const copies = (pc) => (pc.p.unfolded ? 1 : pc.frame === 'circle' ? pc.cut.n : pc.frame === 'tier' ? 2 : pc.cut.n >= 2 ? 2 : 1);
  const total = pieces.reduce((a, pc) => a + areaOf(pc.p) * copies(pc), 0) * 1.25; // curves add a little
  const h = clamp(Math.ceil(Math.sqrt(total / (0.866 * maxPoints)) * 20) / 20, hMin, 3.2); // in steps of half a millimetre, so a small edit keeps the spacing
  for (const pc of pieces) { pc.mesh = meshOf(pc.p, h); pc.kx = pc.p.shirred ? 1 / 1.8 : 1; } // shirring elastic pulls the back in

  // Instances: unfolded pieces once, mirrored pairs as left (+x) and right copies, circle panels n times.
  const inst = [];
  for (const pc of pieces) {
    const n = copies(pc);
    for (let k = 0; k < n; k++) inst.push({ pc, key: pc.key, frame: pc.frame, mirror: !pc.p.unfolded && pc.frame !== 'circle' && pc.frame !== 'tier' && k === 1, k, n, face: pc.frame === 'tier' ? (k ? -1 : 1) : faceOf(pc.key.replace(/^skirt/, '')) });
  }

  // Girth tables: total cloth width at each pattern row for the pieces that wrap together.
  const rowsOf = (I) => { const { pts, runs } = I.pc.mesh, nb = runs.reduce((a, r) => Math.max(a, ...r.idx.map((v) => v + 1)), 0); return pts.slice(0, nb); };
  const widthAt = (poly, y) => { const xs = []; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > y) !== (b.y > y)) xs.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)); } xs.sort((a, b) => a - b); let w = 0, lo = Infinity, hi = -Infinity; for (let i = 0; i + 1 < xs.length; i += 2) { w += xs[i + 1] - xs[i]; lo = Math.min(lo, xs[i]); hi = Math.max(hi, xs[i + 1]); } return { w, lo, hi }; };
  const tierH = (I) => { const ys = rowsOf(I).map((q) => q.y); return Math.max(...ys) - Math.min(...ys); };
  const rowOf = (I, q) => {
    if (I.frame === 'circle') return Math.hypot(q.x, q.y) - I.pc.r0;
    if (I.frame === 'tier') return q.y - I.pc.y0 + (+I.key.slice(-1)) * I.pc.th;
    return q.y;
  };
  for (const pc of pieces) {
    const poly = rowsOf({ pc });
    pc.y0 = Math.min(...poly.map((q) => q.y));
    if (pc.frame === 'circle') pc.r0 = Math.min(...poly.map((q) => Math.hypot(q.x, q.y)));
    if (pc.frame === 'tier') { pc.th = tierH({ pc }); const xs = poly.map((q) => q.x); pc.xc = (Math.min(...xs) + Math.max(...xs)) / 2; }
  }
  const group = (I) => (I.frame === 'tier' ? I.key : I.frame === 'sleeve' || I.frame === 'torso' || I.frame === 'legs' ? I.frame : 'skirt'); // each tier is its own girth
  const G = {};
  for (const I of inst) {
    if (I.frame === 'attach') continue; // sewn-on pieces don't wrap the body
    const gk = group(I), T = (G[gk] ||= { rows: new Map(), xcen: { 1: new Map(), '-1': new Map() } });
    const poly = rowsOf(I), ys = poly.map((q) => q.y);
    if (I.frame === 'circle') {
      const R = Math.max(...poly.map((q) => Math.hypot(q.x, q.y)));
      for (let r = 0; r <= Math.ceil(R - I.pc.r0); r++) T.rows.set(r, (T.rows.get(r) || 0) + Math.PI / 2 * (I.pc.r0 + r));
      continue;
    }
    if (gk === 'sleeve' && I.mirror) continue; // one sleeve's width is the tube's girth
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const W = widthAt(poly, y + 0.01), r = Math.round(rowOf(I, { x: 0, y: y + 0.01 }));
      if (W.w > 0) T.rows.set(r, (T.rows.get(r) || 0) + W.w * I.pc.kx);
      if (gk === 'legs' && W.w > 0) T.xcen[I.face].set(y, Math.max(T.xcen[I.face].get(y) ?? -Infinity, W.hi));
    }
  }
  for (const T of Object.values(G)) { const k = [...T.rows.keys()]; T.lo = Math.min(...k); T.hi = Math.max(...k); }
  const girth = (gk, row) => { // interpolated, and clamped to the rows the pieces cover
    const T = G[gk], r = clamp(row, T.lo, T.hi), a = Math.floor(r), at = (k) => { for (let d = 0; d < 40; d++) { const v = T.rows.get(k + d) ?? T.rows.get(k - d); if (v !== undefined) return v; } return 0; };
    return mix(at(a), at(Math.min(a + 1, T.hi)), r - a);
  };
  // Your own pieces drawn too small to go round the body: the cloth's girth vs her measurement at the
  // bust, waist and hip, wherever the pieces reach that far. Drafted patterns are left alone (stretch ease).
  const short = [];
  if (src.some((p) => p.custom)) {
    const chk = (gk, row, where, body) => { const T = G[gk]; if (T && body > 0 && row >= T.lo && row <= T.hi && girth(gk, row) < body) short.push({ where, cloth: girth(gk, row), body }); };
    chk('torso', (m.armholeDepth || 18) + 3, 'bust', m.bust); chk('torso', m.backLength - 2, 'waist', m.waist);
    chk('skirt', 1, 'waist', m.waist); chk('skirt', m.waistToHip, 'hip', m.hip); chk('legs', m.waistToHip, 'hip', m.hip);
  }
  const xcen = (face, y) => { const T = G.legs.xcen[face], a = Math.floor(y); return T.get(a) ?? T.get(a + 1) ?? T.get(a - 1) ?? 0; };

  // ---------- initial placement ----------
  const Yn = M.nape, Yw = M.waist, Yh = M.hip, kb = (Yn - Yw) / (m.backLength || Yn - Yw);
  const yArm = (m.armholeDepth || 18) + 3, yc = (m.crotchDepth || 27) + 1.5, folds = (gk) => (g.options.style === 'gathered' || g.options.skirtStyle === 'gathered' || g.options.waist === 'elastic' ? 28 : 12);
  const onTorso = (hgt, G0, s, face, cmin, cmax, nf = 12) => {
    const E = B.torso(hgt), T = loopTable(E.a, E.b, G0, cmin, cmax, nf), H = halfLoop(T);
    const [x, z] = loopAt(T, face > 0 ? s : Math.sign(s || 1) * (H - Math.abs(s)));
    return [x, hgt, E.cz + (face > 0 ? z : z)];
  };
  const place = (I, q) => {
    const x = q.x * I.pc.kx, y = q.y;
    if (I.frame === 'torso') {
      const hgt = Yn - y * kb, w = smooth(4, yArm, y), lift = 4 * (1 - w), E = B.torso(hgt);
      const Pw = onTorso(hgt, girth('torso', y), x, I.face, 1.2, 4);
      const Pp = [x, hgt, E.cz + I.face * (E.b + (I.face > 0 ? 2.5 : 3.5))];
      return [mix(Pp[0], Pw[0], w), hgt + lift, mix(Pp[2], Pw[2], w)];
    }
    if (I.frame === 'skirt' || I.frame === 'tier' || I.frame === 'circle') {
      const row = rowOf(I, q), hgt = Yw - row, cmax = hgt > Yh ? 2.5 : 2.5 + 0.45 * (Yh - hgt), G0 = girth(group(I), row);
      if (I.frame === 'circle') {
        const u = (I.k + clamp(Math.atan2(y, x), 0, Math.PI / 2) / (Math.PI / 2)) / I.n;
        let s = u * G0; if (s > G0 / 2) s -= G0;
        return onTorso(hgt, G0, s, -1, 1, cmax, folds());
      }
      return onTorso(hgt, G0, I.frame === 'tier' ? x - I.pc.xc : x, I.face, 1, cmax, folds());
    }
    if (I.frame === 'legs') {
      const hgt = Yw - y, sTorso = xcen(I.face, y) - x, Gt = girth('legs', y);
      const Pt = onTorso(hgt, Gt, sTorso, I.face, 1, 4);
      const L = B.leg(hgt), cap = Math.max(L.r + 0.8, Math.min(L.r + 6, L.x - 1.5)), T = loopTable(L.r, L.r, Gt / 2, 0.8, cap - L.r, 12);
      const [lx, lz] = loopAt(T, I.face > 0 ? x - I.pc.p.grain.a.x : Math.sign(x - I.pc.p.grain.a.x || 1) * (halfLoop(T) - Math.abs(x - I.pc.p.grain.a.x)));
      const Pl = [L.x - lx, hgt, L.z + lz], w = smooth(yc - 5, yc + 3, y);
      return [mix(Pt[0], Pl[0], w), hgt, mix(Pt[2], Pl[2], w)];
    }
    if (I.frame === 'sleeve') {
      const A = armAt(B, y), T = loopTable(A.r, A.r, girth('sleeve', y), 0.8, 4, 12), [sx, sz] = loopAt(T, x);
      return add(A.p, add(scl(A.top, sz), scl(A.front, -sx)));
    }
  };

  // ---------- shoulder straps: a strip from the front's top edge, over the shoulder, to the back ----------
  const frontI = inst.find((I) => I.key === 'front' && I.frame === 'torso'), backI = inst.find((I) => I.key === 'back' && I.frame === 'torso' && !I.mirror);
  let strap = null;
  if (g.options.neckline === 'strappy' && frontI && backI) {
    const sw = g.options.strapWidth || 2.5, fp = frontI.pc.p, i0 = fp.segs.findIndex((sg) => sg.name === 'top' && !sg.c1 && sg.side === 1);
    const fa = i0 >= 0 ? { x: (fp.nodes[i0].x + fp.nodes[(i0 + 1) % fp.nodes.length].x) / 2, y: (fp.nodes[i0].y + fp.nodes[(i0 + 1) % fp.nodes.length].y) / 2 } : { x: 9, y: Math.min(...fp.nodes.map((q) => q.y)) };
    const bp = backI.pc.p, mk = bp.marks.find((k) => k.type === 'line'), topY = Math.min(...bp.nodes.map((q) => q.y));
    const ba = mk ? { x: (mk.pts[0].x + mk.pts[1].x) / 2, y: topY } : { x: fa.x * 1.1 / backI.pc.kx, y: topY };
    const P0 = place(frontI, fa), P2 = place(backI, ba), X = (P0[0] + P2[0]) / 2;
    const zS = (body.pos[M.shoulderL * 3 + 2] + body.pos[M.neckSide * 3 + 2]) / 2, probe = [0, 0, 0, 0];
    let yTop = 170; while (yTop > 100 && (sample(F, X, yTop, zS, probe), probe[0]) > 0.8) yTop -= 0.5;
    const P1 = [X, 2 * (yTop + 1.2) - (P0[1] + P2[1]) / 2, 2 * zS - (P0[2] + P2[2]) / 2];
    const bez = (t) => [0, 1, 2].map((k) => (1 - t) ** 2 * P0[k] + 2 * t * (1 - t) * P1[k] + t * t * P2[k]);
    let Lb = 0; for (let k = 1; k <= 20; k++) Lb += len(sub(bez(k / 20), bez((k - 1) / 20)));
    const sp = g.pieces.find((q) => q.key === 'strap'), L = sp ? Math.max(...sp.nodes.map((q) => q.y)) - Math.min(...sp.nodes.map((q) => q.y)) : Lb;
    const p = { key: 'strapsim', nodes: [{ x: 0, y: 0 }, { x: sw, y: 0 }, { x: sw, y: L }, { x: 0, y: L }], segs: ['end1', 'side', 'end2', 'side'].map((name) => ({ name, side: 1 })), marks: [], grain: { a: { x: sw / 2, y: 0 }, b: { x: sw / 2, y: L } } };
    const pc = { key: 'strapsim', name: 'Straps', frame: 'strap', p, mesh: inward(meshPiece(p, Math.min(h, sw / 2))), kx: 1, bez, L, sw };
    for (let k = 0; k < 2; k++) inst.push({ pc, key: 'strapsim', frame: 'strap', mirror: k === 1, k, n: 2, face: 1 });
    strap = { fa, ba, sw };
  }
  const placeAny = (I, q) => (I.frame === 'strap' ? (([px, py, pz]) => [px + q.x - I.pc.sw / 2, py, pz])(I.pc.bez(clamp(q.y / I.pc.L, 0, 1))) : place(I, q));

  // ---------- particles ----------
  let N = 0;
  for (const I of inst) { I.base = N; N += I.pc.mesh.pts.length; }
  const x = new Float32Array(N * 3), uv = new Float32Array(N * 2), mass = new Float32Array(N), pts2 = new Float32Array(N * 2);
  for (const I of inst) {
    const { pts, tris } = I.pc.mesh, gr = I.pc.p.grain, gu = gr ? [gr.b.x - gr.a.x, gr.b.y - gr.a.y] : [0, 1], gl = Math.hypot(...gu) || 1, gv = [gu[0] / gl, gu[1] / gl];
    pts.forEach((q, i) => {
      const P = I.frame === 'attach' ? [0, 0, 0] : placeAny(I, q), j = I.base + i; // sewn-on pieces are placed once what they're sewn to is
      x[j * 3] = I.mirror ? -P[0] : P[0]; x[j * 3 + 1] = P[1]; x[j * 3 + 2] = P[2];
      pts2[j * 2] = q.x; pts2[j * 2 + 1] = q.y;
      uv[j * 2] = q.x * gv[1] - q.y * gv[0]; uv[j * 2 + 1] = q.x * gv[0] + q.y * gv[1]; // fabric runs along the grainline
    });
    for (const t of tris) { const [a, b, c] = t.map((v) => pts[v]), ar = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 6; for (const v of t) mass[I.base + v] += ar; }
  }

  // ---------- stretch + bend ----------
  const st = [], bd = [], strong = []; // strong: solved several times per step (straps carry the whole dress)
  for (const I of inst) {
    const { pts, tris } = I.pc.mesh, kx = I.pc.kx, edges = new Map();
    const rest = (a, b) => Math.hypot((pts[a].x - pts[b].x) * kx, pts[a].y - pts[b].y);
    for (const t of tris) for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3], c = t[(e + 2) % 3], k = a < b ? `${a},${b}` : `${b},${a}`;
      if (!edges.has(k)) { edges.set(k, c); st.push(I.base + a, I.base + b, rest(a, b)); if (I.frame === 'strap') strong.push(I.base + a, I.base + b, rest(a, b)); }
      else if (edges.get(k) >= 0) { const c0 = edges.get(k); bd.push(I.base + c0, I.base + c, rest(c0, c)); edges.set(k, -1); }
    }
  }

  // ---------- seams ----------
  const P3 = (i) => [x[i * 3], x[i * 3 + 1], x[i * 3 + 2]];
  const chainsOf = (spec, seam = false) => { // seam: for sewing by name, which leaves out edges sewn by hand
    const out = [];
    for (const I of inst) {
      if (!spec.keys.includes(I.key)) continue;
      const runs = I.pc.mesh.runs;
      // The sleeve cap is one edge on the pattern; it is sewn as a front half and a back half.
      if (spec.names.some((n) => n === 'capF' || n === 'capB')) {
        const cap = runs.filter((r) => r.name === 'cap').flatMap((r) => r.idx), pts = I.pc.mesh.pts;
        const uniq = cap.filter((v, i) => cap.indexOf(v) === i), top = uniq.reduce((a, v) => (pts[v].y < pts[a].y ? v : a), uniq[0]), ti = uniq.indexOf(top);
        const first = uniq.slice(0, ti + 1), second = uniq.slice(ti), frontFirst = pts[uniq[0]].x < 0;
        out.push(mkChain(I, spec.names.includes('capF') === frontFirst ? first : second));
        continue;
      }
      out.push(...chainsWhere(I, (r) => spec.names.includes(r.name) && !(seam && live.has(r.sew))));
    }
    return out;
  };
  // Chains of consecutive edges of one piece that pass the test, each with its piece (I) and half (side).
  function chainsWhere(I, test) {
    const runs = I.pc.mesh.runs, n = runs.length, ok = runs.map(test), out = [];
    if (!ok.some(Boolean)) return out;
    const start = ok.every(Boolean) ? 0 : ok.findIndex((v, i) => v && !ok[(i - 1 + n) % n]);
    for (let k = 0, cur = null, side = 1; k < n; k++) {
      const i = (start + k) % n;
      if (ok[i]) { if (!cur) { cur = []; side = runs[i].side; } for (const v of runs[i].idx) if (cur[cur.length - 1] !== v) cur.push(v); }
      if ((!ok[i] || k === n - 1) && cur) { if (cur.length > 1) out.push({ ...mkChain(I, cur), I, side }); cur = null; }
    }
    return out;
  }
  function mkChain(I, local) {
    const pts = I.pc.mesh.pts, de = I.pc.mesh.dartEnds, t = [0];
    for (let k = 1; k < local.length; k++) t.push(t[k - 1] + (de.has(`${local[k - 1]}|${local[k]}`) ? 0 : dist(pts[local[k - 1]], pts[local[k]])));
    return { v: local.map((v) => I.base + v), t };
  }
  const ends = (c) => [P3(c.v[0]), P3(c.v[c.v.length - 1])];
  const mid = (c) => P3(c.v[c.v.length >> 1]);
  const reverse = (c) => ({ v: [...c.v].reverse(), t: c.t.map((v) => c.t[c.t.length - 1] - v).reverse() });
  const join = (cs) => { // link chains whose ends meet into longer chains
    const left = [...cs], out = [];
    while (left.length) {
      let c = left.shift(), grew = true;
      while (grew) {
        grew = false;
        for (let i = 0; i < left.length; i++) {
          // Never join her left and right halves across the centre (a chain that already spans it is fine).
          const ma = mid(c)[0], mb = mid(left[i])[0];
          if (Math.abs(ma) > 2 && Math.abs(mb) > 2 && Math.sign(ma) !== Math.sign(mb)) continue;
          const [a0, a1] = ends(c), [b0, b1] = ends(left[i]);
          const cat = (A, Bc) => ({ v: [...A.v, ...Bc.v.slice(1)], t: [...A.t, ...Bc.t.slice(1).map((v) => v + A.t[A.t.length - 1])] });
          if (len(sub(a1, b0)) < 1.5) c = cat(c, left[i]); else if (len(sub(a1, b1)) < 1.5) c = cat(c, reverse(left[i]));
          else if (len(sub(a0, b1)) < 1.5) c = cat(left[i], c); else if (len(sub(a0, b0)) < 1.5) c = cat(reverse(left[i]), c); else continue;
          left.splice(i, 1); grew = true; break;
        }
      }
      out.push(c);
    }
    return out;
  };
  const pairUp = (A, Bs, self) => { // greedy nearest midpoints
    const cand = [];
    A.forEach((a, i) => (self ? A : Bs).forEach((b, j) => { if (!self || j > i) cand.push([len(sub(mid(a), mid(b))), i, j]); }));
    cand.sort((p, q) => p[0] - q[0]);
    const usedA = new Set(), usedB = new Set(), out = [];
    for (const [, i, j] of cand) {
      if (self ? usedA.has(i) || usedA.has(j) : usedA.has(i) || usedB.has(j)) continue;
      if (self) { usedA.add(i); usedA.add(j); } else { usedA.add(i); usedB.add(j); }
      out.push([A[i], (self ? A : Bs)[j]]);
    }
    return out;
  };
  // A seam constraint ties point i to a spot on the other edge: between points j0 and j1, fraction t.
  // Tying to a spot along the edge (not the nearest point) lets both edges lie exactly on each other,
  // even where they have different point spacing or one is eased or gathered onto the other.
  const seams = new Map(), lines = []; // lines: one side of each seam, as a chain of points, for drawing it
  const link = (i, j0, j1 = j0, t = 0) => {
    if (t < 0.03) j1 = j0; else if (t > 0.97) j0 = j1;
    if (j0 === j1) { if (i !== j0) seams.set(`p${Math.min(i, j0)},${Math.max(i, j0)}`, [i, j0, j0, 0]); return; }
    if (i !== j0 && i !== j1) seams.set(`e${i},${j0},${j1}`, [i, j0, j1, t]);
  };
  const bracket = (f, arr) => { let lo = 0, hi = arr.length - 1; while (hi - lo > 1) { const m2 = (lo + hi) >> 1; if (arr[m2] <= f) lo = m2; else hi = m2; } return [lo, hi, clamp((f - arr[lo]) / ((arr[hi] - arr[lo]) || 1), 0, 1)]; };
  const sew = (a, b, dart = false) => { // match points by their fraction along each edge
    const [a0, a1] = ends(a), [b0, b1] = ends(b);
    if (len(sub(a0, b1)) + len(sub(a1, b0)) < len(sub(a0, b0)) + len(sub(a1, b1))) b = reverse(b);
    lines.push({ v: a.v, dart });
    const fa = a.t.map((v) => v / (a.t[a.t.length - 1] || 1)), fb = b.t.map((v) => v / (b.t[b.t.length - 1] || 1));
    fa.forEach((f, i) => { const [lo, hi, t] = bracket(f, fb); link(a.v[i], b.v[lo], b.v[hi], t); });
    fb.forEach((f, j) => { const [lo, hi, t] = bracket(f, fa); link(b.v[j], a.v[lo], a.v[hi], t); });
  };
  const angleOf = (i) => { const p = P3(i), E = B.torso(p[1]); return Math.atan2(p[0], p[2] - E.cz); };
  // Dart corners on an edge are left to the dart seam (matching them by angle would hold the dart open).
  const dartCorner = new Set(inst.flatMap((I) => [...I.pc.mesh.dartEnds].map((k) => I.base + +k.split('|')[0])));
  const sewLoop = (A, Bs) => { // round seams (waists, tiers): match by angle around the body
    // Points already sewn to each other on the same ring (side-seam corners) share one angle,
    // otherwise the round seam would pull the side seam open where they meet.
    const adj = new Map(), add = (u, v) => { if (u !== v) (adj.get(u) || adj.set(u, []).get(u)).push(v); };
    for (const [i, j0, j1] of seams.values()) for (const j of new Set([j0, j1])) { add(i, j); add(j, i); }
    const ring = (cs) => {
      const vs = [...new Set(cs.flatMap((c) => c.v))].filter((v) => !dartCorner.has(v)), on = new Set(vs);
      const ang = (v) => { const grp = [v, ...(adj.get(v) || []).filter((u) => on.has(u))]; return Math.atan2(grp.reduce((a2, u) => a2 + Math.sin(angleOf(u)), 0), grp.reduce((a2, u) => a2 + Math.cos(angleOf(u)), 0)); };
      return vs.map((v) => [ang(v), v]).sort((p, q) => p[0] - q[0]);
    };
    const av = ring(A), bv = ring(Bs);
    if (av.length < 2 || bv.length < 2) return;
    lines.push({ v: av.map((e) => e[1]), closed: true });
    const onto = (ang, arr) => { // the two neighbours of ang on the ring, and how far between them it lies
      let k = arr.findIndex((e) => e[0] > ang); if (k < 0) k = 0;
      const p = arr[(k - 1 + arr.length) % arr.length], q = arr[k], span = ((q[0] - p[0]) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
      return [p[1], q[1], (((ang - p[0]) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)) / span];
    };
    for (const [ang, v] of av) link(v, ...onto(ang, bv));
    for (const [ang, v] of bv) link(v, ...onto(ang, av));
  };
  // Sewing marks that lead somewhere among the pieces in 3D: two or more edges, or one sewn to its mirror
  // image. A mark whose other edge is on a piece that isn't shown sews nothing, and the edge keeps its named seam.
  const marked = (id) => { const by = new Map(); let twin = false; for (const I of inst) { const cs = chainsWhere(I, (r) => r.sew === id); if (cs.length) { by.set(I.pc, [...(by.get(I.pc) || []), ...cs]); twin ||= I.pc.mesh.runs.some((r) => r.sew === id && r.twin); } } return { groups: [...by], twin }; };
  const live = new Set([...new Set(inst.flatMap((I) => I.pc.mesh.runs.map((r) => r.sew).filter(Boolean)))].filter((id) => {
    const { groups, twin } = marked(id);
    return groups.length > 1 || twin || groups[0][1].some((a) => groups[0][1].some((b) => a !== b && a.I === b.I && a.side === b.side));
  }));
  for (const [A, Bspec, kind] of rules) {
    let ca = chainsOf(A, true);
    if (A.join) ca = join(ca);
    if (Bspec === 'self') { for (const [a, b] of pairUp(ca, null, true)) sew(a, b); continue; }
    let cb = chainsOf(Bspec, true);
    if (Bspec.join) cb = join(cb);
    if (!ca.length || !cb.length) continue;
    if (kind === 'loop') sewLoop(ca, cb); else for (const [a, b] of pairUp(ca, cb)) sew(a, b);
  }
  // Straps: each end is sewn to its spot on the top edge.
  if (strap) {
    const near = (I, name, cx) => { const out = [], pts = I.pc.mesh.pts; for (const sx of [cx, -cx]) { const v = I.pc.mesh.runs.filter((r) => r.name === name).flatMap((r) => r.idx).filter((w, i, a) => a.indexOf(w) === i && Math.abs(pts[w].x - sx) <= (strap.sw / 2 + 0.3) / I.pc.kx); if (v.length > 1) out.push(mkChain(I, v.sort((a2, b2) => pts[a2].x - pts[b2].x))); } return out; };
    const fronts = inst.filter((I) => I.key === 'front').flatMap((I) => near(I, 'top', strap.fa.x));
    const backs = inst.filter((I) => I.key === 'back' && I.frame === 'torso').flatMap((I) => near(I, 'top', strap.ba.x));
    for (const [a, b] of pairUp(chainsOf(S_(['strapsim'], ['end1'])), fronts)) sew(a, b);
    for (const [a, b] of pairUp(chainsOf(S_(['strapsim'], ['end2'])), backs)) sew(a, b);
  }
  // ---------- seams of your own: edges that share a sewing mark are sewn to each other ----------
  // Pieces with a place on the body are already there. A sewn-on piece (collar, cuff, ruffle, waistband…)
  // starts lying along the edges it's sewn to, reaching away from them, and is then sewn on.
  const instOf = new Int32Array(N); inst.forEach((I, k) => instOf.fill(k, I.base, I.base + I.pc.mesh.pts.length));
  const there = new Set(inst.filter((I) => I.frame !== 'attach')), isThere = (pc) => inst.every((I) => I.pc !== pc || there.has(I)), freeV = new Set();
  const sewFree = (a, b) => { sew(a, b); for (const v of a.v) freeV.add(v); for (const v of b.v) freeV.add(v); };
  const endGap = (a, b) => { const [a0, a1] = ends(a), [b0, b1] = ends(b); return [[len(sub(a1, b0)), 0], [len(sub(a1, b1)), 1], [len(sub(a0, b1)), 2], [len(sub(a0, b0)), 3]].sort((p, q) => p[0] - q[0])[0]; };
  const glue = (a, b) => ({ v: [...a.v, ...b.v], t: [...a.t, ...b.t.map((v) => v + a.t[a.t.length - 1])] });
  const mergeTo = (cs, m) => { // join chains end to end, nearest ends first, until m are left
    cs = [...cs];
    while (cs.length > Math.max(1, m)) {
      let best = null;
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) { const [d, how] = endGap(cs[i], cs[j]); if (!best || d < best[0]) best = [d, how, i, j]; }
      const [, how, i, j] = best, a = cs[i], b = cs[j];
      cs.splice(j, 1); cs[i] = how === 0 ? glue(a, b) : how === 1 ? glue(a, reverse(b)) : how === 2 ? glue(b, a) : glue(reverse(b), a);
    }
    return cs;
  };
  const halves = (c) => { // from the middle out to each end (the two halves of a collar meet at the centre back)
    const T = c.t[c.t.length - 1], k = clamp(c.t.findIndex((v) => v >= T / 2), 1, c.v.length - 2);
    return [{ v: c.v.slice(k), t: c.t.slice(k).map((v) => v - c.t[k]) }, reverse({ v: c.v.slice(0, k + 1), t: c.t.slice(0, k + 1) })];
  };
  // Lay a sewn-on piece along a chain of edge points: each of its points keeps its distance along and
  // away from its own sewn edge, measured along the host edge and straight out from the host piece.
  function layOn(I, att, host) {
    // Along both edges the measure is pattern length (t), the one sewing matches them by: where the host
    // is several pieces' edges end to end, the gaps between them (seams still open) count for nothing.
    const pts = I.pc.mesh.pts, E = att.v.map((v) => pts[v - I.base]), S2 = att.t, H = host.v.map(P3), S3 = host.t;
    const L2 = S2[S2.length - 1] || 1, L3 = S3[S3.length - 1] || 1;
    let last = [0, -1, 0];
    // Straight out from the host at each point: away from the neighbour that lies most squarely in from
    // this edge (measured against the edge itself, so a hem's corner doesn't lean along the side seam).
    const raw = host.v.map((v, i) => {
      const J = inst[instOf[v]], Mh = J.pc.mesh, lv = v - J.base, q = Mh.pts[lv], same = (w) => w !== undefined && instOf[w] === instOf[v];
      const a = same(host.v[i - 1]) ? Mh.pts[host.v[i - 1] - J.base] : q, b = same(host.v[i + 1]) ? Mh.pts[host.v[i + 1] - J.base] : q, tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty);
      let best = 0, u = -1;
      if (tl > 1e-6) for (const w of Mh.nbr.get(lv) || []) { const r = Mh.pts[w], perp = Math.abs((r.x - q.x) * ty - (r.y - q.y) * tx) / tl, score = perp / (dist(q, r) || 1); if (perp > 0.2 && score > best) { best = score; u = w; } }
      if (u >= 0) last = nrm(sub(P3(v), P3(J.base + u)));
      return last;
    });
    // "Straight out" is evened over a hand's width of the edge: flared cloth starts out in waves, and
    // point by point its edge faces in and out with them.
    // It also leans three parts in four towards the whole edge's average (down from a hem, up from a waist,
    // along the arm from a sleeve end), so the piece starts as one smooth band with no rows crossing.
    const all = nrm(raw.reduce(add, [0, 0, 0]));
    const outs = raw.map((_, i) => { let o = [0, 0, 0]; for (let k = Math.max(0, i - 4); k <= Math.min(raw.length - 1, i + 4); k++) o = add(o, raw[k]); return nrm(add(scl(nrm(o), 0.25), scl(all, 0.75))); });
    // Each point's place relative to the sewn edge: how far along (s), past its ends (a), and away from it (d).
    const rel = pts.map((q) => {
      let best = null;
      for (let j = 1; j < E.length; j++) {
        const a = E[j - 1], b = E[j], L = dist(a, b) || 1e-9, tx = (b.x - a.x) / L, ty = (b.y - a.y) / L, raw = (q.x - a.x) * tx + (q.y - a.y) * ty, u = clamp(raw, 0, L);
        const rx = q.x - a.x - tx * u, ry = q.y - a.y - ty * u, d2 = rx * rx + ry * ry;
        if (!best || d2 < best.d2) best = { d2, s: S2[j - 1] + (S2[j] - S2[j - 1]) * u / L, a: rx * tx + ry * ty, d: ry * tx - rx * ty };
      }
      return best;
    });
    const sg = rel.reduce((t, r) => t + r.d, 0) < 0 ? -1 : 1, dir = I.pc.rev ? -1 : 1; // the piece lies to one side of its sewn edge
    // An edge longer than what it's sewn to gathers. Squashed flat along the shorter edge it would spring
    // apart and tangle, so it starts in waves (10 cm of cloth to each) just deep enough to take up its length.
    const squash = L3 / L2, LAM = 10, amp = squash < 0.95 ? Math.min(4, Math.sqrt(2 * (1 / (squash * squash) - 1)) * LAM * squash / (2 * Math.PI)) : 0;
    rel.forEach((r, i) => {
      const f = I.pc.rev ? 1 - r.s / L2 : r.s / L2, u3 = f * L3;
      let h = 1; while (h < H.length - 1 && (S3[h] < u3 || S3[h] === S3[h - 1])) h++; // never in a gap between two pieces
      const k = clamp((u3 - S3[h - 1]) / ((S3[h] - S3[h - 1]) || 1), 0, 1), T = nrm(sub(H[h], H[h - 1])), O0 = add(scl(outs[h - 1], 1 - k), scl(outs[h], k)), O = nrm(sub(O0, scl(T, dot(O0, T))));
      let P = add(add(add(H[h - 1], scl(sub(H[h], H[h - 1]), k)), scl(T, r.a * dir)), scl(O, r.d * sg));
      if (amp) P = add(P, scl(cross(T, O), amp * Math.sin(2 * Math.PI * r.s / LAM) * Math.min(1, Math.abs(r.d) / 4))); // flat where it's sewn on
      x.set(P, (I.base + i) * 3);
    });
    // Whatever landed inside the body (a collar reaching into the neck) is moved out to just above the skin.
    const probe = [0, 0, 0, 0];
    for (let i = I.base; i < I.base + pts.length; i++) {
      let q = P3(i);
      for (let it = 0; it < 40; it++) {
        const inGrid = sample(F, q[0], q[1], q[2], probe), d = probe[0], gl = Math.hypot(probe[1], probe[2], probe[3]);
        if (!inGrid || d >= 0.8) break;
        if (gl > 0.3) q = add(q, scl([probe[1], probe[2], probe[3]], (0.85 - d) / gl));
        else { const El = B.torso(q[1]), r = [q[0], 0, q[2] - El.cz], rl = len(r) || 1; q = add(q, scl(r, 1.5 / rl)); }
      }
      x.set(q, i * 3);
    }
  }
  let todo = [...live];
  for (let moved = true; moved && todo.length;) {
    moved = false;
    for (const id of todo) {
      const { groups, twin } = marked(id), waiting = groups.filter(([pc]) => !isThere(pc));
      if (waiting.length > 1 || (waiting.length && groups.length === 1)) continue; // another seam has to place these first
      todo = todo.filter((k) => k !== id); moved = true;
      if (waiting.length) { // a sewn-on piece: lay each copy along its share of the edges, then sew it on
        const [pc, att] = waiting[0], Is = inst.filter((I) => I.pc === pc), mine = Is.map((I) => att.find((c) => c.I === I)).filter(Boolean);
        let hosts = mergeTo(join(groups.filter((gr) => gr[0] !== pc).flatMap((gr) => gr[1])), mine.length);
        if (hosts.length === 1 && mine.length === 2) hosts = halves(hosts[0]);
        hosts.sort((a, b) => mid(b)[0] - mid(a)[0]); // her left (+x) first, like the copies
        mine.forEach((c, k) => { const host = hosts[k % hosts.length]; layOn(c.I, c, host); sewFree(host, c); });
        for (const I of Is) there.add(I);
      } else if (groups.length === 1) {
        const cs = groups[0][1];
        if (twin) { for (const [a, b] of pairUp(cs, null, true)) sewFree(a, b); continue; } // to its mirror image: a centre seam
        const sets = new Map(); // two edges of one piece: each copy (and each half of a piece cut on the fold) is sewn to itself
        for (const c of cs) { const k = `${instOf[c.v[0]]}|${c.side}`; sets.set(k, [...(sets.get(k) || []), c]); }
        for (const set of sets.values()) if (set.length > 1) for (const [a, b] of pairUp(set, null, true)) sewFree(a, b);
      } else if (groups.length === 2) { for (const [a, b] of pairUp(groups[0][1], groups[1][1])) sewFree(a, b); }
      else { // one piece's edge sewn to the edges of several others: those join up end to end first
        const lone = groups.find(([pc]) => pc.frame === 'attach') || groups[0], rest = mergeTo(join(groups.filter((gr) => gr !== lone).flatMap((gr) => gr[1])), lone[1].length);
        for (const [a, b] of pairUp(lone[1], rest)) sewFree(a, b);
      }
    }
  }
  // Darts: the two legs are sewn together.
  for (const I of inst) for (const [L1, L2] of I.pc.mesh.darts) if (L1.length > 1 && L2.length > 1) sew(mkChain(I, L1), mkChain(I, L2), true);
  // Pleats: the two ends are stitched together, and the fold between them is stitched flat against the edge.
  for (const I of inst) for (const T of I.pc.mesh.tucks) { link(I.base + T.a, I.base + T.b); for (const [i, j0, j1, t] of T.ties) link(I.base + i, I.base + j0, I.base + j1, t); }

  // ---------- waist pins: the top edge of skirts and trousers sits on the body's waist ----------
  const pins = [];
  if (pinRule) {
    const probe = [0, 0, 0, 0];
    for (const c of chainsOf(S_(pinRule[0], pinRule[1]))) for (const v of c.v) {
      let q = P3(v);
      for (let it = 0; it < 12; it++) {
        const inside = sample(F, q[0], q[1], q[2], probe), d = probe[0], gl = Math.hypot(probe[1], probe[2], probe[3]);
        if (inside && d < F.band - 0.05 && gl > 0.3) { q = sub(q, scl([probe[1] / gl, 0, probe[3] / gl], d - 0.6)); if (Math.abs(d - 0.6) < 0.05) break; }
        else { const E = B.torso(q[1]), r = [q[0], 0, q[2] - E.cz], rl = len(r) || 1; q = sub(q, scl(r, 1.5 / rl)); }
      }
      pins.push([v, ...q]);
    }
    // Dart corners are left free so the dart can close, and points sewn to each other share one pin.
    for (let k = pins.length - 1; k >= 0; k--) if (dartCorner.has(pins[k][0])) pins.splice(k, 1);
    const at = new Map(pins.map((p) => [p[0], p]));
    for (const [i, j0, j1] of seams.values()) if (j0 === j1 && at.has(i) && at.has(j0)) { const A = at.get(i), Bp = at.get(j0); for (let k = 1; k < 4; k++) A[k] = Bp[k] = (A[k] + Bp[k]) / 2; }
  }
  // ---------- bands drawn along an edge of the draped cloth: waistbands, jacket hem band, collar, cuffs ----------
  const bands = [], o = g.options;
  const torsoBand = (verts, height, kind) => {
    const vs = [...new Set(verts)].sort((a2, b2) => angleOf(a2) - angleOf(b2));
    if (vs.length < 3) return;
    const out = vs.flatMap((v) => { const p = P3(v), E = B.torso(p[1]); return nrm([p[0], 0, p[2] - E.cz]); });
    bands.push({ verts: vs, out, dir: vs.flatMap(() => [0, kind === 'down' ? -1 : 1, 0]), height, kind, closed: true });
  };
  const edge = (keys, names) => chainsOf(S_(keys, names)).flatMap((c) => c.v);
  if (pins.length && o.waist !== 'facing' && !pins.some((p) => freeV.has(p[0]))) torsoBand(pins.map((p) => p[0]), type === 'skirt' ? (o.waist === 'band' ? o.bandWidth || 4 : 3) : 4, 'up');
  if (type === 'jacket') {
    torsoBand(edge(['front', 'sidefront', 'back', 'sideback'], ['hem']), 5, 'down');
    torsoBand(edge(['frontyoke', 'backyoke'], ['neck']), 3.5, 'collar');
    for (const I of inst.filter((J) => J.key === 'sleeve')) {
      const c = chainsOf(S_(['sleeve'], ['hem'])).find((ch) => ch.v[0] >= I.base && ch.v[0] < I.base + I.pc.mesh.pts.length);
      if (!c) continue;
      const L = Math.max(...I.pc.mesh.pts.map((q) => q.y)), A = armAt(B, L), sg = I.mirror ? -1 : 1, axis = [A.p[0] * sg, A.p[1], A.p[2]], u = [A.u[0] * sg, A.u[1], A.u[2]];
      const out = c.v.flatMap((v) => { const r = sub(P3(v), axis); return nrm(sub(r, scl(u, dot(r, u)))); });
      bands.push({ verts: c.v, out, dir: c.v.flatMap(() => u), height: 6, kind: 'cuff', closed: true });
    }
  }
  const seamArr = [...seams.values()];
  // ---------- pockets and patches: each point is tied to a spot on the host's cloth (a triangle and three weights) ----------
  const patches = [];
  for (const q of g.pieces) {
    const pc = isPatch(q) && pieces.find((c) => c.id === q.on.p), mk = pc && pc.p.marks.find((k) => k.type === 'patch' && k.id === q.id);
    if (!mk) continue;
    const Mq = inward(meshPiece({ nodes: q.nodes, segs: q.segs, marks: [] }, Math.min(h, 2))), n = Mq.pts.length, two = (q.cut?.n || 1) >= 2;
    const gr = q.grain, gu = gr ? [gr.b.x - gr.a.x, gr.b.y - gr.a.y] : [0, 1], gl = Math.hypot(...gu) || 1, gv = [gu[0] / gl, gu[1] / gl];
    const uvq = Float32Array.from(Mq.pts.flatMap((p2) => [p2.x * gv[1] - p2.y * gv[0], p2.x * gv[0] + p2.y * gv[1]]));
    // Cut 2 puts one on each side: on each copy of a host cut as a pair, or mirrored across the fold of a host cut on the fold.
    const hosts = inst.filter((I) => I.pc === pc), spots = pc.p.unfolded ? [mk.pts, ...(two ? [mk.pts.map(pc.p.flip)] : [])].map((fr) => [hosts[0], fr]) : hosts.slice(0, two ? 2 : 1).map((I) => [I, mk.pts]);
    for (const [I, [O, X, Y]] of spots) {
      const T = I.pc.mesh.tris, Ph = I.pc.mesh.pts, bind = new Int32Array(n * 3), w = new Float32Array(n * 3);
      Mq.pts.forEach((p2, i) => {
        const hx = O.x + (X.x - O.x) * p2.x + (Y.x - O.x) * p2.y, hy = O.y + (X.y - O.y) * p2.x + (Y.y - O.y) * p2.y;
        let best = null; // the triangle it lies in, or (hanging over the host's edge) the one it's least outside
        for (const t of T) {
          const a = Ph[t[0]], b = Ph[t[1]], c = Ph[t[2]], den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y) || 1e-9;
          const u = ((b.y - c.y) * (hx - c.x) + (c.x - b.x) * (hy - c.y)) / den, v = ((c.y - a.y) * (hx - c.x) + (a.x - c.x) * (hy - c.y)) / den, out = Math.max(0, -u, -v, u + v - 1);
          if (!best || out < best.out) best = { out, t, u, v };
          if (!out) break;
        }
        bind.set(best.t.map((k) => I.base + k), i * 3); w.set([best.u, best.v, 1 - best.u - best.v], i * 3);
      });
      patches.push({ key: `patch:${q.id}`, name: q.name, inst: inst.indexOf(I), pts: Mq.pts, tris: Mq.tris, runs: Mq.runs, inU: Mq.inU, inPerp: Mq.inPerp, uv: uvq, bind, w });
    }
  }
  // Open edges: what isn't sewn to anything, held at the waist or finished with a band is hemmed
  // (or faced or bound), which shows as a line of stitching a little way in from the edge.
  const closedV = new Set(seamArr.flatMap(([i, j0, j1]) => [i, j0, j1])), hems = [];
  for (const p of pins) closedV.add(p[0]);
  for (const b of bands) for (const v of b.verts) closedV.add(v);
  for (const I of inst) for (const r of I.pc.mesh.runs) {
    const v = r.idx.map((k) => I.base + k);
    if (v.length > 2 && v.filter((k) => closedV.has(k)).length < v.length * 0.3) hems.push({ v, off: r.name === 'hem' || r.name === 'bottom' ? 2 : 0.6 });
  }
  const inU = new Int32Array(N).fill(-1), inPerp = new Float32Array(N);
  for (const I of inst) { const M = I.pc.mesh; for (let k = 0; k < M.pts.length; k++) if (M.inU[k] >= 0) { inU[I.base + k] = I.base + M.inU[k]; inPerp[I.base + k] = M.inPerp[k]; } }
  const grip = new Uint8Array(N); // straps grip the shoulder like fabric on skin
  for (const I of inst) if (I.frame === 'strap') grip.fill(1, I.base, I.base + I.pc.mesh.pts.length);
  return { inst, N, x, uv, pts2, mass, stretch: st, bend: bd, strong, seams: seamArr, pins, grip, bands, h, short, lines, hems, inU, inPerp, patches };
}

// Ribbon mesh for a band: rows of points stepped out from the cloth edge.
// Collars stand up, then fold over and fall outward onto the shoulders.
export function bandMesh(b) {
  const n = b.verts.length, rows = b.kind === 'collar' ? 5 : 2, index = [], uv = new Float32Array(n * rows * 2);
  for (let i = 0; i < n - (b.closed ? 0 : 1); i++) for (let r = 0; r < rows - 1; r++) { const a = i * rows + r, c = ((i + 1) % n) * rows + r; index.push(a, c, a + 1, a + 1, c, c + 1); }
  return {
    index, uv, rows,
    update(x, pos) {
      let s = 0;
      for (let i = 0; i < n; i++) {
        const v = b.verts[i] * 3, p = [x[v], x[v + 1], x[v + 2]], o = b.out.slice(i * 3, i * 3 + 3), d = b.dir.slice(i * 3, i * 3 + 3), H = b.height;
        if (i) { const w = b.verts[i - 1] * 3; s += Math.hypot(x[v] - x[w], x[v + 1] - x[w + 1], x[v + 2] - x[w + 2]); }
        const at = (up, outk) => [p[0] + d[0] * up + o[0] * outk, p[1] + d[1] * up + o[1] * outk, p[2] + d[2] * up + o[2] * outk];
        const R = b.kind === 'collar' ? [at(0, 0.2), at(H, 0.3), at(H + 0.4, 1.1), at(H - 2.5, 3.6), at(H - 7, 6.2)] : [at(0, 0.3), at(H, 0.35)];
        R.forEach((q, r) => { pos.set(q, (i * rows + r) * 3); uv[(i * rows + r) * 2] = s; uv[(i * rows + r) * 2 + 1] = r * H; });
      }
    },
  };
}
