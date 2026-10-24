// No drafted piece should have a stitching line that crosses itself, for any garment and option.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, normalize, optionChoices } from '../src/js/garments/index.js';
import { defaults } from '../src/js/measure-data.js';
import { outline } from '../src/js/geom.js';

const m = defaults();
const cross = (a, b, c, d) => { const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
function selfCrossing(p) {
  const pts = outline(p, 12), n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (cross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
}

test('stitching lines never cross themselves (every option value of every garment)', () => {
  for (const [id, T] of Object.entries(TYPES)) {
    const variants = [{}];
    for (const op of T.options) {
      const ch = optionChoices(op, normalize(T, {}, m));
      if (ch) for (const [v] of ch) variants.push({ [op.key]: v });
    }
    for (const v of variants) {
      const o = normalize(T, { ...v }, m);
      for (const p of T.draft(m, o).pieces) assert.ok(!selfCrossing(p), `${id} ${JSON.stringify(v)}: "${p.name}" crosses itself`);
    }
  }
});
