import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBody } from '../src/js/sim/body.js';
import { buildSDF, sample } from '../src/js/sim/sdf.js';
import { assemble } from '../src/js/sim/garment.js';
import { makeSim, FABRICS } from '../src/js/sim/solver.js';
import { createRunner } from '../src/js/sim/runner.js';
import { carryOver } from '../src/js/sim/warm.js';
import { TYPES, normalize } from '../src/js/garments/index.js';
import { defaults } from '../src/js/measure-data.js';

const m = defaults();
const garmentOf = (type, o = {}) => { const T = TYPES[type], op = normalize(T, { ...o }, m); return { type, options: op, pieces: T.draft(m, op).pieces }; };
const body = makeBody(m), F = buildSDF(body.pos, body.tris, { pads: body.pads });
const lowest = (x) => { let lo = Infinity; for (let i = 1; i < x.length; i += 3) lo = Math.min(lo, x[i]); return lo; };
const inside = (sys) => { const probe = [0, 0, 0, 0]; let n = 0; for (let i = 0; i < sys.N; i++) { sample(F, sys.x[i * 3], sys.x[i * 3 + 1], sys.x[i * 3 + 2], probe); if (probe[0] < -0.3) n++; } return n; };
// Run a job on a runner to the end; resolves with the frames it reported.
const finish = (send, msg) => new Promise((res, rej) => { const frames = []; send.on = (f) => { if (f.type === 'failed') return rej(new Error(f.why)); frames.push(f); if (f.done) res(frames); }; send(msg); });
const runnerPair = () => { const send = (msg) => R.handle(msg), R = createRunner((f) => send.on?.(f), { slice: 60 }); return send; };

// One cold drape, shared by the tests below.
const skirt = garmentOf('skirt'), cold = assemble(skirt, m, body, F);
{ const sim = makeSim(cold, F, FABRICS.cotton); while (!sim.done) sim.frame(); }

test('after a pattern edit the drape carries on from the last one and settles in a fraction of the time', () => {
  const g = garmentOf('skirt'), front = g.pieces.find((p) => p.key === 'front'); // the same skirt, 12 cm longer in front
  front.nodes.forEach((q) => { if (q.y > 30) q.y += 12; }); front.segs.forEach((s) => { if (s.c1 && s.c1.y > 30) { s.c1.y += 12; s.c2.y += 12; } });
  const sys = assemble(g, m, body, F), x0 = carryOver(cold, sys);
  assert.ok(x0 && x0.length === sys.N * 3, 'every new point has a place');
  // Unchanged cloth starts where it hung: the back piece's points are within a whisker of the old drape.
  const B = sys.inst.find((I) => I.key === 'back'), Bo = cold.inst.find((I) => I.key === 'back');
  assert.equal(B.pc.mesh.pts.length, Bo.pc.mesh.pts.length);
  let far = 0; for (let i = 0; i < B.pc.mesh.pts.length * 3; i++) far = Math.max(far, Math.abs(x0[B.base * 3 + i] - cold.x[Bo.base * 3 + i]));
  assert.ok(far < 0.05, `the untouched back is where it was (${far.toFixed(3)} cm)`);
  assert.ok(lowest(x0) < lowest(cold.x) - 9, 'the new cloth starts laid out below the old hem');
  sys.x.set(x0);
  const sim = makeSim(sys, F, FABRICS.cotton, { warm: true });
  let frames = 0; while (!sim.done) { sim.frame(); frames++; }
  assert.ok(frames < 90, `settles in ${frames} frames, against about 190 from scratch`);
  assert.ok(sys.x.every(Number.isFinite) && sim.gap() < 0.6 && inside(sys) < sys.N * 0.002, `sewn and outside the body (gap ${sim.gap().toFixed(2)}, ${inside(sys)} inside)`);
  // The new cloth hangs out to its full length (bunched at the old hem it would stay crumpled): 12 cm longer, about 12 cm lower.
  assert.ok(lowest(sys.x) < lowest(cold.x) - 10.5, `the longer front hangs its full length lower (${(lowest(cold.x) - lowest(sys.x)).toFixed(1)} cm)`);
  assert.equal(carryOver(cold, assemble(garmentOf('dress'), m, body, F)), null, 'a different garment starts from scratch');
});

test('the cloth can be taken hold of, pulled, and let go to settle again', () => {
  const sys = assemble(skirt, m, body, F); sys.x.set(cold.x);
  const sim = makeSim(sys, F, FABRICS.cotton, { warm: true });
  // a point on the front hem
  let i = 0; for (let k = 0; k < sys.N; k++) if (sys.x[k * 3 + 2] > 0 && sys.x[k * 3 + 1] < sys.x[i * 3 + 1]) i = k;
  const at = [sys.x[i * 3], sys.x[i * 3 + 1], sys.x[i * 3 + 2]];
  sim.grab(i); sim.pull([at[0], at[1] + 5, at[2] + 25]);
  for (let f = 0; f < 40; f++) sim.frame();
  assert.ok(sim.held && !sim.done, 'held cloth keeps simulating');
  assert.ok(sys.x[i * 3 + 2] > at[2] + 20, `the hem came forward with the hand (${(sys.x[i * 3 + 2] - at[2]).toFixed(0)} cm)`);
  sim.release();
  let frames = 0; while (!sim.done) { sim.frame(); frames++; }
  assert.ok(frames > 30 && frames < 120 && !sim.held, 'let go, it settles and stops');
  assert.ok(sys.x[i * 3 + 2] < at[2] + 12, `and falls back towards where it hung (${(sys.x[i * 3 + 2] - at[2]).toFixed(0)} cm forward)`);
  assert.ok(sys.x.every(Number.isFinite) && sim.gap() < 0.8, 'still in one piece');
});

test('the runner drapes a garment it assembles itself, in step with the page, and wakes up when the cloth is taken hold of', async () => {
  const send = runnerPair(), page = assemble(skirt, m, body, F);
  const layer = { g: structuredClone(skirt), m, fabric: 'cotton', N: page.N, x0: Float32Array.from(cold.x), warm: true, key: 'skirt' };
  const job = { type: 'start', id: 1, bodyKey: 'b', body: structuredClone({ pos: body.pos, tris: body.tris, loops: body.loops, landmarks: body.landmarks, pads: body.pads }), base: { key: 'b#', F: structuredClone(F) }, layers: [layer] };
  const frames = await finish(send, job), last = frames[frames.length - 1];
  assert.ok(frames.length > 1 && frames.every((f) => f.id === 1 && f.x.length === page.N * 3), 'frames of positions for every point');
  assert.ok(last.done && last.progress === 1 && Math.abs(lowest(last.x) - lowest(cold.x)) < 2, 'it ends settled, about where it started');
  // The same body isn't sent twice; the kept one is used.
  const again = await finish(send, { ...job, id: 2, body: undefined, base: { key: 'b#' } });
  assert.ok(again[again.length - 1].done);
  // Taking hold of a finished drape wakes it; letting go lets it finish again.
  let seen = 0; send.on = () => { seen++; };
  send({ type: 'grab', id: 2, i: 10 }); send({ type: 'pull', id: 2, p: [0, 60, 40] });
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(seen > 0, 'frames flow again while it is held');
  const done = new Promise((res) => { send.on = (f) => { if (f.done) res(f); }; });
  send({ type: 'release', id: 2 });
  assert.ok((await done).done);
  // A garment that comes out differently from the page's is refused, not drawn wrongly.
  await assert.rejects(finish(send, { ...job, id: 3, layers: [{ ...layer, N: page.N + 1 }] }), /differently/);
  await assert.rejects(finish(send, { ...job, id: 4, bodyKey: 'other', body: undefined }), /no body/);
});

test('fine detail spaces the cloth closer and still assembles and drapes', () => {
  const std = assemble(skirt, m, body, F), fine = assemble(skirt, m, body, F, { maxPoints: 20000, hMin: 1.15 });
  assert.ok(fine.h < std.h - 0.3 && fine.N > std.N * 1.5, `${std.N} points at ${std.h.toFixed(2)} cm → ${fine.N} at ${fine.h.toFixed(2)} cm`);
  const sim = makeSim(fine, F, FABRICS.cotton); while (!sim.done) sim.frame();
  assert.ok(fine.x.every(Number.isFinite) && sim.gap() < 0.6 && inside(fine) < fine.N * 0.002, `gap ${sim.gap().toFixed(2)}, ${inside(fine)} inside`);
});
