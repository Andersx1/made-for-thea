import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBody, BUST } from '../src/js/sim/body.js';
import { defaults } from '../src/js/measure-data.js';

const height = (pos) => { let lo = Infinity, hi = -Infinity; for (let i = 1; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); } return hi - lo; };
const check = (m) => {
  const b = makeBody(m);
  const got = { height: height(b.pos), bust: b.measure('bust-circ'), waist: b.measure('waist-circ'), hip: b.measure('hips-circ'), thigh: b.measure('thigh-circ'), neck: b.measure('neck-circ') };
  for (const k of Object.keys(got)) assert.ok(Math.abs(got[k] - m[k]) < (k === 'height' ? 1.5 : 2), `${k}: body ${got[k].toFixed(1)} vs measurement ${m[k]}`);
  assert.ok(b.landmarks.bust > b.landmarks.waist && b.landmarks.waist > b.landmarks.hip && b.landmarks.hip > b.landmarks.knee, 'body levels in order');
  return b;
};

test('the body matches an average measurement profile', () => { check(defaults()); });
test('the body follows other figures: curvy, slim and tall', () => {
  check({ ...defaults(), bust: 104, underbust: 84, waist: 82, hip: 114, thigh: 66 });
  check({ ...defaults(), bust: 82, underbust: 70, waist: 64, hip: 88, thigh: 50, height: 158 });
  check({ ...defaults(), height: 178, hip: 100, bust: 92 });
});
test('the bust follows its spread and height, and the bust choices keep the bust measurement', () => {
  for (const [bustSpan, shoulderToBust] of [[17, 24.5], [19.5, 26]]) {
    const b = makeBody({ ...defaults(), bustSpan, shoulderToBust });
    assert.ok(Math.abs(b.span - bustSpan) < 1, `spread ${b.span.toFixed(1)} vs ${bustSpan}`);
    assert.ok(Math.abs(b.toBust - shoulderToBust) < 1, `shoulder to bust ${b.toBust.toFixed(1)} vs ${shoulderToBust}`);
  }
  for (const [key, , ch] of BUST) for (const [v] of ch) check({ ...defaults(), bust3d: { mode: 'simple', [key]: v } });
  const at = (bust3d) => makeBody({ ...defaults(), bust3d: { mode: 'simple', ...bust3d } });
  assert.ok(at({ set: 'wide' }).span > at({ set: 'close' }).span + 2, 'wide set is wider apart than close set');
  assert.ok(at({ height: 'low' }).toBust > at({ height: 'high' }).toBust + 1, 'low set sits lower than high set');
});
