import test from 'node:test';
import assert from 'node:assert/strict';
import { meshPiece, unfold } from '../src/js/sim/mesh.js';
import { makeBody } from '../src/js/sim/body.js';
import { buildSDF } from '../src/js/sim/sdf.js';
import { assemble } from '../src/js/sim/garment.js';
import { makeSim, FABRICS } from '../src/js/sim/solver.js';
import { fitMap, tightZones } from '../src/js/sim/fit.js';
import { rect } from '../src/js/garments/common.js';
import { TYPES, normalize } from '../src/js/garments/index.js';
import { defaults } from '../src/js/measure-data.js';

const m = defaults();
const garmentOf = (type, o = {}) => { const T = TYPES[type], op = normalize(T, { ...o }, m); return { type, options: op, pieces: T.draft(m, op).pieces }; };
const body = makeBody(m), F = buildSDF(body.pos, body.tris, { pads: body.pads });
// A straight skirt of your own: four panels each w cm wide, so 4 × w round.
const own = (w) => ({ type: 'custom', options: {}, pieces: ['skirt-front', 'skirt-back'].map((role, i) => ({ ...rect(`own-${i}`, 'Piece', w, 50), custom: true, role, cut: { n: 2, mirror: true }, segs: ['waist', 'side', '', 'centre'].map((name) => ({ name, sa: 1.5 })) })) });
const draped = (g, fab = 'cotton') => { const sys = assemble(g, m, body, F), sim = makeSim(sys, F, FABRICS[fab]); while (!sim.done) sim.frame(); return sys; };
const share = (fit, ok) => fit.filter(ok).length / fit.length;

test('the fit map: a skirt drawn too small is tight round the hips, one that fits is not', () => {
  const small = draped(own(23)), fs = fitMap(small, F); // 92 cm round a 100 cm hip
  assert.ok(tightZones(small, fs, body.landmarks).includes('hips'), `too small: tight at ${tightZones(small, fs, body.landmarks)}`);
  assert.ok(share(fs, (v) => v >= 0.5) > 0.12, `too small: ${(share(fs, (v) => v >= 0.5) * 100).toFixed(0)}% clearly tight`);
  const good = draped(own(30)), fg = fitMap(good, F); // 120 cm round: plenty
  assert.deepEqual(tightZones(good, fg, body.landmarks), [], 'big enough: nothing tight');
  assert.ok(share(fg, (v) => v >= 0.4) < 0.03, `big enough: ${(share(fg, (v) => v >= 0.4) * 100).toFixed(0)}% clearly tight`);
  assert.ok(share(fg, (v) => v < -0.5) > 0.3, 'big enough: it hangs loose below the hips');
  assert.ok(fs.every((v) => v >= -1 && v <= 1) && fg.every((v) => v >= -1 && v <= 1), 'values stay between loose (-1) and tight (1)');
});

test('a drafted dress in its own size has nothing pulling tight', () => {
  const sys = draped(garmentOf('dress')), fit = fitMap(sys, F);
  assert.deepEqual(tightZones(sys, fit, body.landmarks), []);
});

test('seams and open edges are reported for drawing, with a way in from the edge for stitching', () => {
  const sys = assemble(garmentOf('dress'), m, body, F);
  assert.ok(sys.lines.length >= 10, `seam lines (${sys.lines.length})`);
  assert.ok(sys.lines.some((l) => l.dart) && sys.lines.some((l) => l.closed), 'darts and the round waist seam are among them');
  assert.ok(sys.hems.some((h) => h.off === 2), 'the skirt and sleeve hems are open edges');
  const sewn = new Set(sys.seams.flatMap(([i, j0, j1]) => [i, j0, j1]));
  for (const h of sys.hems) assert.ok(h.v.filter((v) => sewn.has(v)).length < h.v.length * 0.3, 'a hem is not a seam');
  for (const h of sys.hems) for (const v of h.v) if (sys.inU[v] >= 0) assert.ok(sys.inPerp[v] > 0.2 && sys.inU[v] !== v, 'each edge point has a neighbour inside the piece');
  assert.ok(sys.hems.every((h) => h.v.filter((v) => sys.inU[v] >= 0).length > h.v.length * 0.9), 'nearly every edge point has one');
});

test('the fabric has no holes beside darts, at any mesh size', () => {
  for (const [type, o] of [['dress', {}], ['skirt', { style: 'pencil' }], ['top', { fit: 'fitted' }], ['trousers', {}]]) for (const h of [1.6, 2, 2.4, 2.8, 3.2]) for (const p0 of garmentOf(type, o).pieces) {
    const M = meshPiece(unfold(p0), h), uses = new Map(), key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
    for (const t of M.tris) for (let e = 0; e < 3; e++) uses.set(key(t[e], t[(e + 1) % 3]), (uses.get(key(t[e], t[(e + 1) % 3])) || 0) + 1);
    // Edges with fabric on one side only should be the outline or a dart leg, nothing else.
    const ring = [...new Set(M.runs.flatMap((r) => r.idx))], at = new Map(ring.map((v, k) => [v, k])), legs = new Set(M.darts.flatMap((d) => d.flatMap((c) => c.slice(1).map((v, k) => key(c[k], v)))));
    const stray = [...uses].filter(([k, n]) => { const [a, b] = k.split(',').map(Number), ia = at.get(a), ib = at.get(b); return n === 1 && !legs.has(k) && (ia === undefined || ib === undefined || (Math.abs(ia - ib) !== 1 && Math.abs(ia - ib) !== ring.length - 1)); });
    assert.equal(stray.length, 0, `${type} ${p0.key} at ${h} cm: ${stray.length} edges of a hole`);
  }
});
