// Skirts. The straight/pencil/A-line/wrap styles come from a classic quarter skirt block
// (front + back, waist darts, curved hip). A-line closes part of the dart and rotates
// the side section out, which flares the hem. Circle and gathered skirts are calculated directly.
import { path, segPts, atX, atY } from '../geom.js';
import { piece, rect, waistband, inseamPocket, patchPocket, fold } from './common.js';

const EASE = { fitted: [2, 0.5], regular: [4, 1], relaxed: [6, 2] }; // [hip, waist] ease in cm
const ZIP = 20;
const BLOCK = ['straight', 'pencil', 'aline', 'wrap'];
const rot = (c, a) => (q) => ({ x: c.x + (q.x - c.x) * Math.cos(a) - (q.y - c.y) * Math.sin(a), y: c.y + (q.x - c.x) * Math.sin(a) + (q.y - c.y) * Math.cos(a) });
const hasZip = (o) => o.waist !== 'elastic' && o.style !== 'wrap' && !o.noZip;

function blockPiece(m, o, isBack) {
  const [he, we0] = EASE[o.fit] || EASE.regular, we = o.waistEase ?? we0, H = m.hip + he, W = m.waist + we, WH = m.waistToHip, L = o.length;
  const q = Math.max(0, (H - W) / 4), side = Math.min(q * 0.4, 2.5), dartV = q - side;
  const w = H / 4 + (isBack ? -0.5 : 0.5), yc = isBack ? 1 : 0; // side seam sits 1 cm toward the back; back waist dips 1 cm
  const flared = o.style === 'aline' || o.style === 'wrap', ov = o.style === 'wrap' && !isBack ? o.overlap : 0;
  const dl = isBack ? WH * 0.7 : WH * 0.45;
  const darts = flared || dartV <= (isBack ? 3.5 : 3)
    ? [{ x: (w - side) * 0.5, v: dartV, l: dl }]
    : [{ x: (w - side) * 0.35, v: dartV / 2, l: dl }, { x: (w - side) * 0.68, v: dartV / 2, l: dl * 0.85 }];
  let sw = { x: w - side, y: -1.2 }, wc2 = { x: w - side - 3, y: -0.8 }, sc1 = { x: w - side + side * 0.7, y: WH * 0.3 },
    sc2 = { x: w, y: WH * 0.65 }, hip = { x: w, y: WH }, hemS = { x: w - (o.style === 'pencil' ? o.taper : 0), y: L };
  const wc1 = { x: (w - side) * 0.5, y: yc };
  if (flared) { // close part of the dart, pivoting the side section around the dart tip
    const d = darts[0], f = { slight: 0.35, medium: 0.65, full: 1 }[o.flare] ?? 0.65, R = rot({ x: d.x, y: d.l }, -f * 2 * Math.atan2(d.v / 2, d.l));
    [sw, wc2, sc1, sc2, hip, hemS] = [sw, wc2, sc1, sc2, hip, hemS].map(R);
    d.v *= 1 - f;
  }
  const vent = isBack && o.style === 'pencil' && o.vent, hemSA = flared ? 2.5 : 4;
  const P = path(-ov, yc);
  if (ov) P.L(0, yc, 1.5, { name: 'waist' });
  P.C(wc1, wc2, sw, 1.5, { name: 'waist' }).C(sc1, sc2, hip, 1.5, { name: 'side' }).L(hemS.x, hemS.y, 1.5, { name: 'side' });
  if (flared) { // hem leaves the side seam at a right angle and meets the centre level
    const s = { x: hemS.x - hip.x, y: hemS.y - hip.y }, sl = Math.hypot(s.x, s.y), D = Math.abs(hemS.x) / 3;
    P.C({ x: hemS.x - s.y / sl * D, y: hemS.y + s.x / sl * D }, { x: D, y: L }, { x: 0, y: L }, hemSA, { name: 'hem' });
  } else P.L(vent ? -4 : 0, L, hemSA, { name: 'hem' });
  if (ov) P.L(-ov, L, hemSA, { name: 'hem' });
  if (vent) P.L(-4, L - 18, 1.5).L(0, L - 22, 1.5);
  const seam = isBack ? (o.zip === 'back' && hasZip(o)) || vent : !!ov;
  const shape = P.Z(seam ? 1.5 : 0, seam ? { name: 'centre' } : fold);

  const wp = segPts(shape, ov ? 1 : 0, 48);
  const sidePts = [...segPts(shape, ov ? 2 : 1, 48), hemS];
  const marks = darts.filter((d) => d.v > 0.3).map((d) => ({ type: 'dart', pts: [atX(wp, d.x - d.v / 2) || wp[0], { x: d.x, y: d.l + yc }, atX(wp, d.x + d.v / 2) || wp[0]] }));
  const notches = [hip];
  if (hasZip(o) && o.zip === 'back' && isBack) notches.push({ x: 0, y: ZIP });
  if (hasZip(o) && o.zip === 'side') notches.push(atY(sidePts, ZIP));
  if (o.pockets === 'inseam') notches.push(atY(sidePts, 3), atY(sidePts, 19));
  return piece(isBack ? 'back' : 'front', isBack ? 'Back' : 'Front', shape, {
    cut: seam ? { n: 2, mirror: true } : { n: 1, fold: true },
    marks, notches: notches.filter(Boolean), grain: { a: { x: w * 0.35, y: WH }, b: { x: w * 0.35, y: L - 8 } },
  });
}

// Facing: the top 7 cm of the skirt piece with the darts closed (x scaled in by the dart width).
function facing(sk) {
  const d = 7, wseg = sk.segs[0], sw = sk.nodes[1], c = sk.nodes[0];
  const darts = sk.marks.reduce((a, mk) => a + Math.abs(mk.pts[2].x - mk.pts[0].x), 0), k = (sw.x - darts) / sw.x;
  const s = (q, dy = 0) => ({ x: q.x * k, y: q.y + dy });
  const shape = path(c.x, c.y).C(s(wseg.c1), s(wseg.c2), s(sw), 1.5).L(sw.x * k + 0.6, sw.y + d, 1.5)
    .C(s(wseg.c2, d), s(wseg.c1, d), s(c, d), 1.5).Z(sk.segs[sk.segs.length - 1].sa, sk.cut.fold ? fold : { name: 'centre' });
  return piece(sk.key + 'facing', `${sk.name} facing`, shape, { cut: { ...sk.cut }, grain: { a: { x: sw.x * 0.4, y: c.y + 1.5 }, b: { x: sw.x * 0.4, y: c.y + d - 1.5 } } });
}

function circleSkirt(m, o) {
  const f = +o.circle, Wt = o.waist === 'elastic' ? m.hip + 4 : m.waist + (o.waistEase ?? 1), r = Wt / (2 * Math.PI * f), R = r + o.length;
  const shape = path(r, 0).L(R, 0, 1.5, { name: 'side' }).A({ x: 0, y: 0 }, R, 0, Math.PI / 2, 1, { name: 'hem' })
    .L(0, r, 1.5, { name: 'side' }).A({ x: 0, y: 0 }, r, Math.PI / 2, 0, 1.5, { name: 'waist' }).Z();
  const n = 4 * f;
  const p = piece('panel', n === 1 ? 'Skirt' : 'Skirt panel', shape, { cut: { n }, grain: { a: { x: r + 4, y: 3 }, b: { x: R - 4, y: 3 } } });
  p.labelAt = { x: (r + R) / 2 * 0.7, y: (r + R) / 2 * 0.7 };
  return { pieces: [p], W: Wt, warnings: R + 1.5 > 145 ? [`Each panel is ${Math.round(R + 1.5)} cm across, wider than most fabric (150 cm). Choose a shorter length or a half circle, or join fabric widths.`] : [] };
}

function gathered(m, o) {
  const tiers = +o.tiers, full = +o.fullness, base = Math.max((m.waist + 1) * full, o.waist === 'elastic' ? m.hip + 10 : 0) / 2;
  const th = o.length / tiers, pieces = [], warnings = [];
  for (let i = 0; i < tiers; i++) {
    const w = base * Math.pow(1.4, i), last = i === tiers - 1;
    pieces.push(rect('tier' + i, tiers > 1 ? `Tier ${i + 1}` : 'Skirt panel', w, th, { sa: [1.5, 1.5, last ? 2.5 : 1.5, 1.5], cut: { n: 2 } }));
    if (w > 145) warnings.push(`${tiers > 1 ? `Tier ${i + 1}` : 'The skirt panel'} is ${Math.round(w)} cm wide: join two fabric widths to make it, or cut 4 narrower panels.`);
  }
  return { pieces, W: m.waist + 1, warnings };
}

export default {
  id: 'skirt', name: 'Skirt', icon: '👗', blurb: 'Straight, pencil, A-line, circle, gathered/tiered and wrap skirts.',
  needs: ['waist', 'hip', 'waistToHip', 'waistToKnee'],
  title: (o) => `${{ straight: 'Straight', pencil: 'Pencil', aline: 'A-line', circle: 'Circle', gathered: +o.tiers > 1 ? 'Tiered' : 'Gathered', wrap: 'Wrap' }[o.style]} skirt`,
  options: [
    { key: 'style', label: 'Style', type: 'select', def: 'aline', choices: [['straight', 'Straight'], ['pencil', 'Pencil'], ['aline', 'A-line'], ['circle', 'Circle'], ['gathered', 'Gathered / tiered'], ['wrap', 'Wrap']] },
    { key: 'length', label: 'Length (waist to hem)', type: 'len', def: (m) => m.waistToKnee },
    { key: 'fit', label: 'Fit', type: 'select', def: 'regular', choices: [['fitted', 'Fitted'], ['regular', 'Regular'], ['relaxed', 'Relaxed']], show: (o) => BLOCK.includes(o.style) },
    { key: 'flare', label: 'Flare', type: 'select', def: 'medium', choices: [['slight', 'Slight'], ['medium', 'Medium'], ['full', 'Full']], show: (o) => o.style === 'aline' || o.style === 'wrap' },
    { key: 'circle', label: 'Circle', type: 'select', def: '1', choices: [['1', 'Full circle'], ['0.5', 'Half circle'], ['0.25', 'Quarter circle']], show: (o) => o.style === 'circle' },
    { key: 'fullness', label: 'Fullness', type: 'select', def: '1.8', choices: [['1.5', 'Light (1.5×)'], ['1.8', 'Medium (1.8×)'], ['2.2', 'Full (2.2×)']], show: (o) => o.style === 'gathered' },
    { key: 'tiers', label: 'Tiers', type: 'select', def: '1', choices: [['1', 'One'], ['2', 'Two'], ['3', 'Three']], show: (o) => o.style === 'gathered' },
    { key: 'taper', label: 'Hem taper (each side)', type: 'len', def: () => 2.5, show: (o) => o.style === 'pencil' },
    { key: 'vent', label: 'Back vent', type: 'check', def: true, show: (o) => o.style === 'pencil' },
    { key: 'overlap', label: 'Wrap overlap', type: 'len', def: (m) => Math.round(m.hip / 4 * 0.6), show: (o) => o.style === 'wrap' },
    { key: 'waist', label: 'Waist finish', type: 'select', def: 'band',
      choices: (o) => [['band', 'Waistband'], ...(['straight', 'pencil', 'aline'].includes(o.style) ? [['facing', 'Facing (no band)']] : []), ...(['circle', 'gathered'].includes(o.style) ? [['elastic', 'Elastic waist']] : [])] },
    { key: 'bandWidth', label: 'Waistband width', type: 'len', def: () => 4, show: (o) => o.waist === 'band' },
    { key: 'zip', label: 'Zip', type: 'select', def: 'back', choices: [['back', 'Centre back'], ['side', 'Left side']], show: hasZip },
    { key: 'pockets', label: 'Pockets', type: 'select', def: 'none', choices: [['none', 'None'], ['inseam', 'In-seam'], ['patch', 'Patch']] },
  ],

  draft(m, o) {
    let pieces = [], warnings = [], W;
    if (o.style === 'circle') ({ pieces, W, warnings } = circleSkirt(m, o));
    else if (o.style === 'gathered') ({ pieces, W, warnings } = gathered(m, o));
    else {
      pieces = [blockPiece(m, o, false), blockPiece(m, o, true)];
      W = m.waist + (o.waistEase ?? (EASE[o.fit] || EASE.regular)[1]);
      if (o.waist === 'facing') pieces.push(...pieces.map(facing));
    }
    if (o.waist === 'band') pieces.push(waistband(W + (o.style === 'wrap' ? o.overlap : 3), o.bandWidth));
    if (o.waist === 'elastic') pieces.push(rect('casing', 'Elastic casing', m.hip + 6, 8, { horizontalGrain: true, marks: [{ type: 'dash', pts: [{ x: 0, y: 4 }, { x: m.hip + 6, y: 4 }] }] }));
    if (o.style === 'wrap') pieces.push(rect('tie', 'Tie', 80, 6, { cut: { n: 2 }, horizontalGrain: true, marks: [{ type: 'dash', pts: [{ x: 0, y: 3 }, { x: 80, y: 3 }] }] }));
    if (o.pockets === 'inseam') pieces.push(inseamPocket());
    if (o.pockets === 'patch') pieces.push(patchPocket());
    if (o.waist === 'elastic' && m.hip + 4 > W * Number(o.fullness || 1) && o.style === 'gathered') warnings.push('This skirt may be tight to pull over the hips. Pick more fullness.');
    return { pieces, warnings };
  },

  steps(m, o) {
    const block = BLOCK.includes(o.style), flared = o.style === 'aline' || o.style === 'wrap', S = [
      'Pre-wash and dry your fabric the way you will wash the finished skirt, then press it.',
      'Print the pattern at 100% and check the test square before taping the pages together.',
    ];
    if (block && o.fit !== 'relaxed') S.push('Recommended: sew a quick test skirt (toile) in cheap fabric and check the fit at the waist and hips.');
    S.push('Cut out all pieces. Transfer notches, darts and grainlines to the fabric.');
    if (o.waist === 'band') S.push('Fuse interfacing to the waistband.');
    if (o.waist === 'facing') S.push('Fuse interfacing to the facings and finish their lower edges.');
    if (block) S.push('Sew the darts and press them toward the centre.');
    if (o.style === 'gathered' && +o.tiers > 1) S.push('Gather the top edge of each lower tier and sew it to the tier above, matching the side seams.');
    if (o.pockets === 'inseam') S.push('Sew a pocket bag to the front and back side seams between the notches. Press the bags outward.');
    if (o.pockets === 'patch') S.push('Hem the pocket tops, press the other edges under and topstitch the pockets onto the front.');
    if (hasZip(o)) S.push(o.zip === 'back' ? 'Sew the centre back seam up to the zip notch, then insert the zip.' : 'Insert the zip in the left side seam above the zip notch.');
    S.push(`Sew the side seams${o.pockets === 'inseam' ? ', pivoting around the pocket bags' : ''}. Finish the seam allowances (overlock, zigzag or pinking shears).`);
    if (o.style === 'wrap') S.push('Hem the two front wrap edges: press under 0.75 cm twice and stitch.');
    if (o.style === 'pencil' && o.vent) S.push('Finish the back vent: press the vent extension to the left and stitch across its top at an angle.');
    if (o.style === 'gathered' || (o.style === 'circle' && o.waist === 'elastic')) S.push('Run two rows of long gathering stitches along the top edge.');
    if (o.waist === 'band') S.push(o.style === 'gathered' ? 'Pull up the gathers to fit the waistband, sew the band on, fold it over and stitch it down.' : 'Sew the waistband to the skirt, fold it in half, and stitch it down from the right side ("stitch in the ditch").');
    if (o.waist === 'facing') S.push('Sew the facings to the waist, understitch, and turn them inside. Hand-tack them to the darts and zip tape.');
    if (o.waist === 'elastic') S.push(`Sew the casing into a ring, attach it to the skirt top, fold over, and thread ${Math.round(m.waist * 0.9)} cm of elastic through. Overlap the elastic ends and stitch them.`);
    if (o.style === 'circle') S.push('Hang the skirt for 24 hours so the bias edges can drop, then even the hem by measuring up from the floor.');
    S.push(o.style === 'circle' ? 'Hem with a narrow rolled hem (about 1 cm).' : flared ? 'Hem: press up 2.5 cm, easing in the curve, and stitch.' : 'Hem: press up 4 cm, finish the raw edge and blind-stitch by hand or machine.');
    if (o.waist === 'band') S.push('Add a button and buttonhole, or a hook and bar, to the waistband.');
    if (o.style === 'wrap') S.push('Make the ties, then stitch one to each end of the waistband.');
    S.push('Give the whole skirt a final press.');
    const notions = ['Matching thread'];
    if (hasZip(o)) notions.push(`${ZIP} cm (8") zip: invisible or regular`);
    if (o.waist === 'band') notions.push('Fusible interfacing for the waistband', 'Button or hook and bar');
    if (o.waist === 'facing') notions.push('Fusible interfacing for the facings', 'Hook and eye');
    if (o.waist === 'elastic') notions.push(`${Math.round(m.waist * 0.9 + 3)} cm of 2.5–3 cm wide elastic`);
    const fabrics = {
      straight: ['Cotton twill', 'Linen', 'Wool suiting', 'Denim'], pencil: ['Stretch cotton sateen', 'Wool crepe', 'Ponte knit', 'Stretch denim'],
      aline: ['Cotton poplin', 'Linen', 'Corduroy', 'Chambray'], circle: ['Rayon/viscose challis', 'Crepe', 'Cotton lawn', 'Scuba knit'],
      gathered: ['Cotton lawn', 'Double gauze', 'Rayon', 'Seersucker'], wrap: ['Rayon', 'Linen', 'Crepe de chine', 'Cotton lawn'],
    }[o.style];
    return { steps: S, notions, fabrics };
  },
};
