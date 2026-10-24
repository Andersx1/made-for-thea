// Simple shapes that don't need body measurements.
import { path } from '../geom.js';
import { piece, rect, patchPocket, fold } from './common.js';

const len = (key, label, def, show) => ({ key, label, type: 'len', def: () => def, show });
const is = (...k) => (o) => k.includes(o.kind);

export default {
  id: 'shape', name: 'Simple shapes', icon: '◻️', blurb: 'Tote bags, aprons, scrunchies, cushion covers, or any rectangle/circle you type in.',
  needs: [],
  title: (o) => ({ tote: 'Tote bag', apron: 'Apron', scrunchie: 'Scrunchie', pillow: 'Cushion cover', rect: 'Rectangle', circle: 'Circle' }[o.kind]),
  options: [
    { key: 'kind', label: 'Make', type: 'select', def: 'tote', choices: [['tote', 'Tote bag'], ['apron', 'Apron'], ['scrunchie', 'Scrunchie'], ['pillow', 'Cushion cover'], ['rect', 'Rectangle'], ['circle', 'Circle']] },
    len('w', 'Width', 38, is('tote', 'rect', 'apron')),
    len('h', 'Height', 42, is('tote', 'rect')),
    len('depth', 'Bag depth (boxed corners)', 10, is('tote')),
    len('strap', 'Strap length', 60, is('tote')),
    { key: 'lined', label: 'Lined', type: 'check', def: true, show: is('tote') },
    len('apronLen', 'Apron length', 85, is('apron')),
    len('bib', 'Bib width', 26, is('apron')),
    len('d', 'Diameter', 30, is('circle')),
    len('size', 'Cushion size', 45, is('pillow')),
    { key: 'n', label: 'How many to cut', type: 'num', def: 1, show: is('rect', 'circle') },
    len('sa', 'Seam allowance', 1.5, is('rect', 'circle')),
  ],
  draft(m, o) {
    const pieces = [];
    if (o.kind === 'rect') pieces.push(rect('rect', 'Rectangle', o.w, o.h, { sa: Array(4).fill(o.sa), cut: { n: +o.n } }));
    if (o.kind === 'circle') {
      const r = o.d / 2;
      pieces.push(piece('circle', 'Circle', path(r, 0).A({ x: 0, y: 0 }, r, 0, Math.PI * 2, o.sa).Z(o.sa), { cut: { n: +o.n } }));
    }
    if (o.kind === 'tote') {
      // Cut size = finished width + depth, finished height + depth/2, with depth/2 squares cut from the bottom corners.
      const W = o.w + o.depth, H = o.h + o.depth / 2, c = o.depth / 2, top = o.lined ? 1 : 3;
      const body = () => path(0, 0).L(W, 0, top).L(W, H - c, 1).L(W - c, H - c, 1).L(W - c, H, 1).L(c, H, 1).L(c, H - c, 1).L(0, H - c, 1).Z(1);
      pieces.push(piece('outer', 'Bag outer', body(), { cut: { n: 2 } }));
      if (o.lined) pieces.push(piece('lining', 'Bag lining', body(), { cut: { n: 2 } }));
      pieces.push(rect('strap', 'Strap', 12, o.strap, { sa: [1, 0, 1, 0], cut: { n: 2 }, marks: [3, 6, 9].map((x) => ({ type: 'dash', pts: [{ x, y: 0 }, { x, y: o.strap }] })) }));
    }
    if (o.kind === 'apron') {
      const hw = o.w / 2, bw = o.bib / 2, bh = 28, L = o.apronLen;
      const shape = path(0, 0).L(bw, 0, 1.5).L(bw, bh, 1.5).C({ x: bw, y: bh + 10 }, { x: hw - 4, y: bh + 6 }, { x: hw, y: bh + 16 }, 1.5)
        .L(hw, L, 1.5).L(0, L, 3).Z(0, fold);
      pieces.push(piece('body', 'Apron', shape, { cut: { n: 1, fold: true } }));
      pieces.push(rect('ties', 'Waist tie', 80, 8, { cut: { n: 2 }, horizontalGrain: true, marks: [{ type: 'dash', pts: [{ x: 0, y: 4 }, { x: 80, y: 4 }] }] }));
      pieces.push(rect('neck', 'Neck strap', 60, 8, { cut: { n: 1 }, horizontalGrain: true, marks: [{ type: 'dash', pts: [{ x: 0, y: 4 }, { x: 60, y: 4 }] }] }));
      pieces.push(patchPocket(22, 18));
    }
    if (o.kind === 'scrunchie') pieces.push(rect('tube', 'Scrunchie tube', 50, 10, { sa: [1, 1, 1, 1], horizontalGrain: true }));
    if (o.kind === 'pillow') {
      const s = o.size;
      pieces.push(rect('front', 'Cushion front', s, s, { sa: Array(4).fill(1.5) }));
      pieces.push(rect('back', 'Cushion back (envelope)', s, s * 0.65, { sa: [1.5, 1.5, 3, 1.5], cut: { n: 2 } }));
    }
    return { pieces, warnings: [] };
  },
  steps(m, o) {
    const S = {
      tote: ['Cut out the pieces.', 'Press each strap in half lengthwise, open, press both edges to the centre, fold again and topstitch both long edges.',
        'Sew the two outer pieces right sides together along the sides and bottom (not the corner cut-outs).',
        'Box the corners: pinch each cut-out so the side seam meets the bottom seam and sew straight across.',
        o.lined ? 'Repeat for the lining, leaving a 10 cm gap in the bottom seam for turning.' : 'Finish the top edge: press under 1 cm, then 2 cm, and stitch.',
        'Baste the straps to the top edge of the outer bag, about 8 cm in from each side seam.',
        o.lined ? 'Put the outer bag inside the lining (right sides together), sew around the top, turn through the gap and close it.' : 'Fold the straps up and stitch them to the hem with a box-X.',
        'Topstitch around the top edge and press.'],
      apron: ['Cut out the pieces.', 'Hem the sides and curved armhole edges: press under 0.75 cm twice and stitch.', 'Press and stitch the ties and neck strap into narrow tubes.',
        'Hem the top of the bib and the bottom hem.', 'Hem the pocket top, press the edges under and topstitch the pocket on.', 'Stitch the neck strap and waist ties on with a box-X for strength.'],
      scrunchie: ['Fold the tube in half lengthwise, right sides together, and sew the long edge.', 'Turn right side out.', 'Thread 20 cm of 6 mm elastic through, overlap the ends 2 cm and stitch them.', 'Tuck one raw end inside the other and slipstitch closed.'],
      pillow: ['Hem one long edge of each back piece: press under 1.5 cm twice and stitch.', 'Lay the front right side up, then the two back pieces right side down, overlapping at the middle with the hems in the centre.', 'Sew all the way around, clip the corners, turn through the opening and press.'],
      rect: ['Cut out the pieces and finish the edges as your project needs.'],
      circle: ['Cut out the circles. Clip curves before turning if you sew them together.'],
    }[o.kind];
    const notions = { tote: ['Thread', o.lined ? 'Lining fabric' : 'Optional: fusible interfacing for the top band'], apron: ['Thread'], scrunchie: ['20 cm of 6 mm elastic', 'Thread'], pillow: [`${o.size} cm cushion insert`, 'Thread'], rect: ['Thread'], circle: ['Thread'] }[o.kind];
    const fabrics = { tote: ['Canvas', 'Denim', 'Heavy cotton or linen'], apron: ['Cotton drill', 'Canvas', 'Linen'], scrunchie: ['Silk', 'Satin', 'Cotton', 'Velvet'], pillow: ['Cotton', 'Linen', 'Velvet', 'Upholstery fabric'], rect: [], circle: [] }[o.kind];
    return { steps: S, notions, fabrics };
  },
};
