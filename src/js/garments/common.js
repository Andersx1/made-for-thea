// Shared building blocks for drafted pieces.
import { path, bbox } from '../geom.js';

// piece(key, name, {nodes, segs}, {cut, grain, marks, notches})
// key is stable per garment so regenerating can keep the user's edited pieces.
export function piece(key, name, shape, { cut = { n: 1 }, grain, marks = [], notches = [] } = {}) {
  const b = bbox(shape.nodes);
  return {
    key, name, nodes: shape.nodes, segs: shape.segs, cut, marks, notches,
    grain: grain || { a: { x: b.x + b.w / 2, y: b.y + b.h * 0.2 }, b: { x: b.x + b.w / 2, y: b.y + b.h * 0.8 } },
  };
}

// Rectangle with per-edge seam allowance (top, right, bottom, left).
export function rect(key, name, w, h, { sa = [1.5, 1.5, 1.5, 1.5], horizontalGrain = false, ...o } = {}) {
  const shape = path(0, 0).L(w, 0, sa[0]).L(w, h, sa[1]).L(0, h, sa[2]).Z(sa[3]);
  if (horizontalGrain) o.grain = { a: { x: w * 0.2, y: h / 2 }, b: { x: w * 0.8, y: h / 2 } };
  return piece(key, name, shape, o);
}

// Rectangle with rounded bottom corners (patch pockets).
export function roundedRect(key, name, w, h, r, { saTop = 3, sa = 1, ...o } = {}) {
  const shape = path(0, 0).L(w, 0, saTop).L(w, h - r, sa).A({ x: w - r, y: h - r }, r, 0, Math.PI / 2, sa)
    .L(r, h, sa).A({ x: r, y: h - r }, r, Math.PI / 2, Math.PI, sa).Z(sa);
  return piece(key, name, shape, o);
}

// Straight waistband: folded in half lengthwise. Length includes the button overlap.
export function waistband(length, width, name = 'Waistband') {
  return rect('waistband', name, length, width * 2, {
    horizontalGrain: true,
    marks: [{ type: 'dash', pts: [{ x: 0, y: width }, { x: length, y: width }] }, { type: 'text', pts: [{ x: length / 2, y: width * 0.55 }], text: 'fold · interface' }],
    notches: [{ x: length / 2, y: 0 }],
  });
}

// In-seam pocket bag: the straight left edge sews to the side seam between the notches.
export function inseamPocket() {
  const shape = path(0, -2).L(8, -2, 1).C({ x: 14, y: -2 }, { x: 18, y: 6 }, { x: 18, y: 14 }, 1)
    .C({ x: 18, y: 24 }, { x: 11, y: 28 }, { x: 5, y: 27 }, 1).C({ x: 2, y: 26 }, { x: 0, y: 23 }, { x: 0, y: 20 }, 1).Z(1.5);
  return piece('pocket', 'Pocket bag', shape, { cut: { n: 4, mirror: true }, notches: [{ x: 0, y: 1 }, { x: 0, y: 17 }] });
}
export const patchPocket = (w = 16, h = 18) => roundedRect('patchpocket', 'Patch pocket', w, h, 3, { cut: { n: 2 } });

export const fold = { fold: true, name: 'fold' };
