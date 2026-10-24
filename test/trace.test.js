import test from 'node:test';
import assert from 'node:assert/strict';
import { homography, applyH, toCm, traceShape } from '../src/js/trace-geom.js';
import { offsetOutline, signedArea } from '../src/js/geom.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('homography maps the four corners exactly and straightens a tilted photo', () => {
  const photo = [{ x: 120, y: 80 }, { x: 900, y: 140 }, { x: 860, y: 1180 }, { x: 60, y: 1100 }]; // A4 sheet seen at an angle
  const H = homography(photo, [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 29.7 }, { x: 0, y: 29.7 }]);
  const back = photo.map((p) => applyH(H, p));
  near(back[1].x, 21); near(back[2].y, 29.7); near(back[3].x, 0); near(back[0].y, 0);
  // the middle of the sheet in the photo maps to the middle of the sheet
  const Hinv = homography([{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 29.7 }, { x: 0, y: 29.7 }], photo);
  const mid = applyH(H, applyH(Hinv, { x: 10.5, y: 14.85 }));
  near(mid.x, 10.5, 1e-6); near(mid.y, 14.85, 1e-6);
  assert.equal(homography([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 5 }], photo), null);
});

test('two-point scale calibration', () => {
  const f = toCm({ mode: 'scale', a: { x: 0, y: 0 }, b: { x: 300, y: 400 }, real: 25 }); // 500 px = 25 cm
  near(f({ x: 100, y: 0 }).x, 5);
  assert.equal(toCm({ mode: 'scale', a: { x: 0, y: 0 } }), null);
});

test('traced shapes: corners stay sharp, a traced 20×10 rectangle offsets correctly', () => {
  const rect = [{ x: 0, y: 0, corner: true }, { x: 20, y: 0, corner: true }, { x: 20, y: 10, corner: true }, { x: 0, y: 10, corner: true }];
  const s = traceShape(rect, { smooth: true, sa: 1 });
  assert.ok(s.segs.every((x) => !x.c1));
  near(Math.abs(signedArea(offsetOutline(s))), 22 * 12);
  const round = traceShape([{ x: 10, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 10 }], { smooth: true });
  assert.ok(round.segs.every((x) => x.c1));
});
