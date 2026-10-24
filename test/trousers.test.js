import test from 'node:test';
import assert from 'node:assert/strict';
import { trousers, jeans, legFrame } from '../src/js/garments/trousers.js';
import { normalize } from '../src/js/garments/index.js';
import { defaults } from '../src/js/measure-data.js';
import { segLen, offsetOutline, dist } from '../src/js/geom.js';

const m = defaults();
const opts = (T, o) => normalize(T, { ...o }, m);
const by = (ps, k) => ps.find((p) => p.key === k);
const named = (p, n) => (p ? p.segs.reduce((a, s, i) => a + (s.name === n ? segLen(p, i) : 0), 0) : 0);
const darts = (p) => (p ? p.marks.filter((mk) => mk.type === 'dart').reduce((a, mk) => a + dist(mk.pts[0], mk.pts[2]), 0) : 0);

const cases = [
  [trousers, { pockets: 'slant' }], [trousers, { pockets: 'inseam', leg: 'wide' }], [trousers, { pockets: 'none', length: 'shorts' }],
  [trousers, { waist: 'elastic', leg: 'slim', rise: 'mid' }], [jeans, {}], [jeans, { leg: 'bootcut', rise: 'low', stretch: '0', fit: 'regular' }],
];

test('outseams: front (+ pocket facing) matches back (+ yoke)', () => {
  for (const [T, o] of cases) {
    const ps = T.draft(m, opts(T, o)).pieces;
    const front = named(by(ps, 'front'), 'side') + named(by(ps, 'facing'), 'side'), back = named(by(ps, 'back'), 'side') + named(by(ps, 'yoke'), 'side');
    assert.ok(Math.abs(front - back) < 1, `${T.id} ${JSON.stringify(o)}: front ${front.toFixed(1)} back ${back.toFixed(1)}`);
  }
});

test('inseams: the back is the same or up to 1.5 cm shorter (eased in)', () => {
  for (const [T, o] of cases) {
    const ps = T.draft(m, opts(T, o)).pieces, d = named(by(ps, 'front'), 'inseam') - named(by(ps, 'back'), 'inseam');
    assert.ok(d > -0.3 && d < 1.5, `${T.id} ${JSON.stringify(o)}: ${d}`);
  }
});

test('sewn waist = waist (at that rise) + ease', () => {
  for (const [T, o] of cases) {
    const oo = opts(T, o), ps = T.draft(m, oo).pieces, L = legFrame(m, { ...oo, jeans: T === jeans });
    if (oo.waist === 'elastic') continue;
    const sewn = 2 * (named(by(ps, 'front'), 'waist') - darts(by(ps, 'front')) + named(by(ps, 'facing'), 'waist') + named(by(ps, 'back'), 'waist') - darts(by(ps, 'back')) + named(by(ps, 'yoke'), 'waist'));
    const flyExtra = 2 * 3.5; // the fly extensions are part of the front waist edge
    assert.ok(Math.abs(sewn - flyExtra - L.Wa) < 3, `${T.id} ${JSON.stringify(o)}: sewn ${sewn.toFixed(1)} want ${L.Wa.toFixed(1)}`);
  }
});

test('jeans yoke: the yoke seam is the same length on the yoke and the back', () => {
  const ps = jeans.draft(m, opts(jeans, {})).pieces;
  const d = named(by(ps, 'yoke'), 'yoke') - named(by(ps, 'back'), 'yoke');
  assert.ok(Math.abs(d) < 0.5, `${d}`);
});

test('crotch seam is close to the body measurement (no warning for average sizes)', () => {
  for (const [T, o] of cases) assert.ok(!T.draft(m, opts(T, o)).warnings.some((w) => w.includes('crotch seam')), `${T.id} ${JSON.stringify(o)}`);
});

test('every combination drafts valid pieces', () => {
  for (const T of [trousers, jeans]) for (const leg of ['skinny', 'slim', 'straight', 'bootcut', 'wide', 'flared']) for (const length of ['full', 'ankle', 'capri', 'bermuda', 'shorts'])
    for (const rise of ['high', 'mid', 'low']) for (const extra of [{}, { waist: 'elastic', pockets: 'inseam', backPockets: 'patch', fit: 'relaxed', stretch: '5' }]) {
      const o = opts(T, { leg, length, rise, ...extra }), { pieces } = T.draft(m, o);
      for (const p of pieces) {
        assert.equal(p.nodes.length, p.segs.length, `${T.id} ${p.key}`);
        assert.ok(offsetOutline(p).every((q) => isFinite(q.x) && isFinite(q.y)), `${T.id} ${leg} ${length} ${p.key}`);
      }
      assert.ok(T.steps(m, o).steps.length > 8);
    }
});

test('the fly ends above the crotch curve for every rise (outline never doubles back)', () => {
  for (const T of [trousers, jeans]) for (const rise of ['high', 'mid', 'low']) {
    const f = T.draft(m, opts(T, { rise })).pieces.find((p) => p.key === 'front'), i = f.segs.findIndex((s) => s.name === 'centre');
    assert.ok(f.nodes[(i + 1) % f.nodes.length].y > f.nodes[i].y, `${T.id} ${rise}: centre front runs upward`);
  }
});
