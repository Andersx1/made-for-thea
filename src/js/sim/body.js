// Realistic body from the MakeHuman base mesh (CC0), shaped to a measurement profile by solving
// the weights of MakeHuman's own measurement targets so the body's circumferences and lengths
// match. Units: cm, y up, front = +z, feet on y = 0.
import { BODY } from '../../assets/body-data.js';

const dec = (s, T) => { const b = typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64') : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); const u = new Uint8Array(b); return new T(u.buffer, u.byteOffset, u.byteLength / T.BYTES_PER_ELEMENT); };
let RAW = null;
function raw() {
  if (RAW) return RAW;
  const targets = {};
  for (const [k, t] of Object.entries(BODY.targets)) targets[k] = { idx: dec(t.idx, Uint16Array), d: dec(t.d, Float32Array) };
  RAW = { base: dec(BODY.verts, Float32Array), tris: dec(BODY.tris, Uint16Array), loops: BODY.loops, targets, n: BODY.count };
  // Nipple tips: the vertex MakeHuman's nipple-point target moves most, on each side [left (+x), right].
  const np = targets['nipple-point-incr'];
  RAW.nipples = [1, -1].map((sg) => { let best = -1, bm = 0; for (let k = 0; k < np.idx.length; k++) { const i = np.idx[k], mm = Math.hypot(np.d[k * 3], np.d[k * 3 + 1], np.d[k * 3 + 2]); if (Math.sign(RAW.base[i * 3]) === sg && mm > bm) { bm = mm; best = i; } } return best; });
  // Breast area: each vertex's share of MakeHuman's cup shape, 0 at the edge of the breast … 1 where it is fullest.
  const cupT = targets['female-young-averagemuscle-averageweight-maxcup-averagefirmness'], mags = Array.from(cupT.idx, (_, k) => Math.hypot(cupT.d[k * 3], cupT.d[k * 3 + 1], cupT.d[k * 3 + 2])), mx = Math.max(...mags);
  RAW.breast = { idx: cupT.idx, w: Float32Array.from(mags, (v) => Math.min(1, v / (0.7 * mx))) };
  return RAW;
}

function addTarget(pos, t, w) { if (!w) return; const { idx, d } = t; for (let k = 0; k < idx.length; k++) { const i = idx[k] * 3; pos[i] += d[k * 3] * w; pos[i + 1] += d[k * 3 + 1] * w; pos[i + 2] += d[k * 3 + 2] * w; } }
export function loopLen(pos, loop) { let L = 0; for (let k = 1; k < loop.length; k++) { const a = loop[k - 1] * 3, b = loop[k] * 3; L += Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]); } return L; }
const heightOf = (pos) => { let lo = Infinity, hi = -Infinity; for (let i = 1; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); } return hi - lo; };

// Which body measurement drives which MakeHuman target (and how the measurement is read).
const MAP = [
  ['neck', 'neck-circ'], ['bust', 'bust-circ'], ['underbust', 'underbust-circ'], ['waist', 'waist-circ'], ['hip', 'hips-circ'],
  ['bicep', 'upperarm-circ'], ['wrist', 'wrist-circ'], ['thigh', 'thigh-circ'], ['knee', 'knee-circ'], ['calf', 'calf-circ'], ['ankle', 'ankle-circ'],
  ['backLength', 'napetowaist-dist'], ['waistToHip', 'waisttohip-dist'], ['shoulderLength', 'shoulder-dist'],
  ['armLength', ['upperarm-length', 'lowerarm-length']], // both arm segments together, scaled alike
];
// MakeHuman's rulers measure circumferences around both sides of a limb loop; lengths are straight lines.
// Body lengths are measured over the curve of the body, so straight lines are compared with a small factor.
// Bust point to bust point is a straight line; shoulder to bust point runs over the chest, so it's a little longer.
const FACTOR = { backLength: 0.97, waistToHip: 0.92, shoulderLength: 0.95, armLength: 0.92, bustSpan: 1, shoulderToBust: 0.98 };

// ---------- the bust ----------
// Options for the bust on the 3D model: [key, label, [[value, label, ...settings]], default, shown only in this mode].
// Calibrated against real proportions (nipple-to-nipple distance, droop measured at the fold under the breast,
// how far the breasts point outward), and kept moderate so even the extremes together look like a real body.
const CUPS = [['AA', 11], ['A', 13], ['B', 15], ['C', 17], ['D', 19], ['E', 21], ['F', 23], ['G', 25], ['H', 27]]; // bust − underbust, cm
const nearestCup = (m) => CUPS.reduce((a, c) => (Math.abs(c[1] - (m.bust - m.underbust)) < Math.abs(a[1] - (m.bust - m.underbust)) ? c : a))[0];
export const BUST = [
  ['mode', 'Shape it from', [['measure', 'My measurements'], ['simple', 'Simple choices']], 'measure'],
  ['cup', 'Cup size', CUPS.map(([c, d]) => [c, `${c} (${d} cm)`, d]), nearestCup, 'simple'],
  // nipple-to-nipple distance, cm away from the average for her size
  ['set', 'Spacing', [['close', 'Close set', -3], ['closeish', 'Slightly close', -1.5], ['average', 'Average', 0], ['wideish', 'Slightly wide', 1.5], ['wide', 'Wide set', 3]], 'average', 'simple'],
  // where the breasts sit on the chest (MakeHuman's breast-trans target, about 1.4 cm per step)
  ['height', 'Position on the chest', [['high', 'High', 1.2], ['average', 'Average', 0], ['low', 'Low', -1.4]], 'average', 'simple'],
  // droop, mostly from MakeHuman's own sculpted shapes, which move the fold under the breast down with it:
  // [tilt (degrees, a gentle turn about the upper attachment), firmness (1 firm … -1 soft), lower (breast-trans
  // steps down), fuller below (volume steps)]. Very droopy brings the nipple to about the fold.
  ['lift', 'Lift / droop', [['lifted', 'Lifted (like in a supportive bra)', -4, 1, -0.5, -0.4], ['natural', 'Natural', 0, 0, 0, 0], ['slight', 'Slight droop', 3, -0.5, 0.4, 0.3], ['moderate', 'Moderate droop', 6, -1, 0.9, 0.6], ['very', 'Very droopy', 12, -1, 1, 1]], 'natural'],
  // how far the breasts point outward (degrees turned in from the base body)
  ['direction', 'Pointing', [['forward', 'Forward', 14], ['slight', 'Slightly outward', 7], ['outward', 'Outward (east-west)', -2]], 'slight'],
  ['fullness', 'Fullness', [['even', 'Even', 0], ['top', 'Fuller on top (round)', 1], ['bottom', 'Fuller below (teardrop)', -1]], 'even'],
  ['projection', 'Projection', [['less', 'Less (flatter)', -0.5], ['average', 'Average', 0], ['more', 'More (pointed)', 0.6]], 'average'],
  ['nippleSize', 'Nipple and areola size', [['small', 'Small', -0.7], ['average', 'Average', 0], ['large', 'Large', 0.7]], 'average'],
  ['nipplePoint', 'Nipple projection', [['flat', 'Flat', -0.7], ['average', 'Average', 0], ['prominent', 'Prominent', 0.7]], 'average'],
];
export function bustChoice(m, key) {
  const [, , ch, def] = BUST.find((b) => b[0] === key), d = typeof def === 'function' ? def(m) : def;
  return ch.find((c) => c[0] === m.bust3d?.[key]) || ch.find((c) => c[0] === d);
}
const simpleBust = (m) => bustChoice(m, 'mode')[0] === 'simple';
// The measurements the model is built to: with simple choices, the bust is the underbust plus the chosen cup.
export const modelMeasures = (m) => (simpleBust(m) ? { ...m, bust: m.underbust + bustChoice(m, 'cup')[2] } : m);

// Turns each breast about its base on the chest wall: inward (towards pointing forward) and down (droop),
// weighted by the breast area so the tissue bends smoothly into the chest. Angles in degrees.
function turnBreasts(pos, R, inward, down) {
  const { idx, w } = R.breast, ub = R.loops['underbust-circ'];
  for (const [side, sg] of [[0, 1], [1, -1]]) {
    const n = R.nipples[side], px = pos[n * 3], py = pos[n * 3 + 1] + 5; // hinge: the upper attachment, above the nipple
    // the chest wall: the front of the fold under the breast, which stays where it is
    const pz = Math.max(...ub.filter((i) => Math.abs(pos[i * 3] - px) < 6).map((i) => pos[i * 3 + 2])), depth = Math.max(3, pos[n * 3 + 2] - pz);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k] * 3;
      if (Math.sign(pos[i]) !== sg) continue;
      // The breast's mass moves together (front 55% of its depth fully), blending to nothing at the chest wall,
      // so the upper slope stretches and the tip doesn't pinch; the breastbone between the breasts stays put.
      const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
      const dx = pos[i] - px, dz0 = pos[i + 2] - pz, f = w[k] * smooth(dz0 / (0.45 * depth)) * smooth(Math.abs(pos[i]) / 4);
      const a = inward * f * sg * Math.PI / 180, b = down * f * Math.PI / 180;
      pos[i] = px + dx * Math.cos(a) - dz0 * Math.sin(a);
      const dz = dx * Math.sin(a) + dz0 * Math.cos(a), dy = pos[i + 1] - py;
      pos[i + 1] = py + dy * Math.cos(b) - dz * Math.sin(b); pos[i + 2] = pz + dy * Math.sin(b) + dz * Math.cos(b);
    }
  }
}

// The base body's nipples aim about 30° outward and 30° down, which reads as wide-set and droopy whatever the
// breast does. Turn the front of each breast in and up about a point deep inside it (degrees), fully at the
// nipple and fading out so the surface stays smooth: inward by 7 cm from it, up by 5 cm (so the fold under the
// breast isn't pushed up into a shelf).
function aimNipples(pos, R, inward, up) {
  const { idx } = R.breast;
  for (const [side, sg] of [[0, 1], [1, -1]]) {
    const n = R.nipples[side], px = pos[n * 3], py = pos[n * 3 + 1], pz = pos[n * 3 + 2] - 7;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k] * 3;
      if (Math.sign(pos[i]) !== sg) continue;
      const d = Math.hypot(pos[i] - px, pos[i + 1] - py, pos[i + 2] - pz - 7), fade = (r) => { const t = Math.max(0, Math.min(1, (d - 1.5) / (r - 1.5))); return 1 - t * t * (3 - 2 * t); };
      const wi = fade(7), wu = fade(5);
      if (!wi) continue;
      const a = inward * wi * sg * Math.PI / 180, b = -up * wu * Math.PI / 180;
      const dx = pos[i] - px, dz0 = pos[i + 2] - pz;
      pos[i] = px + dx * Math.cos(a) - dz0 * Math.sin(a);
      const dz = dx * Math.sin(a) + dz0 * Math.cos(a), dy = pos[i + 1] - py;
      pos[i + 1] = py + dy * Math.cos(b) - dz * Math.sin(b); pos[i + 2] = pz + dy * Math.sin(b) + dz * Math.cos(b);
    }
  }
}

export function makeBody(m0) {
  const R = raw(), pos = Float32Array.from(R.base), T = R.targets, m = modelMeasures(m0), simple = simpleBust(m0);
  for (const k of ['african-female-young', 'asian-female-young', 'caucasian-female-young']) addTarget(pos, T[k], 1 / 3); // female, young adult, mixed ethnicity
  const weights = {};
  // Overall build: heavier/lighter from the hip-to-height relationship, then cup size from bust − underbust.
  const build = Math.max(-1, Math.min(1, (m.hip / m.height - 0.6) / 0.08));
  addTarget(pos, build >= 0 ? T['universal-female-young-averagemuscle-maxweight'] : T['universal-female-young-averagemuscle-minweight'], Math.abs(build));
  const c = (key) => bustChoice(m0, key).slice(2), [inward] = c('direction'), [point] = c('projection'), [nSize] = c('nippleSize'), [nPoint] = c('nipplePoint');
  const diff = m.bust - m.underbust, cup = Math.max(-1, Math.min(1, (diff - 15) / 7)); // MakeHuman's cup shape; bigger busts carry on through the bust measurement
  // Gravity: from a C cup up, bigger breasts sit lower, fuller below and softer even when "natural"; the lift choice adds to that.
  const heavy = Math.max(0, Math.min(1, (diff - 17) / 10)), clamp1 = (x) => Math.max(-1, Math.min(1, x));
  const [droop, firmL, lower, fullerBelow] = c('lift'), firm = clamp1(firmL - 0.4 * heavy), full = clamp1(c('fullness')[0] - fullerBelow - 0.4 * heavy);
  // where the breasts sit (measurements fit this again below); past about one step MakeHuman's shape creases the ribs
  const [up] = simple ? c('height') : [0], trans = Math.max(-1.1, Math.min(1.2, up - lower - 0.5 * heavy));
  // MakeHuman's cup × firmness grid: blend the corners around (cup, firmness); average/average is the base.
  for (const [c, wc] of [['average', 1 - Math.abs(cup)], [cup >= 0 ? 'max' : 'min', Math.abs(cup)]])
    for (const [f, wf] of [['average', 1 - Math.abs(firm)], [firm >= 0 ? 'max' : 'min', Math.abs(firm)]])
      if (c !== 'average' || f !== 'average') addTarget(pos, T[`female-young-averagemuscle-averageweight-${c}cup-${f}firmness`], wc * wf);
  addTarget(pos, full >= 0 ? T['breast-volume-vert-up'] : T['breast-volume-vert-down'], Math.abs(full));
  addTarget(pos, point >= 0 ? T['breast-point-incr'] : T['breast-point-decr'], Math.abs(point));
  addTarget(pos, nSize >= 0 ? T['nipple-size-incr'] : T['nipple-size-decr'], Math.abs(nSize));
  addTarget(pos, nPoint >= 0 ? T['nipple-point-incr'] : T['nipple-point-decr'], Math.abs(nPoint));
  addTarget(pos, trans >= 0 ? T['breast-trans-up'] : T['breast-trans-down'], Math.abs(trans));
  turnBreasts(pos, R, inward, droop);
  aimNipples(pos, R, 12, Math.min(12, 10 * (1 - lower / 1.5))); // drooping breasts' nipples point down
  // Height (solved by secant on the height targets); repeated at the end because length targets change it.
  const solveHeight = () => { for (let it = 0; it < 3; it++) {
    const h0 = heightOf(pos), up = T['female-young-averagemuscle-averageweight-maxheight'], dn = T['female-young-averagemuscle-averageweight-minheight'], t = m.height > h0 ? up : dn;
    const probe = Float32Array.from(pos); addTarget(probe, t, 0.25);
    const per = (heightOf(probe) - h0) / 0.25;
    if (Math.abs(per) > 1e-6) addTarget(pos, t, Math.max(-1, Math.min(1.5, (m.height - h0) / per)));
  } };
  solveHeight();
  // One secant step of a target pair towards a wanted measurement.
  const fit = (name, want, measure, incr, decr, lim = 2) => {
    const now = measure(pos), ts = want > now ? incr : decr;
    const probe = Float32Array.from(pos); for (const t of ts) addTarget(probe, t, 0.5);
    const per = (measure(probe) - now) / 0.5;
    if (Math.abs(per) < 1e-6) return;
    const w = Math.max(-1.5, Math.min(1.5, (want - now) / per)), sum = (weights[name] || 0) + w;
    const wClamped = Math.max(-lim, Math.min(lim, sum)) - (weights[name] || 0); // keep shapes believable
    for (const t of ts) addTarget(pos, t, wClamped);
    weights[name] = (weights[name] || 0) + wClamped;
  };
  const nk = R.loops['shoulder-dist'][0]; // side of the neck
  const [nl, nr] = R.nipples, span = (q) => q[nl * 3] - q[nr * 3];
  const toBust = (q) => Math.hypot(q[nk * 3] - q[nl * 3], q[nk * 3 + 1] - q[nl * 3 + 1], q[nk * 3 + 2] - q[nl * 3 + 2]);
  // Spacing: her bust point to bust point, or with simple choices the average for her size (wider for bigger cups) ± the choice.
  const wantSpan = simple ? m.underbust * 0.245 + (diff - 15) * 0.3 + c('set')[0] : m.bustSpan * FACTOR.bustSpan;
  // Measurements: a few rounds, because neighbouring targets (bust/underbust, waist/hip) interact.
  for (let round = 0; round < 4; round++) {
    // Bust position first, so the circumferences are fitted last; bust shapes only within their designed range (beyond it they distort).
    if (wantSpan > 0) fit('bust-span', wantSpan, span, [T['breast-dist-incr']], [T['breast-dist-decr']], 1.5);
    if (!simple && m.shoulderToBust > 0) fit('bust-height', m.shoulderToBust * FACTOR.shoulderToBust, toBust, [T['breast-trans-down']], [T['breast-trans-up']], 1);
    for (const [key, names] of MAP) {
      const list = [names].flat(), want = m[key] * (FACTOR[key] || 1);
      if (!(want > 0) || list.some((n) => !R.loops[n])) continue;
      fit(list.join('+'), want, (q) => list.reduce((a, n) => a + loopLen(q, R.loops[n]), 0), list.map((n) => T[`measure-${n}-incr`]), list.map((n) => T[`measure-${n}-decr`]));
    }
  }
  solveHeight();
  // Stand on the floor, centred.
  let minY = Infinity, cx = 0, cz = 0;
  for (let i = 0; i < R.n; i++) { minY = Math.min(minY, pos[i * 3 + 1]); cx += pos[i * 3]; cz += pos[i * 3 + 2]; }
  cx /= R.n; cz /= R.n;
  for (let i = 0; i < R.n; i++) { pos[i * 3] -= cx; pos[i * 3 + 1] -= minY; pos[i * 3 + 2] -= cz; }
  return { pos, tris: R.tris, loops: R.loops, nipples: R.nipples, landmarks: landmarks(pos, R.loops), pads: pads(pos, R.loops, R.nipples), measure: (name) => loopLen(pos, R.loops[name]), span: span(pos) / FACTOR.bustSpan, toBust: toBust(pos) / FACTOR.shoulderToBust };
}

// Heights of key body levels (average y of each measurement loop) for placing pattern pieces.
function landmarks(pos, loops) {
  const avg = (name, axis = 1) => { const l = loops[name]; let s = 0; for (const i of l) s += pos[i * 3 + axis]; return s / l.length; };
  const y = (i) => pos[i * 3 + 1];
  return {
    neck: avg('neck-circ'), bust: avg('bust-circ'), underbust: avg('underbust-circ'), waist: avg('waist-circ'), hip: avg('hips-circ'),
    knee: avg('knee-circ'), ankle: avg('ankle-circ'), thigh: avg('thigh-circ'), nape: y(loops['napetowaist-dist'][0]), crotch: avg('thigh-circ') + 4,
    shoulderL: loops['shoulder-dist'][1], neckSide: loops['shoulder-dist'][0], wristL: loops['wrist-circ'][0], elbowL: loops['upperarm-length'][1],
  };
}

// Hands and feet are thinner than the spacing of the cloth's points (a thumb can slip between them),
// so for collisions they're padded out a little, like mittens and socks.
function pads(pos, loops, nipples) {
  const v = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], n = pos.length / 3;
  const wl = loops['wrist-circ'], W = [0, 1, 2].map((k) => wl.reduce((a, i) => a + pos[i * 3 + k], 0) / wl.length);
  const E = v(loops['upperarm-length'][1]), d = W.map((w, k) => w - E[k]), L = Math.hypot(...d), u = d.map((c) => c / L);
  const hands = [], feet = [], ankle = landmarks(pos, loops).ankle;
  for (let i = 0; i < n; i++) {
    const p = v(i), sg = Math.sign(p[0]) || 1, r = [p[0] - sg * W[0], p[1] - W[1], p[2] - W[2]];
    if (Math.abs(p[0]) > 15 && r[0] * sg * u[0] + r[1] * u[1] + r[2] * u[2] > 0.5 && Math.hypot(...r) < 25) hands.push(i);
    else if (p[1] < ankle - 3) feet.push(i);
  }
  // The bust points are small bumps the cloth can catch on the same way.
  const apex = nipples.map((i) => v(i));
  const bust = []; for (let i = 0; i < n; i++) { const p = v(i); if (apex.some((a) => Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) < 3)) bust.push(i); }
  return [{ verts: hands, r: 1.5 }, { verts: feet, r: 1 }, { verts: bust, r: 0.8 }];
}
