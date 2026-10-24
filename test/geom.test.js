import test from 'node:test';
import assert from 'node:assert/strict';
import { path, offsetOutline, signedArea, segLen, splitSeg, deleteNode, outline } from '../src/js/geom.js';
import { setMetric, parseLen, fmt } from '../src/js/units.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const rectP = (sa) => path(0, 0).L(10, 0, sa[0]).L(10, 20, sa[1]).L(0, 20, sa[2]).Z(sa[3]);

test('seam allowance pushes every edge out by its own width', () => {
  near(Math.abs(signedArea(offsetOutline(rectP([1, 1, 1, 1])))), 12 * 22);
  near(Math.abs(signedArea(offsetOutline(rectP([1, 1, 3, 0])))), 11 * 24); // hem 3, fold edge 0
});

test('seam allowance is outward whichever way the outline was drawn', () => {
  const ccw = path(0, 0).L(0, 20, 1).L(10, 20, 1).L(10, 0, 1).Z(1);
  near(Math.abs(signedArea(offsetOutline(ccw))), 12 * 22);
});

test('arcs: a full circle has circumference 2πr', () => {
  const c = path(10, 0).A({ x: 0, y: 0 }, 10, 0, Math.PI * 2, 1).Z(1);
  assert.equal(c.nodes.length, 4);
  near(c.segs.reduce((a, s, i) => a + segLen(c, i), 0), 2 * Math.PI * 10, 0.01);
});

test('splitting a curve keeps its length; deleting the point rejoins it', () => {
  const p = path(0, 0).C({ x: 5, y: -8 }, { x: 15, y: 8 }, { x: 20, y: 0 }, 1).L(20, 10, 1).Z(1);
  const before = segLen(p, 0);
  splitSeg(p, 0, 0.3);
  near(segLen(p, 0) + segLen(p, 1), before, 0.01);
  assert.ok(deleteNode(p, 1));
  assert.equal(p.nodes.length, 3);
  assert.equal(outline(p).length > 3, true);
});

test('units: parse and format cm and inches', () => {
  setMetric(true);
  near(parseLen('80'), 80); near(parseLen('1.2 m'), 120); near(parseLen('3/8"'), 2.54 * 0.375);
  assert.equal(fmt(80.04), '80 cm');
  setMetric(false);
  near(parseLen('12 3/8'), 12.375 * 2.54); near(parseLen('12⅜'), 12.375 * 2.54); near(parseLen('30 cm'), 30);
  assert.equal(fmt(12.375 * 2.54), '12 ⅜"');
  assert.equal(fmt(0.5 * 2.54), '½"');
  assert.ok(Number.isNaN(parseLen('abc')));
  setMetric(true);
});
