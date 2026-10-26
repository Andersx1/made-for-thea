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
const FACTOR = { backLength: 0.97, waistToHip: 0.92, shoulderLength: 0.95, armLength: 0.92, shoulderToBust: 0.97 };
// Bust types: firmness (-1 soft … 1 firm), fullness (-1 fuller below … 1 fuller above) and projection.
// Size, spread and height come from the measurements instead.
export const BUST_TYPES = {
  average: ['Average', 0, 0, 0], round: ['Round (full above and below)', 1, 1, 0], teardrop: ['Teardrop (fuller below)', 0, -1, 0],
  relaxed: ['Relaxed (softer, sits lower)', -1, -1, 0], projected: ['Projected (pointed)', 0.4, 0, 1],
};

export function makeBody(m) {
  const R = raw(), pos = Float32Array.from(R.base), T = R.targets;
  for (const k of ['african-female-young', 'asian-female-young', 'caucasian-female-young']) addTarget(pos, T[k], 1 / 3); // female, young adult, mixed ethnicity
  const weights = {};
  // Overall build: heavier/lighter from the hip-to-height relationship, then cup size from bust − underbust.
  const build = Math.max(-1, Math.min(1, (m.hip / m.height - 0.6) / 0.08));
  addTarget(pos, build >= 0 ? T['universal-female-young-averagemuscle-maxweight'] : T['universal-female-young-averagemuscle-minweight'], Math.abs(build));
  const cup = Math.max(-1, Math.min(1, ((m.bust - m.underbust) - 15) / 7));
  const [, firm, full, point] = BUST_TYPES[m.bustShape] || BUST_TYPES.average;
  // MakeHuman's cup × firmness grid: blend the corners around (cup, firmness); average/average is the base.
  for (const [c, wc] of [['average', 1 - Math.abs(cup)], [cup >= 0 ? 'max' : 'min', Math.abs(cup)]])
    for (const [f, wf] of [['average', 1 - Math.abs(firm)], [firm >= 0 ? 'max' : 'min', Math.abs(firm)]])
      if (c !== 'average' || f !== 'average') addTarget(pos, T[`female-young-averagemuscle-averageweight-${c}cup-${f}firmness`], wc * wf);
  addTarget(pos, full >= 0 ? T['breast-volume-vert-up'] : T['breast-volume-vert-down'], Math.abs(full));
  addTarget(pos, point >= 0 ? T['breast-point-incr'] : T['breast-point-decr'], Math.abs(point));
  // Height (solved by secant on the height targets); repeated at the end because length targets change it.
  const solveHeight = () => { for (let it = 0; it < 3; it++) {
    const h0 = heightOf(pos), up = T['female-young-averagemuscle-averageweight-maxheight'], dn = T['female-young-averagemuscle-averageweight-minheight'], t = m.height > h0 ? up : dn;
    const probe = Float32Array.from(pos); addTarget(probe, t, 0.25);
    const per = (heightOf(probe) - h0) / 0.25;
    if (Math.abs(per) > 1e-6) addTarget(pos, t, Math.max(-1, Math.min(1.5, (m.height - h0) / per)));
  } };
  solveHeight();
  // One secant step of a target pair towards a wanted measurement.
  const fit = (name, want, measure, incr, decr) => {
    const now = measure(pos), ts = want > now ? incr : decr;
    const probe = Float32Array.from(pos); for (const t of ts) addTarget(probe, t, 0.5);
    const per = (measure(probe) - now) / 0.5;
    if (Math.abs(per) < 1e-6) return;
    const w = Math.max(-1.5, Math.min(1.5, (want - now) / per)), sum = (weights[name] || 0) + w;
    const wClamped = Math.max(-2, Math.min(2, sum)) - (weights[name] || 0); // keep shapes believable
    for (const t of ts) addTarget(pos, t, wClamped);
    weights[name] = (weights[name] || 0) + wClamped;
  };
  const nk = R.loops['shoulder-dist'][0]; // side of the neck
  const span = (q) => { const [a, b] = apexes(q, R.loops); return Math.abs(a[0] - b[0]); };
  const toBust = (q) => { const a = apexes(q, R.loops)[0]; return Math.hypot(q[nk * 3] - a[0], q[nk * 3 + 1] - a[1], q[nk * 3 + 2] - a[2]); };
  // Measurements: a few rounds, because neighbouring targets (bust/underbust, waist/hip) interact.
  for (let round = 0; round < 4; round++) {
    for (const [key, names] of MAP) {
      const list = [names].flat(), want = m[key] * (FACTOR[key] || 1);
      if (!(want > 0) || list.some((n) => !R.loops[n])) continue;
      fit(list.join('+'), want, (q) => list.reduce((a, n) => a + loopLen(q, R.loops[n]), 0), list.map((n) => T[`measure-${n}-incr`]), list.map((n) => T[`measure-${n}-decr`]));
    }
    if (m.bustSpan > 0) fit('bust-span', m.bustSpan, span, [T['breast-dist-incr']], [T['breast-dist-decr']]);
    if (m.shoulderToBust > 0) fit('bust-height', m.shoulderToBust * FACTOR.shoulderToBust, toBust, [T['breast-trans-down']], [T['breast-trans-up']]);
  }
  solveHeight();
  // Stand on the floor, centred.
  let minY = Infinity, cx = 0, cz = 0;
  for (let i = 0; i < R.n; i++) { minY = Math.min(minY, pos[i * 3 + 1]); cx += pos[i * 3]; cz += pos[i * 3 + 2]; }
  cx /= R.n; cz /= R.n;
  for (let i = 0; i < R.n; i++) { pos[i * 3] -= cx; pos[i * 3 + 1] -= minY; pos[i * 3 + 2] -= cz; }
  return { pos, tris: R.tris, loops: R.loops, landmarks: landmarks(pos, R.loops), pads: pads(pos, R.loops), measure: (name) => loopLen(pos, R.loops[name]), span: span(pos), toBust: toBust(pos) / FACTOR.shoulderToBust };
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

// Bust points: the most forward point of each side of the chest, near the bust line. [left, right] as [x, y, z].
function apexes(pos, loops) {
  const n = pos.length / 3, l = loops['bust-circ']; let yb = 0; for (const i of l) yb += pos[i * 3 + 1]; yb /= l.length;
  return [1, -1].map((sg) => {
    let best = -1;
    for (let i = 0; i < n; i++) { const x = pos[i * 3], y = pos[i * 3 + 1]; if (Math.sign(x) === sg && Math.abs(x) > 3 && Math.abs(x) < 18 && Math.abs(y - yb) < 9 && (best < 0 || pos[i * 3 + 2] > pos[best * 3 + 2])) best = i; }
    return [pos[best * 3], pos[best * 3 + 1], pos[best * 3 + 2]];
  });
}

// Hands and feet are thinner than the spacing of the cloth's points (a thumb can slip between them),
// so for collisions they're padded out a little, like mittens and socks.
function pads(pos, loops) {
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
  const apex = apexes(pos, loops);
  const bust = []; for (let i = 0; i < n; i++) { const p = v(i); if (apex.some((a) => Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) < 3)) bust.push(i); }
  return [{ verts: hands, r: 1.5 }, { verts: feet, r: 1 }, { verts: bust, r: 0.8 }];
}
