// Trousers, shorts and jeans from a classic trouser block.
// Coordinates: cm, y down from the natural waist (y = 0). Each leg piece has its side seam at
// x = 0 on the hip line and its centre (front/back crotch) toward +x. The back is wider with a
// longer crotch extension and a raised, slanted centre back so it fits over the seat.
import { path, segPts, atY, lerp, dist, bez, segLen } from '../geom.js';
import { piece, rect, inseamPocket, fold } from './common.js';

const HIP_EASE = { fitted: 2, regular: 4, relaxed: 8 };
// leg shape: [knee ease, hem ease, hem measured from 'ankle' or 'knee']
const LEGS = { skinny: [3, 5, 'ankle'], slim: [7, 11, 'ankle'], straight: [11, 11, 'knee'], bootcut: [8, 20, 'knee'], wide: [22, 32, 'knee'], flared: [8, 30, 'knee'] };
const unit = (a, b) => { const L = dist(a, b) || 1; return { x: (b.x - a.x) / L, y: (b.y - a.y) / L }; };
const rot = (c, a) => (q) => ({ x: c.x + (q.x - c.x) * Math.cos(a) - (q.y - c.y) * Math.sin(a), y: c.y + (q.x - c.x) * Math.sin(a) + (q.y - c.y) * Math.cos(a) });
// Split a cubic at t: [first half controls, second half controls]
function splitC(a, c1, c2, b, t) {
  const ab = lerp(a, c1, t), bc = lerp(c1, c2, t), cd = lerp(c2, b, t), abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), m = lerp(abc, bcd, t);
  return [{ c1: ab, c2: abc, to: m }, { c1: bcd, c2: cd, to: b }];
}
const tAtY = (a, c1, c2, b, y) => { let best = 0, bd = Infinity; for (let i = 0; i <= 200; i++) { const t = i / 200, d = Math.abs(bez(a, c1, c2, b, t).y - y); if (d < bd) { bd = d; best = t; } } return best; };

// Shared measurements → key heights and widths for one garment.
export function legFrame(m, o) {
  const st = (+o.stretch || 0) / 100, jeans = o.jeans;
  const Hh = m.hip + (HIP_EASE[o.fit] ?? 4) - m.hip * st * 0.6;
  const r = { high: 0, mid: 4, low: 8 }[o.rise] ?? 0, elastic = o.waist === 'elastic';
  const WH = m.waistToHip, Wa = m.waist + (m.hip - m.waist) * Math.min(1, r / WH) + (elastic ? 0 : 1.5) - m.waist * st * 0.3;
  const crotchY = m.crotchDepth + ({ fitted: 1, regular: 1.5, relaxed: 2.5 }[o.fit] ?? 1.5), hipY = Math.min(WH, crotchY - 4);
  const kneeY = m.waistToKnee, hemY = { full: m.waistToFloor - 2, ankle: m.waistToFloor - 8, capri: m.waistToKnee + (m.waistToFloor - m.waistToKnee) * 0.5, bermuda: m.waistToKnee - 4, shorts: crotchY + (o.shortsInseam || 10) }[o.length] ?? m.waistToFloor - 2;
  const [ke, he, hb] = LEGS[o.leg] || LEGS.straight;
  const kneeC = m.knee + ke * (1 - st * 4), hemC = (hb === 'ankle' ? m.ankle : m.knee) + he * (1 - st * 3);
  const flyY = Math.min(r + (jeans ? 16 : 18), hipY - 4.5); // fly must end above the crotch curve, so lower rises get a shorter zip
  return { st, jeans, Hh, r, elastic, WH, Wa, crotchY, hipY, kneeY, hemY, kneeC, hemC, flyY };
}

// One leg piece (front or back), plus the extra pieces that are cut from it (pocket facing, yoke).
function legPiece(m, o, L, isBack, drop = 0.7) {
  const { Hh, r, elastic, Wa, crotchY, hipY, kneeY, hemY, kneeC, hemC, flyY } = L;
  const W = isBack ? Hh / 4 + 0.5 : Hh / 4 - 0.5, ext = isBack ? Hh / 8 - 0.5 : Hh / 16 + 0.5;
  const C = { x: W + ext, y: crotchY + (isBack ? drop : 0) }; // back crotch point drops so the back inseam is eased in
  const xc = isBack ? (W + ext) / 2 - 1 : (W + ext + 0.5) / 2; // crease line
  const kw = (kneeC / 2 + (isBack ? 1 : -1)) / 2, hw = (hemC / 2 + (isBack ? 1 : -1)) / 2;
  const hip = { x: W, y: hipY };
  const top = isBack
    ? { x: W - (elastic ? 2.5 : 4) * (hipY - (r - 2.5)) / (hipY + 2.5), y: r - 2.5 }
    : { x: elastic ? W : W - 1 + r / hipY, y: r };
  // Waist shaping: the side seam takes some, darts take the rest (jeans fronts: side only).
  const base = { x: 0, y: r }, L0 = dist(base, top), target = Wa / 4 + (isBack ? 0.5 : -0.5);
  let q = elastic ? 0 : Math.max(0, L0 - target), side = isBack ? Math.min(q * 0.4, 2) : o.jeans ? q : Math.min(q, 2.5), dart = q - side;
  if (dart < 0.6 && !(isBack && o.yoke)) { side += dart; dart = 0; }
  const sw = { x: unit(base, top).x * side, y: r + unit(base, top).y * side };
  // Leg points
  let KI, KO, HI, HO;
  if (hemY >= kneeY) { KI = { x: xc + kw, y: kneeY }; KO = { x: xc - kw, y: kneeY }; HI = { x: xc + hw, y: hemY }; HO = { x: xc - hw, y: hemY }; }
  else { // shorts: width between the crotch line and the knee, plus a little flare
    const t = (hemY - C.y) / (kneeY - C.y);
    HI = { x: C.x + (xc + kw - C.x) * t + 1, y: hemY }; HO = { x: 0.3 + (xc - kw - 0.3) * t - 1, y: hemY };
  }
  const SH = { x: 0, y: hipY }, sc1 = { x: 0, y: hipY - (hipY - sw.y) * 0.45 }, sc2 = { x: sw.x * 0.6, y: sw.y + (hipY - sw.y) * 0.25 };
  const hemSA = o.jeans ? 3.5 : 4;
  // Build outline: top (centre) → centre → crotch → inseam → hem → outseam → side → waist
  const fly = !isBack && o.closure === 'fly' && !elastic;
  const cfAt = (y) => lerp(top, hip, (y - top.y) / (hip.y - top.y));
  const P = path(top.x, top.y);
  if (fly) { const fb = cfAt(Math.min(flyY + 4, hipY - 0.5)); P.L(top.x + 3.5, top.y, 1, { name: 'waist' }).L(cfAt(flyY).x + 3.5, flyY, 1, { name: 'fly' }).C({ x: cfAt(flyY).x + 3.5, y: flyY + 2.5 }, { x: fb.x + 0.8, y: fb.y - 1.5 }, fb, 1, { name: 'fly' }); }
  P.L(hip.x, hip.y, 1.5, { name: 'centre' }).C({ x: W + (isBack ? 0.3 : 0), y: C.y - (isBack ? 1 : 2.5) }, { x: W + ext * (isBack ? 0.35 : 0.45), y: C.y }, C, 1, { name: 'crotch' });
  if (hemY >= kneeY) P.C({ x: C.x - 1.5, y: C.y + (kneeY - C.y) * 0.35 }, { x: KI.x + 0.3, y: KI.y - (kneeY - C.y) * 0.35 }, KI, 1.5, { name: 'inseam' }).L(HI.x, HI.y, 1.5, { name: 'inseam' });
  else P.C({ x: C.x - 1, y: C.y + (hemY - C.y) * 0.4 }, { x: HI.x + 0.3, y: HI.y - (hemY - C.y) * 0.3 }, HI, 1.5, { name: 'inseam' });
  P.L(HO.x, HO.y, hemSA, { name: 'hem' });
  if (hemY >= kneeY) P.L(KO.x, KO.y, 1.5, { name: 'side' }).C({ x: KO.x - 0.2, y: KO.y - (kneeY - hipY) * 0.4 }, { x: 0, y: hipY + (kneeY - hipY) * 0.3 }, SH, 1.5, { name: 'side' });
  else P.C({ x: HO.x - 0.3, y: HO.y - (HO.y - hipY) * 0.4 }, { x: 0, y: hipY + (HO.y - hipY) * 0.3 }, SH, 1.5, { name: 'side' });
  const extra = [], marks = [], notches = [];
  const pocket = !isBack && ['slant', 'scoop'].includes(o.pockets), yokeLine = isBack && o.yoke;
  if (pocket) { // front pocket opening: the corner of the front is cut away and replaced by the pocket facing
    const scoop = o.pockets === 'scoop', yP = r + (scoop ? 9 : 17), t = tAtY(SH, sc1, sc2, sw, yP), [lo, hi] = splitC(SH, sc1, sc2, sw, t), SP = lo.to;
    const along = unit(sw, top), PO = { x: sw.x + along.x * (scoop ? 10 : 4), y: sw.y + along.y * (scoop ? 10 : 4) };
    P.C(lo.c1, lo.c2, SP, 1.5, { name: 'side' });
    if (scoop) P.C({ x: SP.x + (PO.x - SP.x) * 0.15, y: SP.y - 2 }, { x: PO.x - 0.5, y: PO.y + (SP.y - PO.y) * 0.55 }, PO, 1, { name: 'pocket' });
    else P.L(PO.x, PO.y, 1, { name: 'pocket' });
    // Pocket facing: the cut-away corner, extended 3 cm past the opening and down to below it.
    const fx = PO.x + along.x * 3, fy = yP + 7, fs = atY(segPts({ nodes: [SH, sw], segs: [{ c1: sc1, c2: sc2 }, {}] }, 0, 60), fy) || { x: 0, y: fy };
    // Edges named 'under' lie beneath the front and are basted, not seamed.
    const F = path(sw.x, sw.y).L(PO.x, PO.y, 1, { name: 'waist' }).L(fx, sw.y + along.y * (fx - sw.x) / (along.x || 1), 1, { name: 'under' }).L(fx, fy, 0).L(fs.x, fs.y, 0)
      .C({ x: fs.x, y: fs.y - (fs.y - SP.y) * 0.5 }, { x: SP.x, y: SP.y + (fs.y - SP.y) * 0.3 }, SP, 1.5, { name: 'under' }).C(hi.c1, hi.c2, sw, 1.5, { name: 'side' }).Z();
    extra.push(piece('facing', 'Pocket facing', F, { cut: { n: 2, mirror: true } }));
    const bag = path(PO.x - 2, PO.y).L(sw.x, sw.y, 1).L(fs.x - 0.5, fy + 2, 1).C({ x: 0, y: fy + 10 }, { x: PO.x - 6, y: fy + 12 }, { x: PO.x + 3, y: fy + 10 }, 1).C({ x: PO.x + 7, y: fy + 8 }, { x: PO.x + 6, y: PO.y + 4 }, { x: PO.x + 6, y: PO.y + 1 }, 1).Z(1);
    extra.push(piece('pocket', 'Pocket bag', bag, { cut: { n: 4, mirror: true } }));
  } else {
    P.C(sc1, sc2, sw, 1.5, { name: 'side' });
    if (o.pockets === 'inseam' && !isBack) notches.push(atY(segPts({ nodes: [SH, sw], segs: [{ c1: sc1, c2: sc2 }, {}] }, 0, 60), r + 3) || sw, atY(segPts({ nodes: [SH, sw], segs: [{ c1: sc1, c2: sc2 }, {}] }, 0, 60), r + 17) || SH);
  }
  if (o.pockets === 'inseam' && isBack) notches.push({ x: 0.2, y: Math.min(r + 17, hipY) });
  // Darts
  const mid = lerp(sw, top, 0.5), wu = unit(sw, top), nrm = { x: -wu.y, y: wu.x };
  const dartAt = (c, v, len) => ({ type: 'dart', pts: [{ x: c.x - wu.x * v / 2, y: c.y - wu.y * v / 2 }, { x: c.x + nrm.x * len, y: c.y + nrm.y * len }, { x: c.x + wu.x * v / 2, y: c.y + wu.y * v / 2 }] });
  if (fly) marks.push({ type: 'dash', pts: [{ x: cfAt(r).x - 3.5, y: r }, { x: cfAt(flyY - 2).x - 3.5, y: flyY - 2 }, { x: cfAt(flyY + 1).x - 2, y: flyY + 1 }, cfAt(flyY + 3)] });
  let yoke = null;
  if (yokeLine) { // jeans back yoke: the dart ends on the yoke line and is closed inside the yoke
    const yc = cfAt(top.y + 7), t = tAtY(SH, sc1, sc2, sw, r + 3.5), [lo, hi] = splitC(SH, sc1, sc2, sw, t), YS = lo.to;
    const T = lerp(YS, yc, Math.max(0.2, Math.min(0.8, (mid.x - YS.x) / ((yc.x - YS.x) || 1))));
    const L1 = { x: mid.x - wu.x * dart / 2, y: mid.y - wu.y * dart / 2 }, L2 = { x: mid.x + wu.x * dart / 2, y: mid.y + wu.y * dart / 2 };
    const R = rot(T, Math.atan2(L1.y - T.y, L1.x - T.x) - Math.atan2(L2.y - T.y, L2.x - T.x));
    const Y = path(YS.x, YS.y).C(hi.c1, hi.c2, sw, 1.5, { name: 'side' }).L(L1.x, L1.y, 1, { name: 'waist' }).L(R(top).x, R(top).y, 1, { name: 'waist' })
      .L(R(yc).x, R(yc).y, 1.5, { name: 'centre' }).L(T.x, T.y, 1.5, { name: 'yoke' }).Z(1.5, { name: 'yoke' });
    yoke = piece('yoke', 'Back yoke', Y, { cut: { n: 2, mirror: true }, grain: { a: { x: T.x, y: YS.y }, b: { x: T.x, y: T.y + 1 } } });
    // Lower back: replace everything above the yoke line.
    const B = path(yc.x, yc.y).L(hip.x, hip.y, 1.5, { name: 'centre' });
    const full = P.Z(1, { name: 'waist' });
    // copy the leg part of the outline (from the crotch curve to the hip side point)
    const iC = full.segs.findIndex((s) => s.name === 'crotch'), iSide = full.segs.length - 2; // last side seg runs hip → waist
    for (let i = iC; i < iSide; i++) { const s = full.segs[i], to = full.nodes[i + 1]; s.c1 ? B.C(s.c1, s.c2, to, s.sa, { name: s.name }) : B.L(to.x, to.y, s.sa, { name: s.name }); }
    B.C(lo.c1, lo.c2, YS, 1.5, { name: 'side' });
    const lower = B.Z(1.5, { name: 'yoke' });
    return { crotch: dist(top, hip) + segLen(full, iC), main: piece('back', 'Back', lower, { cut: { n: 2, mirror: true }, notches, grain: { a: { x: xc, y: crotchY - 6 }, b: { x: xc, y: Math.max(crotchY, hemY - 8) } } }), extra: [yoke] };
  }
  if (dart > 0.3) {
    if (isBack && dart > 3.5) marks.push(dartAt(lerp(sw, top, 0.35), dart / 2, 11), dartAt(lerp(sw, top, 0.68), dart / 2, 12));
    else marks.push(dartAt(mid, dart, isBack ? 12 : 8));
  }
  const shape = P.Z(1, { name: 'waist' });
  notches.push(hip.y > top.y ? { x: 0, y: hipY } : null, KI || HI);
  return {
    crotch: dist(top, hip) + segLen(shape, shape.segs.findIndex((x) => x.name === 'crotch')),
    main: piece(isBack ? 'back' : 'front', isBack ? 'Back' : 'Front', shape, { cut: { n: 2, mirror: true }, marks, notches: notches.filter(Boolean), grain: { a: { x: xc, y: Math.max(r + 6, crotchY - 8) }, b: { x: xc, y: Math.max(crotchY, hemY - 8) } } }),
    extra,
  };
}

// Curved (contour) waistband half: top = waist length, bottom = length 4 cm lower, like a cone.
function contourBand(L, width) {
  const half = L.Wa / 2, Lb = (L.Wa + (L.Hh - L.Wa) * Math.min(1, width / L.WH) * 0.8) / 2, ov = 3.5;
  if (Lb - half < 0.3) return rect('waistband', 'Waistband', L.Wa + ov, width * 2, { horizontalGrain: true, marks: [{ type: 'dash', pts: [{ x: 0, y: width }, { x: L.Wa + ov, y: width }] }] });
  const rt = width * half / (Lb - half), a = half / rt, rb = rt + width, a0 = -Math.PI / 2 - a / 2, a1 = -Math.PI / 2 + a / 2, cx = 0, cy = rb + 1;
  const p = (rr, an) => ({ x: cx + rr * Math.cos(an), y: cy + rr * Math.sin(an) });
  const A = p(rt, a0), Cp = p(rb, a1), D = p(rb, a0), e = { x: Math.sin(a0), y: -Math.cos(a0) }; // tangent pointing past the front end
  const shape = path(A.x + e.x * ov, A.y + e.y * ov).L(A.x, A.y, 1).A({ x: cx, y: cy }, rt, a0, a1, 1, { name: 'top' }).L(Cp.x, Cp.y, 1.5, { name: 'centre' })
    .A({ x: cx, y: cy }, rb, a1, a0, 1, { name: 'waist' }).L(D.x + e.x * ov, D.y + e.y * ov, 1).Z(1);
  return piece('waistband', 'Waistband (half)', shape, { cut: { n: 4, mirror: true }, grain: { a: p(rt + width / 2, a0 + a * 0.2), b: p(rt + width / 2, a1 - a * 0.2) } });
}

function draftLegs(m, o) {
  const L = legFrame(m, o), warnings = [], f = legPiece(m, o, L, false);
  const inseam = (p) => p.segs.reduce((a, s, i) => a + (s.name === 'inseam' ? segLen(p, i) : 0), 0), fIn = inseam(f.main);
  let b = legPiece(m, o, L, true);
  for (let drop = 1; drop <= 3 && inseam(b.main) > fIn - 0.2; drop += 0.25) b = legPiece(m, o, L, true, drop); // back inseam = front or a little shorter
  const pieces = [f.main, b.main, ...f.extra, ...b.extra];
  if (o.waist === 'elastic') pieces.push(rect('casing', 'Elastic casing', L.Hh + 4, 9, { horizontalGrain: true, marks: [{ type: 'dash', pts: [{ x: 0, y: 4.5 }, { x: L.Hh + 4, y: 4.5 }] }] }));
  else if (o.jeans) pieces.push(contourBand(L, 4));
  else pieces.push(rect('waistband', 'Waistband', L.Wa + 3.5, 8, { horizontalGrain: true, marks: [{ type: 'dash', pts: [{ x: 0, y: 4 }, { x: L.Wa + 3.5, y: 4 }] }, { type: 'text', pts: [{ x: (L.Wa + 3.5) / 2, y: 2.4 }], text: 'fold · interface' }] }));
  if (o.closure === 'fly' && o.waist !== 'elastic') pieces.push(rect('flyshield', 'Fly shield', 6, L.flyY - L.r + 4, { cut: { n: 1 }, marks: [{ type: 'dash', pts: [{ x: 3, y: 0 }, { x: 3, y: L.flyY - L.r + 4 }] }] }));
  if (o.pockets === 'inseam') pieces.push(inseamPocket());
  if (o.jeans) {
    pieces.push(rect('coin', 'Coin pocket', 9, 8, { sa: [2, 1, 1, 1], cut: { n: 1 } }));
    const pw = Math.round(m.hip / 7 * 10) / 10, ph = pw * 1.1;
    pieces.push(piece('backpocket', 'Back pocket', path(0, 0).L(pw, 0, 2.5).L(pw, ph - 2, 1).L(pw / 2, ph, 1).L(0, ph - 2, 1).Z(1), { cut: { n: 2 } }));
    pieces.push(rect('loops', 'Belt loop strip', 4, 54, { sa: [0, 0, 0, 0], cut: { n: 1 }, marks: [{ type: 'text', pts: [{ x: 2, y: 27 }], text: 'cut into 6' }] }));
  } else if (o.backPockets === 'patch') pieces.push(rect('backpocket', 'Back pocket', 14, 15, { sa: [2.5, 1, 1, 1], cut: { n: 2 } }));
  // Crotch seam check against the body measurement.
  const crotch = f.crotch + b.crotch;
  const want = m.crotchLength - (L.r * 2) + 3;
  const roomy = { fitted: 7, regular: 9, relaxed: 13 }[o.fit] ?? 9;
  if (crotch - want > roomy || want - crotch > 6) warnings.push(`The crotch seam drafts to ${Math.round(crotch)} cm but your crotch length suggests about ${Math.round(want)} cm. Re-check crotch depth (seated) and crotch length.`);
  if (L.st === 0 && o.leg === 'skinny') warnings.push('Skinny legs need stretch fabric. Set stretch to 2% or more.');
  if (o.waist === 'elastic' && o.closure === 'fly') warnings.push('Elastic-waist trousers pull on, so no fly is needed.');
  return { pieces, warnings };
}

const len = (key, label, def, show) => ({ key, label, type: 'len', def, show });
const common = (legs, defLeg) => [
  { key: 'leg', label: 'Leg shape', type: 'select', def: defLeg, choices: legs },
  { key: 'length', label: 'Length', type: 'select', def: 'full', choices: [['full', 'Full length'], ['ankle', 'Ankle (7/8)'], ['capri', 'Capri'], ['bermuda', 'Bermuda'], ['shorts', 'Shorts']] },
  len('shortsInseam', 'Shorts inside leg', () => 10, (o) => o.length === 'shorts'),
  { key: 'rise', label: 'Rise', type: 'select', def: 'high', choices: [['high', 'High (natural waist)'], ['mid', 'Mid'], ['low', 'Low']] },
  { key: 'fit', label: 'Fit', type: 'select', def: 'regular', choices: [['fitted', 'Fitted'], ['regular', 'Regular'], ['relaxed', 'Relaxed']] },
  { key: 'stretch', label: 'Fabric stretch', type: 'select', def: '0', choices: [['0', 'None (woven)'], ['2', 'A little (2%)'], ['5', 'Stretchy (5%)']] },
];

const NEEDS = ['waist', 'hip', 'waistToHip', 'waistToKnee', 'waistToFloor', 'crotchDepth', 'crotchLength', 'knee', 'ankle', 'thigh'];

export const trousers = {
  id: 'trousers', name: 'Trousers & shorts', icon: '👖', blurb: 'Straight, slim, wide or flared trousers, capris and shorts, with a fly or elastic waist.',
  needs: NEEDS,
  title: (o) => (o.length === 'shorts' ? 'Shorts' : o.length === 'bermuda' ? 'Bermuda shorts' : `${{ straight: 'Straight', slim: 'Slim', wide: 'Wide-leg', flared: 'Flared' }[o.leg] || ''} trousers`.trim()),
  options: [
    ...common([['straight', 'Straight'], ['slim', 'Slim / tapered'], ['wide', 'Wide'], ['flared', 'Flared']], 'straight'),
    { key: 'waist', label: 'Waist', type: 'select', def: 'band', choices: [['band', 'Waistband'], ['elastic', 'Elastic (pull-on)']] },
    { key: 'closure', label: 'Opening', type: 'select', def: 'fly', choices: [['fly', 'Front fly zip']], show: (o) => o.waist !== 'elastic' },
    { key: 'pockets', label: 'Front pockets', type: 'select', def: 'slant', choices: [['none', 'None'], ['slant', 'Slant'], ['inseam', 'In-seam']] },
    { key: 'backPockets', label: 'Back pockets', type: 'select', def: 'none', choices: [['none', 'None'], ['patch', 'Patch']] },
  ],
  draft: (m, o) => draftLegs(m, { ...o, closure: o.waist === 'elastic' ? 'none' : 'fly' }),
  steps(m, o) {
    const S = ['Pre-wash and dry your fabric, then press it.', 'Print the pattern at 100% and check the test square.',
      'Recommended: sew a quick test pair (toile) and check the crotch depth, seat and length. Trousers need the most fitting of any garment.',
      'Cut out all pieces. Transfer darts, notches and the crease line (the grainline).'], notions = ['Matching thread'];
    if (o.waist !== 'elastic') S.push('Fuse interfacing to the waistband.');
    S.push('Sew the darts and press them toward the centre.');
    if (o.pockets === 'slant') S.push('Make the slant pockets: sew the pocket bag to the front pocket edge, understitch, turn, then sew the pocket facing to the bag. Baste the top and side edges in place.');
    if (o.pockets === 'inseam') S.push('Sew the pocket bags to the front and back side seams between the notches.');
    if (o.backPockets === 'patch') S.push('Hem the back pocket tops, press the edges under and topstitch them to the backs.');
    if (o.waist !== 'elastic') { S.push('Insert the fly zip: sew the centre front seam up to the fly, attach the zip to the fly extensions and the fly shield, and topstitch the curved fly line.'); notions.push(`${Math.round(legFrame(m, o).flyY - legFrame(m, o).r - 1)} cm trouser zip (or the next size up, shortened)`, 'Fusible interfacing', 'Button or hook and bar'); }
    S.push('Sew the side seams (outseams) and press them open.', 'Sew the inside leg seams (inseams), matching the knee notches. The back is eased slightly.',
      'Turn one leg right side out and put it inside the other. Sew the crotch seam in one go from front to back, then sew it again 3 mm away in the curve for strength.');
    if (o.waist === 'elastic') { S.push(`Sew the casing into a ring, attach it, and thread ${Math.round(m.waist * 0.9 + 3)} cm of elastic through.`); notions.push(`${Math.round(m.waist * 0.9 + 3)} cm of 3 cm elastic`); }
    else S.push('Attach the waistband, fold it over, stitch it down, and add a buttonhole and button (or hook and bar).');
    S.push('Try them on and pin the hem length with the shoes you will wear.', o.length === 'shorts' ? 'Hem: press up 1 cm then 2 cm and stitch.' : 'Hem: press up 4 cm, finish the edge and blind-stitch.', 'Press the crease lines and give everything a final press.');
    return { steps: S, notions, fabrics: ['Cotton twill or drill', 'Linen', 'Wool suiting', 'Tencel twill', 'Crepe (for wide legs)'] };
  },
};

export const jeans = {
  id: 'jeans', name: 'Jeans', icon: '🧵', blurb: 'Five-pocket jeans: back yoke, scoop pockets, coin pocket, fly, contoured waistband and belt loops.',
  needs: NEEDS,
  title: (o) => `${{ skinny: 'Skinny', slim: 'Slim', straight: 'Straight', bootcut: 'Bootcut', wide: 'Wide-leg' }[o.leg] || ''} jeans`.trim(),
  options: common([['skinny', 'Skinny'], ['slim', 'Slim'], ['straight', 'Straight'], ['bootcut', 'Bootcut'], ['wide', 'Wide']], 'slim').map((op) => (op.key === 'fit' ? { ...op, def: 'fitted' } : op.key === 'stretch' ? { ...op, def: '2' } : op.key === 'rise' ? { ...op, def: 'mid' } : op)),
  draft: (m, o) => draftLegs(m, { ...o, jeans: true, yoke: true, pockets: 'scoop', closure: 'fly', waist: 'band' }),
  steps(m, o) {
    const S = ['Pre-wash the denim twice in hot water (denim shrinks), then press it.', 'Print the pattern at 100% and check the test square.',
      'Recommended: make a test pair from cheap denim or twill with the same stretch, and check the crotch, seat and waist.',
      'Cut out all pieces. Mark the notches and pocket positions. Use pocketing cotton for the pocket bags.',
      'Use a denim needle (size 90–100) and topstitching thread with a longer stitch (3.5 mm).',
      'Make the coin pocket: hem the top, press the edges under, and topstitch it onto the right pocket facing.',
      'Make the front scoop pockets: sew the pocket bags to the front pocket edges, understitch, turn, and topstitch twice. Sew the pocket facings to the bags and baste the top and side edges.',
      'Insert the fly zip: sew the centre front crotch seam up to the fly, attach the zip to the fly extensions and the fly shield, and topstitch the J-shaped fly line.',
      'Sew the yokes to the backs with a flat-felled seam (or sew, overlock and topstitch twice).',
      'Sew the back crotch seam with a flat-felled seam.',
      'Make the back pockets: press the top hem, topstitch it, press the edges under, add any decorative stitching, and topstitch them to the backs (check placement on yourself first).',
      'Sew the inside leg seams (inseams) with a flat-felled seam. The back inseam is eased slightly.',
      'Try them on and fine-tune the side seams, then sew the outseams and overlock them. Topstitch the front side seam down from the waist to the pocket bottom.',
      'Sew the waistband halves together at the centre back, attach the outer band, fold the inner band over, and edge-stitch it down.',
      'Make the belt loops: fold the strip into thirds, topstitch twice, cut into 6 and bar-tack them on at the waist.',
      'Hem: press up 1.5 cm then 2 cm and topstitch.',
      'Hammer in the jeans button and add rivets at the pocket corners if you like.', 'Give everything a final press.'];
    const zip = Math.round(legFrame(m, { ...o, jeans: true }).flyY - legFrame(m, { ...o, jeans: true }).r - 1);
    return { steps: S, notions: [`${zip} cm metal jeans zip (or the next size up, shortened)`, 'Jeans button (tack button)', '6–8 rivets (optional)', 'Topstitching thread (gold or matching)', 'Regular thread', 'Pocketing cotton for the pocket bags', 'Fusible interfacing for the waistband'], fabrics: [`${o.stretch === '0' ? 'Rigid' : 'Stretch'} denim, 10–14 oz`, o.stretch === '0' ? '100% cotton denim' : '1–2% elastane denim', 'Cotton twill (for a lighter pair)'] };
  },
};
