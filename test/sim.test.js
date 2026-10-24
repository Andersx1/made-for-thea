import test from 'node:test';
import assert from 'node:assert/strict';
import { meshPiece, unfold } from '../src/js/sim/mesh.js';
import { makeBody } from '../src/js/sim/body.js';
import { buildSDF, sample } from '../src/js/sim/sdf.js';
import { assemble } from '../src/js/sim/garment.js';
import { rotate90 } from '../src/js/geom.js';
import { makeSim, FABRICS } from '../src/js/sim/solver.js';
import { TYPES, normalize } from '../src/js/garments/index.js';
import { defaults } from '../src/js/measure-data.js';

const m = defaults();
const garmentOf = (type, o = {}) => { const T = TYPES[type], op = normalize(T, { ...o }, m); return { type, options: op, pieces: T.draft(m, op).pieces }; };
const triArea = (M) => M.tris.reduce((a, [i, j, k]) => { const A = M.pts[i], B = M.pts[j], C = M.pts[k]; return a + Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y)) / 2; }, 0);
const dartArea = (p) => (p.marks || []).filter((mk) => mk.type === 'dart').reduce((a, mk) => { const P = mk.pts.slice(0, mk.pts.length === 5 ? 4 : 3); let s = 0; P.forEach((q, i) => { const r = P[(i + 1) % P.length]; s += q.x * r.y - r.x * q.y; }); return a + Math.abs(s / 2); }, 0);

test('pattern pieces mesh into fabric that covers the piece, minus the darts', () => {
  for (const [type, o] of [['skirt', {}], ['dress', {}], ['top', { length: 'tunic' }], ['jeans', {}], ['jacket', {}]]) {
    for (const p0 of garmentOf(type, o).pieces) {
      const p = unfold(p0), M = meshPiece(p, 2), want = Math.abs(M.area) - dartArea(p);
      assert.ok(Math.abs(triArea(M) - want) / want < 0.01, `${type} ${p0.key}: mesh ${triArea(M).toFixed(0)} vs piece ${want.toFixed(0)} cm²`);
    }
  }
});

test('a cut-on-fold piece unfolds to twice its area', () => {
  const p = garmentOf('skirt').pieces.find((q) => q.key === 'front');
  assert.ok(p.segs.some((s) => s.fold));
  const half = Math.abs(meshPiece({ ...p, segs: p.segs.map((s) => ({ ...s, fold: false })) }, 2).area), full = Math.abs(meshPiece(unfold(p), 2).area);
  assert.ok(Math.abs(full - 2 * half) < 0.5, `${full} vs 2 × ${half}`);
});

const body = makeBody(m), F = buildSDF(body.pos, body.tris, { pads: body.pads });

test('every garment type is sewn up: seams found, positions sane, edits included', () => {
  for (const [type, o, want] of [['skirt', {}, 1], ['skirt', { style: 'circle' }, 1], ['skirt', { style: 'gathered', tiers: '2' }, 1], ['top', {}, 1], ['top', { shaping: 'princess', closure: 'buttons' }, 1], ['dress', {}, 1], ['dress', { neckline: 'strappy', back: 'shirred', closure: 'none', skirtStyle: 'gathered' }, 1], ['trousers', {}, 1], ['jeans', {}, 1], ['jacket', {}, 1]]) {
    const sys = assemble(garmentOf(type, o), m, body, F);
    assert.ok(sys && sys.N > 500, `${type} has fabric`);
    assert.ok(sys.seams.length > 50 * want, `${type} ${JSON.stringify(o)} has seams (${sys.seams.length})`);
    assert.ok(sys.x.every(Number.isFinite), `${type} positions are numbers`);
    if (type === 'skirt' || type === 'trousers' || type === 'jeans') assert.ok(sys.pins.length > 20, `${type} is held at the waist`);
  }
  // A hand-edited piece is what gets draped: lengthen the skirt front and its fabric gets longer.
  const g = garmentOf('skirt'), front = g.pieces.find((p) => p.key === 'front'), before = assemble(g, m, body, F);
  front.nodes.forEach((q) => { if (q.y > 30) q.y += 15; }); front.segs.forEach((s) => { if (s.c1 && s.c1.y > 30) { s.c1.y += 15; s.c2.y += 15; } }); front.edited = true;
  const after = assemble(g, m, body, F), lowest = (sys) => Math.min(...Array.from({ length: sys.N }, (_, i) => sys.x[i * 3 + 1]));
  assert.ok(lowest(after) < lowest(before) - 10, 'the edited hem hangs lower');
});

test('a skirt, trousers and a dress drape: seams close tight, nothing ends up inside the body', () => {
  for (const [type, fab] of [['skirt', 'cotton'], ['trousers', 'linen'], ['dress', 'cotton']]) {
    const sys = assemble(garmentOf(type), m, body, F), sim = makeSim(sys, F, FABRICS[fab]);
    while (!sim.done) sim.frame();
    const probe = [0, 0, 0, 0];
    let inside = 0;
    for (let i = 0; i < sys.N; i++) { sample(F, sys.x[i * 3], sys.x[i * 3 + 1], sys.x[i * 3 + 2], probe); if (probe[0] < -0.3) inside++; }
    assert.ok(sys.x.every(Number.isFinite), `${type}: no blow-ups`);
    assert.ok(sim.gap() < 0.6, `${type}: seams closed (largest gap ${sim.gap().toFixed(2)} cm)`);
    assert.ok(inside < sys.N * 0.002, `${type}: ${inside} points inside the body`);
    const waist = body.landmarks.waist;
    if (sys.pins.length) assert.ok(Math.max(...sys.pins.map(([i]) => sys.x[i * 3 + 1])) > waist - 8, `${type}: still at the waist`);
  }
});

test('pieces of your own sew up in 3D once given a role, whichever way round they were drawn', () => {
  const g = garmentOf('skirt'), roles = { front: 'skirt-front', back: 'skirt-back' };
  g.type = 'custom';
  g.pieces = g.pieces.filter((p) => roles[p.key]).map((p, i) => { rotate90(p); return { ...p, key: `own-${i}`, custom: true, role: roles[p.key] }; });
  const sys = assemble(g, m, body, F);
  assert.ok(sys && sys.seams.length > 50, `seams (${sys?.seams.length})`);
  assert.ok(sys.pins.length > 20, 'held at the waist');
  assert.equal(assemble({ ...g, pieces: g.pieces.map((p) => ({ ...p, role: undefined })) }, m, body, F), null, 'no roles, no 3D');
});
