import test from 'node:test';
import assert from 'node:assert/strict';
import skirt from '../src/js/garments/skirt.js';
import shapes from '../src/js/garments/shapes.js';
import { defaults } from '../src/js/measure-data.js';
import { segLen, offsetOutline, dist } from '../src/js/geom.js';
import { normalize } from '../src/js/garments/index.js';

const m = defaults();
const opts = (o) => normalize(skirt, { ...o }, m);
const byKey = (ps, k) => ps.find((p) => p.key === k);
const waistLen = (p) => p.segs.reduce((a, s, i) => a + (s.name === 'waist' ? segLen(p, i) : 0), 0);
const dartSum = (p) => p.marks.filter((mk) => mk.type === 'dart').reduce((a, mk) => a + dist(mk.pts[0], mk.pts[2]), 0);

for (const style of ['straight', 'pencil', 'aline']) {
  test(`${style} skirt: sewn waist = waist + ease, hip = hip + ease`, () => {
    const { pieces } = skirt.draft(m, opts({ style, fit: 'regular' }));
    const f = byKey(pieces, 'front'), b = byKey(pieces, 'back');
    const sewnWaist = 2 * (waistLen(f) - dartSum(f)) + 2 * (waistLen(b) - dartSum(b));
    assert.ok(Math.abs(sewnWaist - (m.waist + 1)) < 1.2, `waist ${sewnWaist}`);
    if (style !== 'aline') assert.ok(Math.abs(2 * (f.nodes[2].x + b.nodes[2].x) - (m.hip + 4)) < 0.01);
  });
}

test('A-line hem is wider than the straight skirt hem', () => {
  const hem = (style) => { const f = byKey(skirt.draft(m, opts({ style })).pieces, 'front'); return f.nodes[3].x; };
  assert.ok(hem('aline') > hem('straight') + 3);
});

test('circle skirt waist opening matches the waist for full, half and quarter circles', () => {
  for (const c of ['1', '0.5', '0.25']) {
    const p = skirt.draft(m, opts({ style: 'circle', circle: c })).pieces[0];
    assert.ok(Math.abs(waistLen(p) * p.cut.n - (m.waist + 1)) < 0.1, `circle ${c}`);
  }
});

test('every style and finish drafts closed pieces with a valid cutting line', () => {
  for (const style of ['straight', 'pencil', 'aline', 'circle', 'gathered', 'wrap'])
    for (const waist of ['band', 'facing', 'elastic'])
      for (const pockets of ['none', 'inseam', 'patch']) {
        const o = opts({ style, waist, pockets });
        const { pieces } = skirt.draft(m, o);
        assert.ok(pieces.length >= 1);
        for (const p of pieces) {
          assert.equal(p.nodes.length, p.segs.length, `${style}/${p.key}`);
          assert.ok(offsetOutline(p).every((q) => isFinite(q.x) && isFinite(q.y)), `${style}/${p.key}`);
        }
        const st = skirt.steps(m, o);
        assert.ok(st.steps.length > 4);
      }
});

test('simple shapes all draft', () => {
  for (const kind of ['tote', 'apron', 'scrunchie', 'pillow', 'rect', 'circle']) {
    const o = normalize(shapes, { kind }, m);
    assert.ok(shapes.draft(m, o).pieces.length >= 1, kind);
  }
});
