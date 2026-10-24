import test from 'node:test';
import assert from 'node:assert/strict';
import { instances, pack, lengthOf, toBuy } from '../src/js/layout.js';
import { TYPES, normalize } from '../src/js/garments/index.js';
import { defaults } from '../src/js/measure-data.js';
import { rect } from '../src/js/garments/common.js';
import { rotate90 } from '../src/js/geom.js';

const m = defaults();
const draft = (type, o = {}) => { const T = TYPES[type]; return T.draft(m, normalize(T, { ...o }, m)).pieces.map((p, i) => ({ ...p, id: `p${i}` })); };

test('instance counts: folded fabric cuts pairs at once, open fabric cuts each piece', () => {
  const ps = draft('skirt', { style: 'straight', waist: 'band', pockets: 'none', zip: 'back' }); // front on fold ×1, back ×2, band ×1
  assert.equal(instances(ps, { folded: true }).length, 3);
  assert.equal(instances(ps, { folded: false }).length, 4);
});

test('grain runs along the fabric length even for sideways pieces', () => {
  const band = { ...rect('b', 'Band', 80, 8, { horizontalGrain: true }), id: 'b', cut: { n: 1 } };
  const [i] = instances([band], { folded: false });
  assert.ok(Math.abs(i.h - 83) < 0.01 && Math.abs(i.w - 11) < 0.01, `${i.w}×${i.h}`);
  const turned = { ...rect('c', 'C', 10, 30), id: 'c', cut: { n: 1 } }; rotate90(turned);
  const [j] = instances([turned], { folded: false });
  assert.ok(j.h > j.w, 'rotated piece is turned back to follow the grain');
});

test('packing keeps pieces inside the width without overlaps; fold pieces touch the fold', () => {
  for (const [type, o] of [['skirt', {}], ['trousers', {}], ['dress', {}], ['jeans', {}]]) for (const folded of [true, false]) {
    const width = folded ? 75 : 150, placed = pack(instances(draft(type, o), { folded }), width);
    for (const a of placed) {
      if (!a.tooWide) assert.ok(a.x >= -1e-6 && a.x + a.w <= width + 1e-6, `${type} ${a.name} out of width`);
      if (a.onFold) assert.equal(a.x, 0);
      for (const b of placed) if (a !== b) assert.ok(a.x >= b.x + b.w - 1e-6 || b.x >= a.x + a.w - 1e-6 || a.y >= b.y + b.h - 1e-6 || b.y >= a.y + a.h - 1e-6, `${type}: ${a.name} overlaps ${b.name}`);
    }
    assert.ok(lengthOf(placed) > 30);
  }
});

test('shop length rounds up with 10% extra', () => {
  assert.equal(toBuy(100, true), 110);
  assert.equal(toBuy(101, true), 120);
  assert.ok(Math.abs(toBuy(91.44, false) / 22.86 - 5) < 1e-9); // 1 yd → 1.25 yd
});
