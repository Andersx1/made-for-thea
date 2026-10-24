import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, normalize, optionChoices } from '../src/js/garments/index.js';
import { seamChecks } from '../src/js/seamcheck.js';
import { defaults } from '../src/js/measure-data.js';

const m = defaults();
test('freshly drafted patterns pass every seam check (all option values)', () => {
  for (const [id, T] of Object.entries(TYPES)) {
    const variants = [{}];
    for (const op of T.options) { const ch = optionChoices(op, normalize(T, {}, m)); if (ch) for (const [v] of ch) variants.push({ [op.key]: v }); }
    for (const v of variants) {
      const options = normalize(T, { ...v }, m), g = { type: id, options, pieces: T.draft(m, options).pieces };
      for (const c of seamChecks(g, m)) assert.ok(c.ok, `${id} ${JSON.stringify(v)}: ${c.label} off by ${c.diff.toFixed(2)} (allowed ${c.lo}..${c.hi})`);
    }
  }
});

test('princess seams: every length, fit and neckline sews together', async () => {
  const { outline } = await import('../src/js/geom.js');
  for (const id of ['top', 'dress']) for (const length of ['crop', 'waist', 'hip', 'tunic']) for (const fit of ['fitted', 'regular']) for (const neckline of ['round', 'v', 'sweetheart']) for (const closure of ['backzip', 'buttons']) {
    const T = TYPES[id], options = normalize(T, { shaping: 'princess', length, fit, neckline, closure }, m), pieces = T.draft(m, options).pieces;
    assert.ok(pieces.some((p) => p.key === 'sidefront') && pieces.some((p) => p.key === 'sideback'), `${id}: side panels missing`);
    for (const c of seamChecks({ type: id, options, pieces }, m)) assert.ok(c.ok, `${id} ${length} ${fit} ${neckline} ${closure}: ${c.label} off by ${c.diff.toFixed(2)}`);
    for (const p of pieces) assert.ok(outline(p).every((q) => isFinite(q.x) && isFinite(q.y)), `${id} ${p.key}`);
  }
});

test('denim jacket: every fit, length and shoulder sews together', () => {
  const T = TYPES.jacket;
  for (const fit of ['fitted', 'regular', 'oversized']) for (const length of ['cropped', 'regular', 'long']) for (const shoulder of ['setin', 'dropped']) {
    const options = normalize(T, { fit, length, shoulder }, m), pieces = T.draft(m, options).pieces;
    for (const c of seamChecks({ type: 'jacket', options, pieces }, m)) assert.ok(c.ok, `${fit} ${length} ${shoulder}: ${c.label} off by ${c.diff.toFixed(2)}`);
    assert.ok(T.steps(m, options).steps.length > 12);
  }
});
