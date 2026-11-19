import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBody, posed, poser, POSES } from '../src/js/sim/body.js';
import { buildSDF, sample } from '../src/js/sim/sdf.js';
import { assemble, liftOut } from '../src/js/sim/garment.js';
import { makeSim, FABRICS } from '../src/js/sim/solver.js';
import { createRunner } from '../src/js/sim/runner.js';
import { shell, clearOf } from '../src/js/sim/layers.js';
import { carry } from '../src/js/sim/warm.js';
import { TYPES, normalize } from '../src/js/garments/index.js';
import { defaults } from '../src/js/measure-data.js';

const m = defaults();
const garmentOf = (type, o = {}) => { const T = TYPES[type], op = normalize(T, { ...o }, m); return { type, options: op, pieces: T.draft(m, op).pieces }; };
const body = makeBody(m), F = buildSDF(body.pos, body.tris, { pads: body.pads });
const bodyMsg = () => structuredClone({ pos: body.pos, tris: body.tris, loops: body.loops, landmarks: body.landmarks, pads: body.pads });
const drape = (sys, field, fab = 'cotton', o) => { const sim = makeSim(sys, field, FABRICS[fab], o); while (!sim.done) sim.frame(); return sim; };
const inside = (sys, field, depth = -0.3) => { const probe = [0, 0, 0, 0]; let n = 0; for (let i = 0; i < sys.N; i++) { sample(field, sys.x[i * 3], sys.x[i * 3 + 1], sys.x[i * 3 + 2], probe); if (probe[0] < depth) n++; } return n; };
const at = (pos, i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
const centre = (pos, loop) => { const c = [0, 0, 0]; for (const i of loop) for (let k = 0; k < 3; k++) c[k] += pos[i * 3 + k] / loop.length; return c; };

test('poses turn the arms and legs about their joints and leave the rest of the body where it was', () => {
  const wrist = (pos) => centre(pos, body.loops['wrist-circ']), ankle = (pos) => centre(pos, body.loops['ankle-circ']), waist = (pos) => centre(pos, body.loops['waist-circ']);
  const rest = wrist(body.pos), sh = at(body.pos, body.landmarks.shoulderL), len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const [pose] of POSES.slice(1)) {
    const pos = posed(body, pose);
    assert.ok(pos.every(Number.isFinite) && pos.length === body.pos.length, `${pose}: every point has a place`);
    assert.ok(len(waist(pos), waist(body.pos)) < 0.01, `${pose}: the waist stays put`);
    assert.ok(Math.abs(len(wrist(pos), sh) - len(rest, sh)) < 5, // (the joint it turns about is a few cm inside the shoulder point)
      `${pose}: the arm keeps its length (${len(wrist(pos), sh).toFixed(1)} vs ${len(rest, sh).toFixed(1)})`);
  }
  const down = wrist(posed(body, 'down')), out = wrist(posed(body, 'out')), walk = posed(body, 'walk');
  assert.ok(down[0] < rest[0] - 12 && down[1] < rest[1] - 5, `arms down: the wrist is in by her side and lower (${down.map((v) => v.toFixed(0))} from ${rest.map((v) => v.toFixed(0))})`);
  assert.ok(out[1] > rest[1] + 25 && out[0] > rest[0] + 8, `arms out: the wrist is up and out (${out.map((v) => v.toFixed(0))})`);
  // Mid-step: her left foot forward, her right foot back (the ankle loop is on her left; its mirror point finds the right).
  const la = ankle(walk), ra = ankle(body.pos), move = poser(body, 'walk'), q = move(-ra[0], ra[1], ra[2], [0, 0, 0]);
  assert.ok(la[2] > ra[2] + 15 && q[2] < ra[2] - 8, `left foot forward ${(la[2] - ra[2]).toFixed(0)} cm, right back ${(ra[2] - q[2]).toFixed(0)} cm`);
  // Hands and feet keep their shape: every pair of points in them stays the same distance apart.
  for (const [pose] of POSES.slice(1)) {
    const pos = posed(body, pose);
    for (const { verts } of body.pads.slice(0, 2)) for (let k = 0; k + 7 < verts.length; k += 7) {
      const i = verts[k], j = verts[k + 7];
      if (Math.sign(body.pos[i * 3]) !== Math.sign(body.pos[j * 3])) continue; // the same hand or foot
      assert.ok(Math.abs(len(at(pos, i), at(pos, j)) - len(at(body.pos, i), at(body.pos, j))) < 0.05, `${pose}: a hand or foot is pulled out of shape`);
    }
  }
  // The two sides mirror each other in a symmetric pose.
  const dn = poser(body, 'down'), a = dn(rest[0], rest[1], rest[2], [0, 0, 0]).slice(), b = dn(-rest[0], rest[1], rest[2], [0, 0, 0]);
  assert.ok(Math.abs(a[0] + b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6);
});

// One pair of jeans draped on the bare body, shared by the tests below.
const jeans = garmentOf('jeans'), under = assemble(jeans, m, body, F);
drape(under, F, 'denim');

test('a top goes on over jeans: it lies on them, not through them, and nothing starts underneath', () => {
  const over = shell(body, body.pos, [under], F), top = assemble(garmentOf('top', { length: 'hip' }), m, body, over);
  // The solid it drapes over is the body and the jeans together: the jeans' cloth is on its surface.
  const probe = [0, 0, 0, 0]; let far = 0;
  for (let i = 0; i < under.N; i++) { sample(over, under.x[i * 3], under.x[i * 3 + 1], under.x[i * 3 + 2], probe); if (Math.abs(probe[0]) > 0.6) far++; }
  assert.ok(far < under.N * 0.03, `${far} of ${under.N} jeans points are off the solid's surface`);
  clearOf(top, [under], body);
  assert.equal(clearOf(top, [under], body), 0, 'once cleared, nothing is underneath');
  const sim = drape(top, over);
  assert.ok(top.x.every(Number.isFinite) && sim.gap() < 0.8, `sewn (gap ${sim.gap().toFixed(2)})`);
  assert.ok(inside(top, over) < top.N * 0.01, `${inside(top, over)} of ${top.N} points of the top are inside the jeans or the body`);
  // Round the hips the top is outside the jeans: further from the bare body than the jeans' own cloth is.
  const hip = body.landmarks.hip, dist = (sys) => { let s = 0, n = 0; for (let i = 0; i < sys.N; i++) if (Math.abs(sys.x[i * 3 + 1] - hip - 6) < 4) { sample(F, sys.x[i * 3], sys.x[i * 3 + 1], sys.x[i * 3 + 2], probe); s += probe[0]; n++; } return n > 20 ? s / n : NaN; };
  assert.ok(dist(top) > dist(under) + 0.3, `at the hips the top is ${dist(top).toFixed(2)} cm off the body, the jeans ${dist(under).toFixed(2)} cm`);
});

test('a top that starts underneath a full skirt is moved out over it', () => {
  const skirt = assemble(garmentOf('skirt', { style: 'circle' }), m, body, F); drape(skirt, F);
  const top = assemble(garmentOf('top', { length: 'tunic' }), m, body, F), moved = clearOf(top, [skirt], body);
  assert.ok(moved > 50, `${moved} points of the tunic began under the skirt`);
  assert.equal(clearOf(top, [skirt], body), 0);
  assert.ok(top.x.every(Number.isFinite));
  // A twirl: a circle skirt has the hem to fly out; it lifts, then comes back down and stops.
  const reach = () => { let r = 0; for (let i = 0; i < skirt.N; i++) r = Math.max(r, Math.hypot(skirt.x[i * 3], skirt.x[i * 3 + 2])); return r; }, low = () => { let lo = Infinity; for (let i = 0; i < skirt.N; i++) lo = Math.min(lo, skirt.x[i * 3 + 1]); return lo; };
  const r0 = reach(), y0 = low(), sim = makeSim(skirt, F, FABRICS.cotton, { warm: true });
  sim.spin();
  let wide = 0, high = 0, frames = 0; while (!sim.done) { sim.frame(); frames++; wide = Math.max(wide, reach()); high = Math.max(high, low()); }
  assert.ok(wide > r0 + 12 && high > y0 + 8, `the hem flies out ${(wide - r0).toFixed(0)} cm and up ${(high - y0).toFixed(0)} cm`);
  assert.ok(frames > 150 && frames < 300 && skirt.x.every(Number.isFinite) && sim.gap() < 0.8, `then it stops (${frames} frames)`);
  assert.ok(Math.abs(low() - y0) < 4, `and hangs as before (${(low() - y0).toFixed(1)} cm off)`);
});

test('the runner drapes an outfit in order, reports each garment, and can twirl the one on top', async () => {
  const frames = [], send = (msg) => R.handle(msg), R = createRunner((f) => { frames.push(f); send.on?.(f); }, { slice: 300 });
  const top = garmentOf('top', { length: 'hip' }), page = assemble(top, m, body, F);
  const done = () => new Promise((res, rej) => { send.on = (f) => { if (f.type === 'failed') rej(new Error(f.why)); if (f.done) res(f); }; });
  const fin = done();
  send({ type: 'start', id: 1, bodyKey: 'b', body: bodyMsg(), base: { key: 'b#', F: structuredClone(F) }, layers: [
    { g: structuredClone(jeans), m, fabric: 'denim', N: under.N, x0: Float32Array.from(under.x), done: true, key: 'jeans' }, // already draped: only what the top lies on
    { g: structuredClone(top), m, fabric: 'cotton', N: page.N, key: 'jeans|top' }] });
  await fin;
  const of = (k) => frames.filter((f) => f.layer === k);
  assert.ok(of(0).length === 1 && of(0)[0].layerDone && !of(0)[0].x && !of(0)[0].done, 'the finished jeans are passed over in one step');
  assert.ok(of(1).length > 3 && of(1).every((f) => f.x.length === page.N * 3) && of(1).at(-1).done, 'the top is draped, frame by frame, and ends the job');
  const x = of(1).at(-1).x, low = () => { let lo = Infinity; for (let i = 1; i < x.length; i += 3) lo = Math.min(lo, x[i]); return lo; };
  assert.ok(low() > body.landmarks.hip - 25 && low() < body.landmarks.waist, 'it hangs to the hips');
  // Twirl the top (layer 1): frames flow again, the cloth flies out, then it settles and stops.
  frames.length = 0; const again = done();
  send({ type: 'spin', id: 1, layer: 1 });
  await again;
  assert.ok(frames.length > 2 && frames.every((f) => f.layer === 1 && f.x) && frames.at(-1).done, 'only the top is simulated, and it stops');
  assert.ok(frames.at(-1).x.every(Number.isFinite) && Math.abs(Math.min(...frames.at(-1).x.filter((_, i) => i % 3 === 1)) - low()) < 3, 'and comes back to rest');
});

test('lowering the arms carries the sleeves with them, and the drape settles on the posed body', () => {
  const top = assemble(garmentOf('top', { sleeve: 'long' }), m, body, F); drape(top, F);
  const sleeve = top.inst.find((I) => I.frame === 'sleeve' && !I.mirror), cuffY = (x) => { let lo = Infinity; for (let i = sleeve.base; i < sleeve.base + sleeve.pc.mesh.pts.length; i++) lo = Math.min(lo, x[i * 3 + 1]); return lo; };
  const before = cuffY(top.x), pos = posed(body, 'down'), Fp = buildSDF(pos, body.tris, { pads: body.pads });
  top.x.set(carry(top, poser(body, 'down')));
  assert.ok(cuffY(top.x) < before - 6, `the cuff comes down with the wrist (${before.toFixed(0)} → ${cuffY(top.x).toFixed(0)})`);
  liftOut(top, Fp);
  assert.equal(inside(top, Fp, 0.3), 0, 'lifted clear of the posed body before it settles');
  const sim = drape(top, Fp, 'cotton', { warm: 2 });
  assert.ok(top.x.every(Number.isFinite) && sim.gap() < 0.8, `still sewn (gap ${sim.gap().toFixed(2)})`);
  assert.ok(inside(top, Fp) < top.N * 0.01, `${inside(top, Fp)} of ${top.N} points inside the posed body`);
  assert.ok(cuffY(top.x) < before - 6, 'the sleeve stays down the arm');
});
