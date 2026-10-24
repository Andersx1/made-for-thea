// Denim (trucker) jacket from the bodice block with jacket ease and no darts: front and back
// yokes, vertical panel seams, button stand, shirt collar on a stand, cuffed set-in sleeves,
// a waistband in sections, and pointed chest-pocket flaps. Coordinates as in bodice.js.
import { path, segLen, dist } from '../geom.js';
import { piece, rect, fold } from './common.js';
import { frame, neckChains, reverseChain, run, sleevePiece, armholeLen, splitY } from './bodice.js';

const FIT = { fitted: [14, 2], regular: [20, 3], oversized: [30, 4.5] }; // [bust ease, armhole drop] cm
const unit = (a, b) => { const L = dist(a, b) || 1; return { x: (b.x - a.x) / L, y: (b.y - a.y) / L }; };
const along = (a, u, d) => ({ x: a.x + u.x * d, y: a.y + u.y * d });
export const BAND = 5; // finished waistband height

export function jacketFrame(m, o) {
  const [be, ad] = FIT[o.fit] || FIT.regular, dropped = o.shoulder === 'dropped';
  const F = frame(m, { fit: 'relaxed', ease: [be, be], armDrop: ad + (dropped ? 3 : 0) });
  if (dropped) { // extend the shoulder line and push the armhole out
    F.BST = along(F.NP, unit(F.NP, F.BST), m.shoulderLength + 0.5 + 4); F.FST = along(F.NP, unit(F.NP, F.FST), m.shoulderLength + 4);
    F.AB = { x: Math.min(F.bw - 1.5, F.AB.x + 3), y: F.AB.y + 1.5 }; F.AF = { x: Math.min(F.fw - 2, F.AF.x + 3), y: F.AF.y + 1.5 };
  }
  const L = { cropped: F.NW - 2, regular: F.NW + 6, long: F.NW + F.WH + 2 }[o.length] ?? F.NW + 6; // finished length from the nape
  return { F, body: L - BAND, L, ext: 2.5 };
}

function draft(m, o) {
  const { F, body: yb, ext } = jacketFrame(m, o), N = neckChains(F, m, 'jacket'), pieces = [];
  // ---- back: yoke + centre panel (on fold) + side panels ----
  const S = { x: F.bw, y: F.SD }, xb = F.bw * 0.45, yy = F.AB.y;
  const Yb = path(0, yy).L(0, N.cbY, 0, fold);
  run(Yb, reverseChain(N.npB, N.back), 1, { name: 'neck' }).L(F.BST.x, F.BST.y, 1.5, { name: 'shoulder' })
    .C({ x: F.BST.x - 0.3, y: F.BST.y + 3 }, { x: F.AB.x, y: F.AB.y - 4 }, F.AB, 1, { name: 'armhole' });
  pieces.push(piece('backyoke', 'Back yoke', Yb.Z(1.5, { name: 'yoke' }), { cut: { n: 1, fold: true } }));
  pieces.push(piece('back', 'Back', path(0, yy).L(xb, yy, 1.5, { name: 'yoke' }).L(xb, yb, 1.5, { name: 'panel' }).L(0, yb, 1, { name: 'hem' }).Z(0, fold), { cut: { n: 1, fold: true } }));
  pieces.push(piece('sideback', 'Side back', path(xb, yy).L(F.AB.x, yy, 1.5, { name: 'yoke' })
    .C({ x: F.AB.x, y: F.AB.y + 4 }, { x: F.bw - 2.5, y: F.SD }, S, 1, { name: 'armhole' }).L(F.bw, yb, 1.5, { name: 'side' }).L(xb, yb, 1, { name: 'hem' }).Z(1.5, { name: 'panel' }), { cut: { n: 2, mirror: true } }));
  // ---- front: yoke + centre panel (with button stand) + side panel ----
  const FS = { x: F.fw, y: F.SD }, xf = F.BP.x + 1.5, fy = F.AF.y;
  const Yf = path(-ext, fy).L(-ext, N.cfY, 1, { name: 'edge' }).L(0, N.cfY, 1, { name: 'neck' });
  run(Yf, reverseChain(N.npF, N.front), 1, { name: 'neck' }).L(F.FST.x, F.FST.y, 1.5, { name: 'shoulder' })
    .C({ x: F.FST.x - 0.5, y: F.FST.y + 3 }, { x: F.AF.x, y: F.AF.y - 4 }, F.AF, 1, { name: 'armhole' });
  const btn = (y) => ({ type: 'button', pts: [{ x: 0, y }] });
  pieces.push(piece('frontyoke', 'Front yoke', Yf.Z(1.5, { name: 'yoke' }), { cut: { n: 2, mirror: true }, marks: [btn(N.cfY + 1.8)] }));
  const nB = Math.max(2, Math.round((yb - fy - 4) / 9)), marks = [];
  for (let i = 0; i < nB; i++) marks.push(btn(fy + 3 + i * (yb - fy - 6) / Math.max(1, nB - 1)));
  pieces.push(piece('front', 'Front', path(-ext, fy).L(xf, fy, 1.5, { name: 'yoke' }).L(xf, yb, 1.5, { name: 'panel' }).L(-ext, yb, 1, { name: 'hem' }).Z(1, { name: 'edge' }), { cut: { n: 2, mirror: true }, marks }));
  pieces.push(piece('sidefront', 'Side front', path(xf, fy).L(F.AF.x, fy, 1.5, { name: 'yoke' })
    .C({ x: F.AF.x, y: F.AF.y + 4 }, { x: F.fw - 3.5, y: F.SD }, FS, 1, { name: 'armhole' }).L(F.fw, yb, 1.5, { name: 'side' }).L(xf, yb, 1, { name: 'hem' }).Z(1.5, { name: 'panel' }), { cut: { n: 2, mirror: true } }));
  // ---- sleeve + cuff ----
  const cuffL = m.wrist + 9, sl = sleevePiece(m, { sleeve: 'long', fit: 'relaxed', sleeveEase: o.fit === 'oversized' ? 16 : 12, sleeveLen: m.armLength + (o.shoulder === 'dropped' ? -2 : 1.5) - 5.5, sleeveHem: cuffL + 5 }, armholeLen(pieces));
  sl.p.marks.push({ type: 'line', pts: [{ x: -(cuffL + 5) / 4, y: sl.L }, { x: -(cuffL + 5) / 4, y: sl.L - 9 }] }, { type: 'text', pts: [{ x: -(cuffL + 5) / 4, y: sl.L - 10 }], text: 'slit' });
  pieces.push(sl.p);
  pieces.push(rect('cuff', 'Cuff', cuffL + 2.5, 12, { cut: { n: 2 }, horizontalGrain: true, marks: [{ type: 'dash', pts: [{ x: 0, y: 6 }, { x: cuffL + 2.5, y: 6 }] }, { type: 'button', pts: [{ x: cuffL + 0.5, y: 3 }] }] }));
  // ---- waistband: back half on the fold, fronts with button stand ----
  pieces.push(rect('bandback', 'Back waistband', F.bw, BAND * 2, { sa: [1, 1, 1, 0], cut: { n: 2, fold: true }, horizontalGrain: true, marks: [{ type: 'dash', pts: [{ x: 0, y: BAND }, { x: F.bw, y: BAND }] }] }));
  pieces[pieces.length - 1].segs[3] = { sa: 0, ...fold };
  pieces.push(rect('bandfront', 'Front waistband', F.fw + ext, BAND * 2, { cut: { n: 4, mirror: true }, horizontalGrain: true, marks: [{ type: 'dash', pts: [{ x: 0, y: BAND }, { x: F.fw + ext, y: BAND }] }, { type: 'button', pts: [{ x: ext, y: BAND / 2 }] }] }));
  // ---- collar stand + collar (half, on the fold at centre back) ----
  const neckLen = (k) => { const p = pieces.find((x) => x.key === k); return p.segs.reduce((a, sg, i) => a + (sg.name === 'neck' ? segLen(p, i) : 0), 0); };
  const half = neckLen('frontyoke') + neckLen('backyoke') - ext * 0; // centre back to front edge (stand runs onto the button stand)
  pieces.push(piece('stand', 'Collar stand', path(0, 0).C({ x: half * 0.5, y: 0 }, { x: half * 0.85, y: -0.4 }, { x: half, y: -1.4 }, 1, { name: 'neck' })
    .C({ x: half + 1.2, y: -1.8 }, { x: half + 1, y: -3.8 }, { x: half - 0.4, y: -4 }, 1, { name: 'end' })
    .C({ x: half * 0.8, y: -3.3 }, { x: half * 0.4, y: -3 }, { x: 0, y: -3 }, 1, { name: 'top' }).Z(0, fold), { cut: { n: 2, fold: true }, marks: [{ type: 'button', pts: [{ x: half - 1.2, y: -2 }] }] }));
  const ch = half - 0.6;
  pieces.push(piece('collar', 'Collar', path(0, 0).C({ x: ch * 0.5, y: 0 }, { x: ch * 0.85, y: -0.4 }, { x: ch, y: -1 }, 1, { name: 'attach' })
    .L(ch + 2.5, 7.5, 1, { name: 'point' }).C({ x: ch * 0.7, y: 7.2 }, { x: ch * 0.3, y: 7 }, { x: 0, y: 7 }, 1, { name: 'outer' }).Z(0, fold), { cut: { n: 2, fold: true } }));
  // ---- chest pockets ----
  if (o.pockets !== 'none') {
    pieces.push(piece('flap', 'Pocket flap', path(0, 0).L(12, 0, 1).L(12, 4.5, 1).L(6, 6.5, 1).L(0, 4.5, 1).Z(1), { cut: { n: 4, mirror: true }, marks: [{ type: 'button', pts: [{ x: 6, y: 4.5 }] }] }));
    pieces.push(rect('pocket', 'Chest pocket', 12, 13, { sa: [2, 1, 1, 1], cut: { n: 2 } }));
  }
  const buttons = 1 + nB + 2 + 1 + 1 + (o.pockets !== 'none' ? 2 : 0);
  return { pieces, warnings: [], buttons };
}

export const jacket = {
  id: 'jacket', name: 'Denim jacket', icon: '🧥', blurb: 'Trucker-style jacket: yokes, panel seams, collar on a stand, cuffs, waistband and flap pockets.',
  needs: ['bust', 'highBust', 'waist', 'hip', 'neck', 'shoulderLength', 'backWidth', 'frontWidth', 'bustSpan', 'shoulderToBust', 'backLength', 'frontLength', 'armholeDepth', 'armLength', 'bicep', 'wrist', 'waistToHip'],
  title: (o) => `${o.length === 'cropped' ? 'Cropped d' : o.length === 'long' ? 'Long d' : 'D'}enim jacket`,
  options: [
    { key: 'fit', label: 'Fit', type: 'select', def: 'regular', choices: [['fitted', 'Fitted'], ['regular', 'Regular'], ['oversized', 'Oversized']] },
    { key: 'length', label: 'Length', type: 'select', def: 'regular', choices: [['cropped', 'Cropped (waist)'], ['regular', 'Classic (high hip)'], ['long', 'Long (hip)']] },
    { key: 'shoulder', label: 'Shoulder', type: 'select', def: 'setin', choices: [['setin', 'Set-in sleeve'], ['dropped', 'Dropped shoulder']] },
    { key: 'pockets', label: 'Chest pockets', type: 'select', def: 'flap', choices: [['flap', 'Flap pockets'], ['none', 'None']] },
  ],
  draft: (m, o) => { const d = draft(m, o); return { pieces: d.pieces, warnings: d.warnings }; },
  steps(m, o) {
    const n = draft(m, o).buttons;
    return {
      steps: ['Pre-wash the denim twice in hot water, then press it.', 'Print the pattern at 100% and check the test square.',
        'Recommended: make a quick test jacket (just the body and one sleeve) from cheap twill to check the shoulders, length and sleeve length.',
        'Cut out all pieces. Mark the notches and button positions. Interface the collar, collar stand, cuffs, waistband and the front button stands.',
        'Use a denim needle (90–100), topstitching thread and a 3.5 mm stitch.',
        ...(o.pockets !== 'none' ? ['Make the chest pockets: hem the tops, press the edges under and topstitch them onto the fronts just below the yoke line.', 'Make the flaps: sew pairs right sides together, clip, turn, press and topstitch. Make a buttonhole in each.'] : []),
        'Sew the front centre panels to the side fronts (flat-felled or overlocked and double-topstitched).',
        'Sew the back centre panel to the side backs the same way.',
        'Sew the front yokes to the fronts and the back yoke to the back. Press up and topstitch twice.',
        ...(o.pockets !== 'none' ? ['Sew the flaps into the yoke seam above the pockets, press down and topstitch.'] : []),
        'Sew the shoulder seams and topstitch.',
        'Make the collar: sew the collar pieces together, turn, press, topstitch. Sandwich it between the collar stands and sew.',
        'Attach the collar stand to the neckline, fold the inner stand over and edge-stitch it down.',
        'Set in the sleeves flat, matching the shoulder notch. Topstitch the armhole seam.',
        'Sew each side seam and sleeve seam in one go, leaving the cuff slit open at the sleeve hem.',
        'Finish the sleeve slits, pleat the sleeve hem to fit the cuff, attach the cuffs and edge-stitch.',
        'Attach the waistband: sew the outer band to the jacket, fold the inner band over and edge-stitch.',
        'Fold the front button stands in and topstitch the front edges.',
        `Make the buttonholes and hammer in or sew on the ${n} buttons.`, 'Give the jacket a final press.'],
      notions: [`${n} jeans tack buttons (or 17 mm shank buttons)`, 'Topstitching thread (gold or matching)', 'Regular thread', 'Medium fusible interfacing (collar, stand, cuffs, waistband, front edges)'],
      fabrics: ['Denim, 10–13 oz', 'Corduroy', 'Cotton canvas or drill', 'Wool twill (for a warmer jacket)'],
    };
  },
};
