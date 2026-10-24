import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBody } from '../src/js/sim/body.js';
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
