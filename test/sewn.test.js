import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBody } from '../src/js/sim/body.js';
import { buildSDF, sample } from '../src/js/sim/sdf.js';
import { assemble } from '../src/js/sim/garment.js';
import { makeSim, FABRICS } from '../src/js/sim/solver.js';
import { rect } from '../src/js/garments/common.js';
import { segLen } from '../src/js/geom.js';
import { TYPES, normalize } from '../src/js/garments/index.js';
import { defaults } from '../src/js/measure-data.js';

const m = defaults();
const garmentOf = (type, o = {}) => { const T = TYPES[type], op = normalize(T, { ...o }, m); return { type, options: op, pieces: T.draft(m, op).pieces }; };
const body = makeBody(m), F = buildSDF(body.pos, body.tris, { pads: body.pads });
const P = (g, key) => g.pieces.find((p) => p.key === key);
const mark = (p, name, sew, extra = {}) => p.segs.forEach((s) => { if (s.name === name) Object.assign(s, { sew, ...extra }); });
const lenOf = (p, name) => p.segs.reduce((a, s, i) => a + (s.name === name ? segLen(p, i) : 0), 0);
// A strip of your own, w × h cm, with no place on the body: its top edge carries the sewing mark.
const strip = (id, w, h, sew, cut = { n: 1 }) => { const p = { ...rect(`own-${id}`, id, w, h), id, custom: true, role: 'attach', cut }; p.segs[0].sew = sew; return p; };
const partsOf = (sys, frame) => sys.inst.filter((I) => I.frame === frame);
const ys = (sys, I) => Array.from({ length: I.pc.mesh.pts.length }, (_, i) => sys.x[(I.base + i) * 3 + 1]);
const xs = (sys, I) => Array.from({ length: I.pc.mesh.pts.length }, (_, i) => sys.x[(I.base + i) * 3]);

test('a ruffle sewn to a skirt hem starts along the hem, hangs below it and stays sewn on', () => {
  const plain = assemble(garmentOf('skirt'), m, body, F), lowest = (sys) => Math.min(...sys.x.filter((_, i) => i % 3 === 1));
  const g = garmentOf('skirt'), front = P(g, 'front'), back = P(g, 'back');
  mark(front, 'hem', 'r'); mark(back, 'hem', 'r');
  const round = 2 * lenOf(front, 'hem') + 2 * lenOf(back, 'hem'); // front on the fold, back cut 2
  g.pieces.push(strip('ruffle', round * 1.5, 12, 'r')); // half as long again: it gathers
  const sys = assemble(g, m, body, F), [R] = partsOf(sys, 'attach');
  assert.ok(R && partsOf(sys, 'attach').length === 1, 'the ruffle is part of the garment');
  assert.ok(sys.x.every(Number.isFinite), 'every point has a place');
  // (the hem curves up a few cm at the sides)
  assert.ok(Math.max(...ys(sys, R)) < lowest(plain) + 9 && Math.min(...ys(sys, R)) < lowest(plain) - 8, `it starts at the hem and reaches below it (${Math.min(...ys(sys, R)).toFixed(0)}…${Math.max(...ys(sys, R)).toFixed(0)} vs hem ${lowest(plain).toFixed(0)})`);
  assert.ok(Math.max(...xs(sys, R)) > 15 && Math.min(...xs(sys, R)) < -15, 'it goes all the way round');
  assert.ok(sys.seams.length > plain.seams.length + 60, `it is sewn on (${sys.seams.length - plain.seams.length} more stitches)`);
  const sim = makeSim(sys, F, FABRICS.cotton);
  while (!sim.done) sim.frame();
  const probe = [0, 0, 0, 0];
  let inside = 0;
  for (let i = 0; i < sys.N; i++) { sample(F, sys.x[i * 3], sys.x[i * 3 + 1], sys.x[i * 3 + 2], probe); if (probe[0] < -0.3) inside++; }
  assert.ok(sys.x.every(Number.isFinite), 'no blow-ups');
  assert.ok(sim.gap() < 0.8, `seams closed (largest gap ${sim.gap().toFixed(2)} cm)`);
  assert.ok(inside < sys.N * 0.002, `${inside} points inside the body`);
  assert.ok(Math.min(...ys(sys, R)) < lowest(plain) - 6, 'draped, the ruffle still hangs below the hem');
});

test('edges sewn by hand sew up like the named ones: side seams, and a centre seam to its mirror image', () => {
  const named = assemble(garmentOf('skirt'), m, body, F);
  const g = garmentOf('skirt');
  for (const k of ['front', 'back']) { P(g, k).segs.forEach((s) => { if (s.name === 'side') { s.name = ''; s.sew = 'side'; } }); }
  P(g, 'back').segs.forEach((s) => { if (s.name === 'centre') { s.name = ''; s.sew = 'cb'; s.twin = true; } });
  const sys = assemble(g, m, body, F);
  assert.ok(Math.abs(sys.seams.length - named.seams.length) < named.seams.length * 0.05, `as many stitches by hand (${sys.seams.length}) as by name (${named.seams.length})`);
  // A mark on one edge only, not "to its mirror image", sews nothing.
  const h = garmentOf('skirt'); P(h, 'back').segs.forEach((s) => { if (s.name === 'centre') { s.name = ''; s.sew = 'cb'; } });
  const open = assemble(h, m, body, F);
  assert.ok(open.seams.length < named.seams.length - 20, `a lone mark leaves the edge open (${open.seams.length} vs ${named.seams.length})`);
});

test('a sewn-on piece cut twice goes on both sides; one that is sewn to nothing is left out', () => {
  const g = garmentOf('top', { sleeve: 'long' }), sleeve = P(g, 'sleeve');
  mark(sleeve, 'hem', 'cuff');
  g.pieces.push(strip('cuff', lenOf(sleeve, 'hem'), 6, 'cuff', { n: 2, mirror: true }), strip('loose', 20, 5, 'nothing'));
  const sys = assemble(g, m, body, F), cuffs = partsOf(sys, 'attach');
  assert.equal(cuffs.length, 2, 'two cuffs, and the piece sewn to nothing is not there');
  const cx = cuffs.map((I) => xs(sys, I).reduce((a, v) => a + v, 0) / I.pc.mesh.pts.length);
  assert.ok(cx[0] > 20 && cx[1] < -20, `one on each arm (${cx.map((v) => v.toFixed(0))})`);
  assert.ok(sys.x.every(Number.isFinite));
  const probe = [0, 0, 0, 0];
  for (const I of cuffs) for (let i = I.base; i < I.base + I.pc.mesh.pts.length; i++) { sample(F, sys.x[i * 3], sys.x[i * 3 + 1], sys.x[i * 3 + 2], probe); assert.ok(probe[0] > 0.3, 'cuffs start outside the arm'); }
});

test('a waistband of your own, sewn to the front and back waist, replaces the drawn-on one', () => {
  const g = garmentOf('skirt'), front = P(g, 'front'), back = P(g, 'back');
  assert.ok(assemble(g, m, body, F).bands.length === 1, 'drafted: the waistband is drawn on');
  mark(front, 'waist', 'wb'); mark(back, 'waist', 'wb');
  g.pieces.push(strip('band', m.waist + 2, 4, 'wb'));
  const sys = assemble(g, m, body, F), [W] = partsOf(sys, 'attach');
  assert.equal(sys.bands.length, 0, 'no drawn-on band');
  assert.ok(sys.pins.length > 20, 'the skirt is still held at the waist');
  assert.ok(Math.min(...ys(sys, W)) > body.landmarks.waist - 4, `the band sits at the waist and above (${Math.min(...ys(sys, W)).toFixed(0)}…${Math.max(...ys(sys, W)).toFixed(0)}, waist ${body.landmarks.waist.toFixed(0)})`);
});

// ---------- the marks themselves (what the Pattern editor's "Sew to another edge" does) ----------
const { sewEdges, sewTo, sewTwin, unsew, cleanSews, sewChecks } = await import('../src/js/sews.js');
const { splitSeg } = await import('../src/js/geom.js');
const own = (id, w, h, o = {}) => ({ ...rect(`own-${id}`, id, w, h), id, custom: true, ...o });

test('sewing edges by hand: marks are shared, one long edge takes several, and loose ends are unpicked', () => {
  const a = own('a', 30, 40), b = own('b', 30, 40), band = own('band', 60, 4, { role: 'attach' }), g = { pieces: [a, b, band] };
  sewTo(g, a, 1, b, 3);
  assert.ok(a.segs[1].sew && a.segs[1].sew === b.segs[3].sew, 'the two edges share a mark');
  sewTo(g, band, 0, a, 0); sewTo(g, band, 0, b, 0); // the band's long edge to both top edges, in turn
  const top = sewEdges(g).get(band.segs[0].sew);
  assert.deepEqual(top.map((e) => e.p.id).sort(), ['a', 'b', 'band'], 'one seam, three edges');
  const check = sewChecks(g).find((c) => c.label.includes('band'));
  assert.ok(check && check.a === 60 && check.b === 60 && check.ok, `the band is checked against both edges together (${check?.a} vs ${check?.b})`);
  // An edge with a point added along it is still one edge, and stays sewn.
  splitSeg(a, 1, 0.5);
  const side = sewEdges(g).get(b.segs[3].sew);
  assert.equal(side.length, 2); assert.equal(side.find((e) => e.p === a).segs.length, 2, 'both halves, one edge');
  // Taking a piece away unpicks what was sewn only to it.
  g.pieces = [a, band]; cleanSews(g);
  assert.ok(!a.segs[1].sew && !a.segs[2].sew, 'the side seam to the deleted piece is gone');
  assert.ok(a.segs[0].sew && a.segs[0].sew === band.segs[0].sew, 'the band is still sewn to what is left');
  unsew(g, band, 0);
  assert.ok(!a.segs[0].sew && !band.segs[0].sew, 'unsewing one side frees the other');
  // To its mirror image: a mark on one edge alone that is kept.
  sewTwin(g, a, 3); cleanSews(g);
  assert.ok(a.segs[3].sew && a.segs[3].twin);
  sewTo(g, a, 3, band, 2);
  assert.ok(!a.segs[3].twin && a.segs[3].sew === band.segs[2].sew, 'sewing it to something else replaces that');
});

test('a longer edge sewn to a shorter one is reported as gathering, not as a mistake', () => {
  const skirt = own('skirt', 50, 60), ruffle = own('ruffle', 80, 10, { role: 'attach' }), g = { pieces: [skirt, ruffle] };
  sewTo(g, ruffle, 0, skirt, 2);
  const [c] = sewChecks(g);
  assert.ok(c.free && !c.ok && Math.abs(c.diff) === 30, `ruffle 80 on hem 50 (${c.diff})`);
});

test('a dart added to a piece of your own is cut out and sewn shut in 3D', () => {
  const pieces = (dart) => ['skirt-front', 'skirt-back'].map((role, i) => ({ ...rect(`own-${i}`, 'Piece', 30, 50), id: `p${i}`, custom: true, role, cut: { n: 2, mirror: true },
    segs: ['waist', 'side', '', 'centre'].map((name) => ({ name, sa: 1.5 })), marks: dart && !i ? [{ type: 'dart', pts: [{ x: 13.75, y: 0 }, { x: 15, y: 9 }, { x: 16.25, y: 0 }] }] : [] }));
  const plain = assemble({ type: 'custom', options: {}, pieces: pieces(false) }, m, body, F), sys = assemble({ type: 'custom', options: {}, pieces: pieces(true) }, m, body, F);
  assert.equal(sys.lines.filter((l) => l.dart).length, 2, 'one dart on each front panel');
  assert.ok(sys.seams.length > plain.seams.length + 4, 'its legs are sewn together');
});

test('an edge sewn by hand to a piece that is not shown in 3D keeps its named seam', () => {
  const named = assemble(garmentOf('skirt'), m, body, F), g = garmentOf('skirt');
  mark(P(g, 'back'), 'side', 'x');
  const hidden = { ...rect('own-h', 'Hidden', 30, 12), id: 'h', custom: true, cut: { n: 2, mirror: true } }; // no "In 3D" role
  hidden.segs[0].sew = 'x'; g.pieces.push(hidden);
  assert.equal(assemble(g, m, body, F).seams.length, named.seams.length, 'the side seams are sewn as drafted');
});

// ---------- pockets (lying on a piece) and pleats ----------
const { meshPiece } = await import('../src/js/sim/mesh.js');

test('a pocket lies on the piece it is sewn onto: tied to its cloth, one each side when cut twice, and not cloth of its own', () => {
  const plain = assemble(garmentOf('skirt'), m, body, F), g = garmentOf('skirt');
  g.pieces.forEach((p, i) => { p.id = `d${i}`; });
  const front = P(g, 'front'), back = P(g, 'back');
  const pocket = (id, host, cut) => ({ ...rect(`own-${id}`, id, 14, 16), id, custom: true, role: 'patch', cut, on: { p: host.id, x: 8, y: 12 } });
  g.pieces.push(pocket('front pocket', front, { n: 2 }), pocket('back pocket', back, { n: 2 }), pocket('single', back, { n: 1 }), { ...pocket('nowhere', back, { n: 1 }), on: { p: 'gone', x: 0, y: 0 } });
  const sys = assemble(g, m, body, F), of = (name) => sys.patches.filter((pt) => pt.name === name);
  assert.equal(sys.N, plain.N, 'pockets add no cloth to the simulation');
  assert.deepEqual([of('front pocket').length, of('back pocket').length, of('single').length, of('nowhere').length], [2, 2, 1, 0], 'two, two, one, and none for a pocket whose piece is gone');
  // where each copy sits: the weighted spot of its points on the host's cloth
  const centre = (pt) => { let cx = 0, cy = 0; const n = pt.pts.length; for (let i = 0; i < n * 3; i++) { cx += sys.x[pt.bind[i] * 3] * pt.w[i]; cy += sys.x[pt.bind[i] * 3 + 1] * pt.w[i]; } return [cx / n, cy / n]; };
  for (const name of ['front pocket', 'back pocket']) {
    const [a, b] = of(name).map(centre);
    assert.ok(a[0] * b[0] < 0 && Math.abs(a[0] + b[0]) < 2 && Math.abs(a[1] - b[1]) < 1, `${name}: one each side, level (${a.map((v) => v.toFixed(0))} and ${b.map((v) => v.toFixed(0))})`);
  }
  for (const pt of sys.patches) {
    const I = sys.inst[pt.inst], n = pt.pts.length;
    assert.ok(pt.bind.every((v) => v >= I.base && v < I.base + I.pc.mesh.pts.length), 'tied to points of its host');
    for (let i = 0; i < n; i++) { const s = pt.w[i * 3] + pt.w[i * 3 + 1] + pt.w[i * 3 + 2]; assert.ok(Math.abs(s - 1) < 1e-4 && Math.min(pt.w[i * 3], pt.w[i * 3 + 1], pt.w[i * 3 + 2]) > -0.01, 'each point lies in a triangle of the host'); }
  }
  // It sits where it was put: 8 cm in and 12 cm down from the front's top-left corner, so below the waist by about that.
  const y = Math.max(...of('front pocket').map((pt) => centre(pt)[1]));
  assert.ok(y < body.landmarks.waist - 10 && y > body.landmarks.waist - 35, `the front pocket is on the hip (${y.toFixed(0)}, waist ${body.landmarks.waist.toFixed(0)})`);
});

test('a pleat brings two points of an edge together: the cloth stays, the edge sews up shorter', () => {
  const flat = rect('p', 'Piece', 40, 30), pleated = { ...rect('p', 'Piece', 40, 30), marks: [{ type: 'pleat', pts: [{ x: 16, y: 0 }, { x: 22, y: 0 }] }] };
  const A = meshPiece(flat, 2), B = meshPiece(pleated, 2), top = (M) => M.runs[0].idx.map((v) => M.pts[v].x);
  assert.equal(B.tucks.length, 1);
  // the fold lies flat: each edge point inside the pleat is stitched to the edge just beyond its first end (x < 16)
  assert.ok(B.tucks[0].ties.length >= 1 && B.tucks[0].ties.every(([i, j0, j1, t]) => B.pts[i].x > 16 && B.pts[i].x < 22 && B.pts[j0].x <= 16.01 && B.pts[j1].x <= 16.01 && B.pts[j0].x >= 12.9 && t >= 0 && t <= 1), JSON.stringify(B.tucks[0].ties.map(([i, j0, j1, t]) => [B.pts[i].x, B.pts[j0].x, B.pts[j1].x, t])));
  assert.ok(Math.abs(Math.abs(B.area) - Math.abs(A.area)) < 1e-6 && B.tris.length >= A.tris.length - 4, 'no cloth is cut away');
  assert.ok(top(B).includes(16) && top(B).includes(22) && !top(B).some((x) => x > 16.01 && x < 21.99), `the edge skips from one end of the pleat to the other (${top(B).map((x) => x.toFixed(0))})`);
  // In a skirt of your own: the waist edge is sewn and held 6 cm shorter per pleat, and the two ends are stitched together.
  const pieces = (pleat) => ['skirt-front', 'skirt-back'].map((role, i) => ({ ...rect(`own-${i}`, 'Piece', 30, 50), id: `p${i}`, custom: true, role, cut: { n: 2, mirror: true },
    segs: ['waist', 'side', '', 'centre'].map((name) => ({ name, sa: 1.5 })), marks: pleat && !i ? [{ type: 'pleat', pts: [{ x: 12, y: 0 }, { x: 18, y: 0 }] }] : [] }));
  const plain = assemble({ type: 'custom', options: {}, pieces: pieces(false) }, m, body, F), sys = assemble({ type: 'custom', options: {}, pieces: pieces(true) }, m, body, F);
  const stitched = sys.seams.filter(([i, j0, j1]) => j0 === j1 && sys.inst.some((I) => I.pc.mesh.tucks.some(({ a, b }) => (I.base + a === Math.min(i, j0) && I.base + b === Math.max(i, j0)) || (I.base + b === Math.min(i, j0) && I.base + a === Math.max(i, j0)))));
  assert.equal(stitched.length, 2, 'one pleat on each front panel, its ends stitched together');
  assert.ok(sys.pins.length < plain.pins.length, 'the folded cloth is not held at the waist');
  const g = { pieces: pieces(true) }; g.pieces[0].segs[0].sew = g.pieces[1].segs[0].sew = 'w';
  assert.equal(sewChecks(g)[0].a, 48, 'the seam check measures the edge less its pleat (30 − 6 cm, cut twice)');
});
