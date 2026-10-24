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
const FACTOR = { backLength: 0.97, waistToHip: 0.92, shoulderLength: 0.95, armLength: 0.92 };

export function makeBody(m) {
  const R = raw(), pos = Float32Array.from(R.base), T = R.targets;
  for (const k of ['african-female-young', 'asian-female-young', 'caucasian-female-young']) addTarget(pos, T[k], 1 / 3); // female, young adult, mixed ethnicity
  const weights = {};
  // Overall build: heavier/lighter from the hip-to-height relationship, then cup size from bust − underbust.
  const build = Math.max(-1, Math.min(1, (m.hip / m.height - 0.6) / 0.08));
  addTarget(pos, build >= 0 ? T['universal-female-young-averagemuscle-maxweight'] : T['universal-female-young-averagemuscle-minweight'], Math.abs(build));
  const cup = Math.max(-1, Math.min(1, ((m.bust - m.underbust) - 15) / 7));
  addTarget(pos, cup >= 0 ? T['female-young-averagemuscle-averageweight-maxcup-averagefirmness'] : T['female-young-averagemuscle-averageweight-mincup-averagefirmness'], Math.abs(cup));
  // Height (solved by secant on the height targets); repeated at the end because length targets change it.
  const solveHeight = () => { for (let it = 0; it < 3; it++) {
    const h0 = heightOf(pos), up = T['female-young-averagemuscle-averageweight-maxheight'], dn = T['female-young-averagemuscle-averageweight-minheight'], t = m.height > h0 ? up : dn;
    const probe = Float32Array.from(pos); addTarget(probe, t, 0.25);
    const per = (heightOf(probe) - h0) / 0.25;
    if (Math.abs(per) > 1e-6) addTarget(pos, t, Math.max(-1, Math.min(1.5, (m.height - h0) / per)));
  } };
  solveHeight();
  // Measurements: a few rounds, because neighbouring targets (bust/underbust, waist/hip) interact.
  for (let round = 0; round < 4; round++) for (const [key, names] of MAP) {
    const list = [names].flat(), want = m[key] * (FACTOR[key] || 1), name = list.join('+');
    if (!(want > 0) || list.some((n) => !R.loops[n])) continue;
    const len = (q) => list.reduce((a, n) => a + loopLen(q, R.loops[n]), 0), now = len(pos);
    const ts = list.map((n) => (want > now ? T[`measure-${n}-incr`] : T[`measure-${n}-decr`]));
    const probe = Float32Array.from(pos); for (const t of ts) addTarget(probe, t, 0.5);
    const per = (len(probe) - now) / 0.5;
    if (Math.abs(per) < 1e-6) continue;
    const w = Math.max(-1.5, Math.min(1.5, (want - now) / per)), sum = (weights[name] || 0) + w;
    const wClamped = Math.max(-2, Math.min(2, sum)) - (weights[name] || 0); // keep shapes believable
    for (const t of ts) addTarget(pos, t, wClamped);
    weights[name] = (weights[name] || 0) + wClamped;
  }
  solveHeight();
  // Stand on the floor, centred.
  let minY = Infinity, cx = 0, cz = 0;
  for (let i = 0; i < R.n; i++) { minY = Math.min(minY, pos[i * 3 + 1]); cx += pos[i * 3]; cz += pos[i * 3 + 2]; }
  cx /= R.n; cz /= R.n;
  for (let i = 0; i < R.n; i++) { pos[i * 3] -= cx; pos[i * 3 + 1] -= minY; pos[i * 3 + 2] -= cz; }
  return { pos, tris: R.tris, loops: R.loops, landmarks: landmarks(pos, R.loops), pads: pads(pos, R.loops), measure: (name) => loopLen(pos, R.loops[name]) };
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
  const lm = landmarks(pos, loops), apex = [1, -1].map((sg) => { let best = -1; for (let i = 0; i < n; i++) { const p = v(i); if (Math.sign(p[0]) === sg && Math.abs(p[0]) > 4 && Math.abs(p[0]) < 16 && Math.abs(p[1] - lm.bust) < 5 && (best < 0 || p[2] > pos[best * 3 + 2])) best = i; } return v(best); });
  const bust = []; for (let i = 0; i < n; i++) { const p = v(i); if (apex.some((a) => Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) < 3)) bust.push(i); }
  return [{ verts: hands, r: 1.5 }, { verts: feet, r: 1 }, { verts: bust, r: 0.8 }];
}
