import test from 'node:test';
import assert from 'node:assert/strict';
import { top, dress } from '../src/js/garments/top.js';
import { frame, armholeLen } from '../src/js/garments/bodice.js';
import { normalize } from '../src/js/garments/index.js';
import { defaults } from '../src/js/measure-data.js';
import { segLen, offsetOutline, dist } from '../src/js/geom.js';

const m = defaults();
const opts = (T, o) => normalize(T, { ...o }, m);
const byKey = (ps, k) => ps.find((p) => p.key === k);
const named = (p, n) => p.segs.reduce((a, s, i) => a + (s.name === n ? segLen(p, i) : 0), 0);
const dartIntakeOnSide = (front) => dist(front.marks[0].pts[0], front.marks[0].pts[2]); // bust dart is the front's first mark

test('bodice bust circumference = bust + ease', () => {
  for (const [fit, ease] of [['fitted', 6], ['regular', 10], ['relaxed', 16]]) {
    const F = frame(m, { fit });
    assert.ok(Math.abs(2 * (F.fw + F.bw) - (m.bust + ease)) < 1e-9, fit);
  }
});

test('shoulder seams: back is 0.5 cm longer (eased) for every neckline', () => {
  for (const neckline of ['round', 'scoop', 'v', 'square', 'sweetheart', 'boat']) {
    const ps = top.draft(m, opts(top, { neckline })).pieces;
    const f = named(byKey(ps, 'front'), 'shoulder'), b = named(byKey(ps, 'back'), 'shoulder');
    assert.ok(Math.abs(b - f - 0.5) < 0.05, `${neckline}: back ${b} front ${f}`);
  }
});

test('side seams match once the bust dart is closed', () => {
  for (const length of ['crop', 'waist', 'hip', 'tunic']) {
    const ps = top.draft(m, opts(top, { length })).pieces, f = byKey(ps, 'front'), b = byKey(ps, 'back');
    const diff = named(f, 'side') - dartIntakeOnSide(f) - named(b, 'side');
    assert.ok(Math.abs(diff) < 0.6, `${length}: ${diff}`);
  }
});

test('sleeve cap is 1.5–4 cm bigger than the armhole (ease)', () => {
  for (const sleeve of ['cap', 'short', 'elbow', 'threequarter', 'long']) for (const fit of ['fitted', 'regular', 'relaxed']) {
    const ps = top.draft(m, opts(top, { sleeve, fit })).pieces;
    const ease = named(byKey(ps, 'sleeve'), 'cap') - armholeLen(ps);
    assert.ok(ease > 1.5 && ease < 4, `${sleeve}/${fit}: ${ease}`);
  }
});

test('dress: bodice waist seam matches the skirt waist seam', () => {
  for (const skirtStyle of ['aline', 'straight']) {
    const ps = dress.draft(m, opts(dress, { skirtStyle, closure: 'backzip' })).pieces;
    const sum = (k, seg) => { const p = byKey(ps, k), d = p.marks.filter((mk) => mk.type === 'dart' && mk.pts.length === 3 && Math.abs(mk.pts[0].y - mk.pts[2].y) < 1.5).reduce((a, mk) => a + dist(mk.pts[0], mk.pts[2]), 0); return named(p, seg) - d; };
    const bodice = 2 * sum('front', 'hem') + 2 * sum('back', 'hem'), skirtW = 2 * sum('skirtfront', 'waist') + 2 * sum('skirtback', 'waist');
    assert.ok(Math.abs(bodice - skirtW) < 2, `${skirtStyle}: bodice ${bodice} skirt ${skirtW}`);
  }
});

test('every combination drafts closed pieces with valid cutting lines', () => {
  const combos = [];
  for (const neckline of ['round', 'scoop', 'v', 'square', 'sweetheart', 'boat', 'strappy'])
    for (const sleeve of ['none', 'short', 'puff', 'flutter', 'long'])
      for (const closure of ['backzip', 'buttons', 'none']) combos.push({ neckline, sleeve, closure });
  for (const T of [top, dress]) for (const c of combos) for (const extra of [{}, { back: 'shirred', straps: 'ties', neckFinish: 'binding', skirtStyle: 'circle', length: 'tunic' }]) {
    const o = opts(T, { ...c, ...extra }), { pieces } = T.draft(m, o);
    for (const p of pieces) {
      assert.equal(p.nodes.length, p.segs.length, `${T.id} ${JSON.stringify(c)} ${p.key}`);
      assert.ok(offsetOutline(p).every((q) => isFinite(q.x) && isFinite(q.y)), `${T.id} ${p.key}`);
    }
    assert.ok(T.steps(m, o).steps.length > 6);
  }
});
