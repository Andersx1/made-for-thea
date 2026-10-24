// Bodice and sleeve blocks shared by tops and dresses.
// Coordinates: cm, y down. Back is drafted from the nape at (0,0); centre back/front at x = 0,
// side seam toward +x. Front and back share the same neck-point and underarm levels so the
// shoulder and side seams line up. A side bust dart takes up the extra front length.
import { path, segLen, bez, dist, lerp } from '../geom.js';
import { piece, rect, fold } from './common.js';

export const EASE = { fitted: [6, 2], regular: [10, 4], relaxed: [16, 10] }; // [bust, waist] total ease, cm
const rad = (d) => d * Math.PI / 180;
const unit = (a, b) => { const L = dist(a, b) || 1; return { x: (b.x - a.x) / L, y: (b.y - a.y) / L }; };
const along = (a, u, d) => ({ x: a.x + u.x * d, y: a.y + u.y * d });
const atLineY = (a, b, y) => ({ x: a.x + (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1), y });

// Key points of the block for these measurements and fit.
export function frame(m, o, { waistSeam = false } = {}) {
  const [be, we] = o.ease || EASE[o.fit] || EASE.regular, B = m.bust + be, W = m.waist + we, H = m.hip + be * 0.6;
  const bw = B / 4 - 0.75, fw = B / 4 + 0.75, nw = m.neck / 6 + 0.5, NP = { x: nw, y: -1.8 }, sl = m.shoulderLength;
  const BST = { x: NP.x + (sl + 0.5) * Math.cos(rad(18)), y: NP.y + (sl + 0.5) * Math.sin(rad(18)) }; // back shoulder eased 0.5 cm
  const FST = { x: NP.x + sl * Math.cos(rad(22)), y: NP.y + sl * Math.sin(rad(22)) };
  const SD = BST.y + m.armholeDepth + (o.armDrop ?? ({ fitted: 0.5, regular: 1.5, relaxed: 3 }[o.fit] ?? 1.5)); // underarm level
  const NW = m.backLength, WH = m.waistToHip, bpx = m.bustSpan / 2;
  const BP = { x: bpx, y: NP.y + Math.sqrt(Math.max(1, m.shoulderToBust ** 2 - (NP.x - bpx) ** 2)) };
  const dI = Math.min(7, Math.max(1.5, (m.bust - m.highBust) * 0.75)); // bust dart intake
  const FWcf = Math.max(NW + dI * 0.5, BP.y + (m.frontLength - m.shoulderToBust)); // front waist at centre front
  const relaxed = o.fit === 'relaxed' && !waistSeam, qb = bw - (W / 4 - 0.75), qf = fw - (W / 4 + 0.75);
  const side = relaxed ? Math.max(0, Math.min(qb, 1.5)) : Math.min(Math.max(qb, 0) * 0.35, 2.5);
  return {
    B, W, H, bw, fw, nw, NP, BST, FST, SD, NW, WH, BP, dI, FWcf, side,
    dartB: relaxed ? 0 : Math.max(0, qb - side), dartF: relaxed ? 0 : Math.max(0, qf - side),
    AB: { x: Math.min(m.backWidth / 2 + 0.5, bw - 2), y: (BST.y + SD) / 2 + 1 },
    AF: { x: Math.min(m.frontWidth / 2 + 0.3, fw - 3), y: (FST.y + SD) / 2 + 2 },
  };
}

export const LENGTHS = [['crop', 'Cropped'], ['waist', 'Waist'], ['hip', 'Hip'], ['tunic', 'Tunic']];
export const hemDrop = (F, len) => ({ crop: -6, waist: 0, hip: F.WH, tunic: F.WH + 18 }[len] ?? 0); // below the waist

// Necklines: [widen along shoulder, extra front depth, extra back depth]
const NECK = { round: [0.3, 0, 0], scoop: [2.5, 7, 1.5], v: [1.5, 14, 1], square: [3, 9, 1.5], sweetheart: [3, 0, 1.5], boat: [4.5, -3.5, 0.5], jacket: [1, 1.5, 0.3] };
export const NECKLINES = [['round', 'Round'], ['scoop', 'Scoop'], ['v', 'V-neck'], ['square', 'Square'], ['sweetheart', 'Sweetheart'], ['boat', 'Boat']];

// Neck edge as a chain from the neck point to centre front/back: [{to, c1?, c2?}]
export function neckChains(F, m, style) {
  const [wid, fd, bd] = NECK[style] || NECK.round;
  const npB = along(F.NP, unit(F.NP, F.BST), wid), npF = along(F.NP, unit(F.NP, F.FST), wid);
  const cfY = F.NP.y + m.neck / 6 + 2 + fd, cbY = bd;
  const back = [{ c1: { x: npB.x, y: npB.y + (cbY - npB.y) * 0.45 }, c2: { x: npB.x * 0.45, y: cbY }, to: { x: 0, y: cbY } }];
  let front;
  if (style === 'v') front = [{ to: { x: 0, y: cfY } }];
  else if (style === 'square') front = [{ to: { x: npF.x, y: cfY } }, { to: { x: 0, y: cfY } }];
  else if (style === 'sweetheart') {
    const B = F.BP;
    // Down from the shoulder, then an upward-bulging curve over the bust into the centre-front dip.
    const P1 = { x: npF.x + 0.5, y: B.y - 11 };
    front = [{ to: P1 }, { c1: { x: P1.x - 3, y: P1.y - 1.5 }, c2: { x: 3, y: B.y - 11 }, to: { x: 0, y: B.y - 4 } }];
  } else front = [{ c1: { x: npF.x, y: npF.y + (cfY - npF.y) * 0.55 }, c2: { x: npF.x * 0.55, y: cfY }, to: { x: 0, y: cfY } }];
  return { npB, npF, back, front, cfY: front[front.length - 1].to.y, cbY };
}
// Walk a chain backwards: returns segments from the chain's end back to `start`.
export function reverseChain(start, chain) {
  const pts = [start, ...chain.map((s) => s.to)], out = [];
  for (let i = chain.length - 1; i >= 0; i--) out.push(chain[i].c1 ? { c1: chain[i].c2, c2: chain[i].c1, to: pts[i] } : { to: pts[i] });
  return out;
}
export const run = (P, chain, sa, ex = {}) => { for (const s of chain) s.c1 ? P.C(s.c1, s.c2, s.to, sa, ex) : P.L(s.to.x, s.to.y, sa, ex); return P; };
const flat = (start, chain) => { const o = [start]; let a = start; for (const s of chain) { for (let k = 1; k <= 12; k++) o.push(s.c1 ? bez(a, s.c1, s.c2, s.to, k / 12) : lerp(a, s.to, k / 12)); a = s.to; } return o; };

// Split a cubic where it crosses height y: [{c1,c2,to} first part, second part]
export function splitY(a, c1, c2, b, y) {
  let t = 0, bd = Infinity;
  for (let i = 0; i <= 200; i++) { const d = Math.abs(bez(a, c1, c2, b, i / 200).y - y); if (d < bd) { bd = d; t = i / 200; } }
  const ab = lerp(a, c1, t), bc = lerp(c1, c2, t), cd = lerp(c2, b, t), abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), m = lerp(abc, bcd, t);
  return [{ c1: ab, c2: abc, to: m }, { c1: bcd, c2: cd, to: b }];
}
const rotAbout = (c, from, to) => { const a = Math.atan2(to.y - c.y, to.x - c.x) - Math.atan2(from.y - c.y, from.x - c.x), co = Math.cos(a), si = Math.sin(a); return (q) => ({ x: c.x + (q.x - c.x) * co - (q.y - c.y) * si, y: c.y + (q.x - c.x) * si + (q.y - c.y) * co }); };
const rotSeg = (R) => (sg) => (sg.c1 ? { c1: R(sg.c1), c2: R(sg.c2), to: R(sg.to) } : { to: R(sg.to) });
// Princess line below the dart tip on one side of the dart (sgn -1 = centre side, +1 = side panel).
function princessDown(tip, waistY, v, hemY, sgn) {
  if (hemY <= waistY + 0.01) { const k = (hemY - tip.y) / (waistY - tip.y); return [{ to: { x: tip.x + sgn * v * k / 2, y: hemY } }]; }
  const low = Math.min(hemY - 2, waistY + 12);
  return [{ to: { x: tip.x + sgn * v / 2, y: waistY } }, { to: { x: tip.x, y: low } }, { to: { x: tip.x, y: hemY } }];
}

// Side seam from the underarm point down to the hem, plus the waist-side point.
function sideChain(top, waistSide, hipSide, hemY) {
  if (hemY <= waistSide.y + 0.01) return [{ to: atLineY(top, waistSide, hemY) }];
  if (hemY < hipSide.y - 0.5) return [{ to: waistSide }, { to: atLineY(waistSide, hipSide, hemY) }];
  const ch = [{ to: waistSide }, { c1: { x: waistSide.x, y: waistSide.y + (hipSide.y - waistSide.y) * 0.4 }, c2: { x: hipSide.x, y: hipSide.y - (hipSide.y - waistSide.y) * 0.4 }, to: hipSide }];
  if (hemY > hipSide.y + 0.5) ch.push({ to: { x: hipSide.x + 1, y: hemY } });
  return ch;
}
// Waist dart: a V ending at the hem for short tops, a diamond ("fish-eye") for longer ones.
function waistDart(x, tipY, waistY, v, hemY) {
  if (v < 0.3) return null;
  if (hemY <= waistY + 0.01) { const k = (hemY - tipY) / (waistY - tipY); return { type: 'dart', pts: [{ x: x - v * k / 2, y: hemY }, { x, y: tipY }, { x: x + v * k / 2, y: hemY }] }; }
  const low = Math.min(hemY - 2, waistY + 12);
  return { type: 'dart', pts: [{ x, y: tipY }, { x: x - v / 2, y: waistY }, { x, y: low }, { x: x + v / 2, y: waistY }, { x, y: tipY }] };
}

function facing(key, name, np, shoulderTo, chain, centre, depth, centreEdge, cut) {
  const pts = flat(np, chain), inner = [];
  for (let i = 1; i < pts.length - 1; i++) { const u = unit(pts[i - 1], pts[i + 1]); inner.push({ x: pts[i].x + u.y * depth, y: pts[i].y - u.x * depth }); }
  const sh = along(np, unit(np, shoulderTo), depth), c = { x: centre.x, y: centre.y + depth };
  const P = path(np.x, np.y).L(sh.x, sh.y, 1.5);
  for (const q of inner.filter((q) => q.x > 0.3 && q.x < sh.x + 0.5)) P.L(q.x, q.y, 0);
  P.L(c.x, c.y, 0).L(centre.x, centre.y, centreEdge.sa, centreEdge.ex);
  return piece(key, name, run(P, reverseChain(np, chain), 1).Z(1), { cut });
}

// Front and back bodice pieces (+ neck facings or lining). o: fit, neckline, length (or hemY), closure, back, strapWidth.
export function bodicePieces(m, o, { forDress = false } = {}) {
  const F = frame(m, o, { waistSeam: forDress }), out = [], strappy = o.neckline === 'strappy'; // dresses keep waist darts to meet the skirt
  const drop = forDress ? 0 : (o.drop ?? hemDrop(F, o.length));
  const backSeam = o.closure === 'backzip' && !(strappy && o.back === 'shirred'), buttons = o.closure === 'buttons' && !strappy;
  const hemSA = forDress ? 1.5 : 2.5, ext = buttons ? 2 : 0;
  const N = neckChains(F, m, strappy ? 'round' : o.neckline), princess = o.shaping === 'princess' && !strappy;
  // ---- back ----
  const bS = { x: F.bw, y: strappy ? F.SD + 2 : F.SD }, bWS = { x: F.bw - F.side, y: F.NW }, bHS = { x: Math.max(F.H / 4 - 0.75, bWS.x), y: F.NW + F.WH };
  const bHem = F.NW + drop, bSide = sideChain(bS, bWS, bHS, bHem), bHemSide = bSide[bSide.length - 1].to;
  const bDart = waistDart(F.AB.x * 0.55, F.SD - 1, F.NW, F.dartB, bHem);
  if (strappy && o.back === 'shirred') {
    const h = F.NW - bS.y, w = F.bw * 1.8;
    out.push(rect('back', 'Shirred back', w, h, { sa: [1.5, 1.5, 1.5, 0], cut: { n: 1, fold: true }, marks: [3, 6, 9].map((y) => ({ type: 'dash', pts: [{ x: 0, y }, { x: w, y }] })) }));
    out[0].segs[3] = { sa: 0, ...fold }; out[0].cut.fold = true;
  } else if (princess) { // back princess: armhole -> through the waist dart -> hem
    const [h1, h2] = splitY(F.AB, { x: F.AB.x, y: F.AB.y + 4 }, { x: F.bw - 2.5, y: F.SD }, bS, F.AB.y + (F.SD - F.AB.y) * 0.35), PB = h1.to;
    const tip = { x: F.AB.x * 0.55, y: F.SD - 1 }, curve = { c1: { x: PB.x - 1, y: PB.y + (tip.y - PB.y) * 0.5 }, c2: { x: tip.x, y: tip.y - 3 }, to: tip };
    const left = [curve, ...princessDown(tip, F.NW, F.dartB, bHem, -1)], right = [curve, ...princessDown(tip, F.NW, F.dartB, bHem, 1)];
    const P = path(N.npB.x, N.npB.y).L(F.BST.x, F.BST.y, 1.5, { name: 'shoulder' })
      .C({ x: F.BST.x - 0.3, y: F.BST.y + 3 }, { x: F.AB.x, y: F.AB.y - 4 }, F.AB, 1, { name: 'armhole' }).C(h1.c1, h1.c2, h1.to, 1, { name: 'armhole' });
    run(P, left, 1.5, { name: 'princess' }).L(0, bHem, hemSA, { name: 'hem' }).L(0, N.cbY, backSeam ? 1.5 : 0, backSeam ? { name: 'centre' } : fold);
    out.push(piece('back', forDress ? 'Bodice centre back' : 'Centre back', run(P, reverseChain(N.npB, N.back), 1, { name: 'neck' }).Z(1), { cut: backSeam ? { n: 2, mirror: true } : { n: 1, fold: true }, grain: { a: { x: tip.x * 0.5, y: F.SD - 5 }, b: { x: tip.x * 0.5, y: Math.max(F.SD + 4, bHem - 4) } } }));
    const Q = path(PB.x, PB.y).C(h2.c1, h2.c2, h2.to, 1, { name: 'armhole' });
    run(Q, bSide, 1.5, { name: 'side' }).L(right[right.length - 1].to.x, bHem, hemSA, { name: 'hem' });
    out.push(piece('sideback', forDress ? 'Bodice side back' : 'Side back', run(Q, reverseChain(PB, right), 1.5, { name: 'princess' }).Z(1.5), { cut: { n: 2, mirror: true }, grain: { a: { x: (tip.x + F.bw) / 2, y: F.SD + 1 }, b: { x: (tip.x + F.bw) / 2, y: Math.max(F.SD + 5, bHem - 4) } } }));
  } else {
    const P = strappy ? path(0, bS.y).L(bS.x, bS.y, 1, { name: 'top' }) : run(path(N.npB.x, N.npB.y), [], 1);
    if (!strappy) {
      P.L(F.BST.x, F.BST.y, 1.5, { name: 'shoulder' })
        .C({ x: F.BST.x - 0.3, y: F.BST.y + 3 }, { x: F.AB.x, y: F.AB.y - 4 }, F.AB, 1, { name: 'armhole' })
        .C({ x: F.AB.x, y: F.AB.y + 4 }, { x: F.bw - 2.5, y: F.SD }, bS, 1, { name: 'armhole' });
    }
    run(P, bSide, 1.5, { name: 'side' }).L(0, bHem, hemSA, { name: 'hem' });
    let shape;
    if (strappy) shape = P.Z(backSeam ? 1.5 : 0, backSeam ? { name: 'centre' } : fold);
    else { P.L(0, N.cbY, backSeam ? 1.5 : 0, backSeam ? { name: 'centre' } : fold); shape = run(P, reverseChain(N.npB, N.back), 1, { name: 'neck' }).Z(1); }
    const marks = [bDart].filter(Boolean);
    if (strappy) marks.push({ type: 'line', pts: [{ x: F.AB.x * 0.65 - (o.strapWidth || 2.5) / 2, y: bS.y + 0.2 }, { x: F.AB.x * 0.65 + (o.strapWidth || 2.5) / 2, y: bS.y + 0.2 }] }, { type: 'text', pts: [{ x: F.AB.x * 0.65, y: bS.y + 1.6 }], text: 'strap' });
    out.push(piece('back', forDress ? 'Bodice back' : 'Back', shape, { cut: backSeam ? { n: 2, mirror: true } : { n: 1, fold: true }, marks, notches: backSeam ? [{ x: 0, y: forDress ? F.NW : Math.min(bHem, F.NW) }] : [], grain: { a: { x: F.bw * 0.45, y: F.SD - 5 }, b: { x: F.bw * 0.45, y: Math.max(F.SD + 4, bHem - 4) } } }));
  }
  // ---- front ---- (front waist slopes from the centre front down to the side, which is dI lower than the back)
  const fS = { x: F.fw, y: strappy ? F.SD + 2 : F.SD }, fWS = { x: F.fw - F.side, y: F.NW + F.dI }, fHS = { x: Math.max(F.H / 4 + 0.75, fWS.x), y: F.NW + F.dI + F.WH };
  const fHemSide = F.NW + F.dI + drop, fHemCF = F.FWcf + drop, fSide = sideChain(fS, fWS, fHS, fHemSide);
  const waistYat = (x) => F.FWcf + (fWS.y - F.FWcf) * (x / fWS.x);
  const T = { x: F.BP.x + 2.5, y: F.BP.y + 1 }, l1 = atLineY(fS, fWS, Math.max(fS.y + 3, T.y - F.dI / 2)), l2 = atLineY(fS, fWS, l1.y + F.dI);
  const fMarks = [{ type: 'dart', pts: [l1, T, l2] }, waistDart(F.BP.x, F.BP.y + 2.5, waistYat(F.BP.x), F.dartF, fHemCF + (fHemSide - fHemCF) * F.BP.x / F.fw)].filter(Boolean);
  let fShape, cfTop;
  if (strappy) {
    const sw = o.strapWidth || 2.5, top = F.BP.y - 12, SI = { x: F.BP.x - sw / 2, y: top }, SO = { x: F.BP.x + sw / 2, y: top };
    cfTop = F.BP.y - 7;
    const P = path(0, cfTop).C({ x: F.BP.x * 0.5, y: cfTop }, { x: SI.x - 1, y: top + 1 }, SI, 1, { name: 'top' }).L(SO.x, SO.y, 1, { name: 'top' })
      .C({ x: SO.x + 3, y: top + 1 }, { x: F.fw - 3, y: fS.y }, fS, 1, { name: 'top' });
    run(P, fSide, 1.5, { name: 'side' }).L(0, fHemCF, hemSA, { name: 'hem' });
    fShape = P.Z(0, fold);
    fMarks.push({ type: 'text', pts: [{ x: F.BP.x, y: top + 1.6 }], text: 'strap' });
  } else {
    cfTop = N.cfY;
    const P = path(-ext, cfTop);
    if (ext) P.L(0, cfTop, 1, { name: 'neck' });
    run(P, reverseChain(N.npF, N.front), 1, { name: 'neck' }).L(F.FST.x, F.FST.y, 1.5, { name: 'shoulder' })
      .C({ x: F.FST.x - 0.5, y: F.FST.y + 3 }, { x: F.AF.x, y: F.AF.y - 4 }, F.AF, 1, { name: 'armhole' })
      .C({ x: F.AF.x, y: F.AF.y + 4 }, { x: F.fw - 3.5, y: F.SD }, fS, 1, { name: 'armhole' });
    run(P, fSide, 1.5, { name: 'side' }).L(-ext, fHemCF, hemSA, { name: 'hem' });
    fShape = P.Z(ext ? 1 : 0, ext ? { name: 'centre' } : fold);
    if (buttons) for (let y = cfTop + 1.5; y < fHemCF - 4; y += 9) fMarks.push({ type: 'button', pts: [{ x: 0, y }] });
  }
  if (princess) { // front princess through the bust point; the side panel's lower part swings round the bust point to close the bust dart
    const hemAt = (x) => fHemCF + (fHemSide - fHemCF) * x / F.fw, BP = F.BP, hy = hemAt(BP.x);
    const [g1, g2] = splitY(F.AF, { x: F.AF.x, y: F.AF.y + 4 }, { x: F.fw - 3.5, y: F.SD }, fS, F.AF.y + (F.SD - F.AF.y) * 0.3), PA = g1.to;
    const curve = { c1: { x: PA.x - 1, y: PA.y + (BP.y - PA.y) * 0.5 }, c2: { x: BP.x, y: BP.y - 3 }, to: BP };
    const left = [curve, ...princessDown(BP, waistYat(BP.x), F.dartF, hy, -1)];
    const P = path(-ext, cfTop);
    if (ext) P.L(0, cfTop, 1, { name: 'neck' });
    run(P, reverseChain(N.npF, N.front), 1, { name: 'neck' }).L(F.FST.x, F.FST.y, 1.5, { name: 'shoulder' })
      .C({ x: F.FST.x - 0.5, y: F.FST.y + 3 }, { x: F.AF.x, y: F.AF.y - 4 }, F.AF, 1, { name: 'armhole' }).C(g1.c1, g1.c2, g1.to, 1, { name: 'armhole' });
    run(P, left, 1.5, { name: 'princess' }).L(-ext, fHemCF, hemSA, { name: 'hem' });
    const cfMarks = fMarks.filter((mk) => mk.type === 'button');
    out.push(piece('front', forDress ? 'Bodice centre front' : 'Centre front', P.Z(ext ? 1 : 0, ext ? { name: 'centre' } : fold), { cut: buttons ? { n: 2, mirror: true } : { n: 1, fold: true }, marks: cfMarks, grain: { a: { x: BP.x * 0.45, y: F.SD - 3 }, b: { x: BP.x * 0.45, y: hemAt(0) - 4 } } }));
    const R = rotAbout(BP, l2, l1), right = [curve, ...princessDown(BP, waistYat(BP.x), F.dartF, hy, 1).map(rotSeg(R))];
    const fRest = [{ to: fSide[0].to }, ...fSide.slice(1)].map(rotSeg(R)); // side seam below the closed dart
    const Q = path(PA.x, PA.y).C(g2.c1, g2.c2, g2.to, 1, { name: 'armhole' }).L(l1.x, l1.y, 1.5, { name: 'side' });
    run(Q, fRest, 1.5, { name: 'side' }).L(right[right.length - 1].to.x, right[right.length - 1].to.y, hemSA, { name: 'hem' });
    const gx = (BP.x + F.fw) / 2;
    out.push(piece('sidefront', forDress ? 'Bodice side front' : 'Side front', run(Q, reverseChain(PA, right), 1.5, { name: 'princess' }).Z(1.5), { cut: { n: 2, mirror: true }, grain: { a: R({ x: gx, y: F.SD + 3 }), b: R({ x: gx, y: Math.max(F.SD + 7, fHemSide - 4) }) } }));
  } else out.push(piece('front', forDress ? 'Bodice front' : 'Front', fShape, { cut: buttons ? { n: 2, mirror: true } : { n: 1, fold: true }, marks: fMarks, grain: { a: { x: F.fw * 0.6, y: F.SD - 3 }, b: { x: F.fw * 0.6, y: fHemSide - 4 } } }));
  // ---- finishing pieces ----
  if (strappy) {
    const len = o.strapLength, sw = o.strapWidth || 2.5;
    out.push(rect('strap', 'Strap', sw * 2, len, { sa: [1, 1, 1, 1], cut: { n: 2 }, marks: [{ type: 'dash', pts: [{ x: sw, y: 0 }, { x: sw, y: len }] }] }));
    out.push({ ...structuredClone(out.find((p) => p.key === 'front')), key: 'liningfront', name: 'Bodice lining front' });
    if (o.back !== 'shirred') out.push({ ...structuredClone(out.find((p) => p.key === 'back')), key: 'liningback', name: 'Bodice lining back' });
  } else if (o.neckFinish !== 'binding') {
    out.push(facing('facingfront', 'Front neck facing', N.npF, F.FST, N.front, { x: 0, y: N.cfY }, 6, buttons ? { sa: 1 } : { sa: 0, ex: fold }, buttons ? { n: 2, mirror: true } : { n: 1, fold: true }));
    out.push(facing('facingback', 'Back neck facing', N.npB, F.BST, N.back, { x: 0, y: N.cbY }, 6, backSeam ? { sa: 1.5 } : { sa: 0, ex: fold }, backSeam ? { n: 2, mirror: true } : { n: 1, fold: true }));
  }
  return { pieces: out, F };
}

// Total armhole length (front + back) to fit the sleeve to.
export const armholeLen = (pieces) => pieces.filter((p) => ['front', 'back', 'sidefront', 'sideback', 'frontyoke', 'backyoke'].includes(p.key))
  .reduce((a, p) => a + p.segs.reduce((s, sg, i) => s + (sg.name === 'armhole' ? segLen(p, i) : 0), 0), 0);

export const SLEEVES = [['none', 'Sleeveless'], ['cap', 'Cap'], ['short', 'Short'], ['puff', 'Puff'], ['flutter', 'Flutter'], ['elbow', 'Elbow'], ['threequarter', '¾'], ['long', 'Long']];
// Set-in sleeve. The cap height is solved so the cap seam is the armhole + ease.
export function sleevePiece(m, o, AH) {
  const s = o.sleeve, puff = s === 'puff', flutter = s === 'flutter';
  const w = m.bicep + (o.sleeveEase ?? ({ fitted: 4, regular: 6, relaxed: 10 }[o.fit] ?? 6)) + (puff ? 12 : 0);
  const capEase = puff ? 10 : flutter ? 3 : 2.5;
  const cap = (h) => {
    const P = path(-w / 2, h).C({ x: -w / 2 + w * 0.18, y: h * 0.95 }, { x: -w * 0.18, y: 0 }, { x: 0, y: 0 }, 1).C({ x: w * 0.2, y: 0 }, { x: w / 2 - w * 0.16, y: h * 0.95 }, { x: w / 2, y: h }, 1).Z(1);
    return P;
  };
  let lo = 4, hi = 30;
  for (let i = 0; i < 40; i++) { const h = (lo + hi) / 2, c = cap(h); if (segLen(c, 0) + segLen(c, 1) < AH + capEase) lo = h; else hi = h; }
  const h = (lo + hi) / 2;
  const L = o.sleeveLen ?? { cap: h + 4, short: h + 13, puff: h + 12, flutter: h + 10, elbow: m.armLength * 0.58, threequarter: m.armLength * 0.78, long: m.armLength + 1.5 }[s];
  const hw = o.sleeveHem ?? { cap: w - 1, short: w - 3, puff: w, flutter: w * 1.6, elbow: m.elbow + 8, threequarter: (m.elbow + m.wrist) / 2 + 8, long: m.wrist + 12 }[s];
  const P = path(-w / 2, h).C({ x: -w / 2 + w * 0.18, y: h * 0.95 }, { x: -w * 0.18, y: 0 }, { x: 0, y: 0 }, 1, { name: 'cap' })
    .C({ x: w * 0.2, y: 0 }, { x: w / 2 - w * 0.16, y: h * 0.95 }, { x: w / 2, y: h }, 1, { name: 'cap' })
    .L(hw / 2, L, 1.5, { name: 'underarm' }).L(-hw / 2, L, flutter ? 1 : 2.5, { name: 'hem' }).Z(1.5, { name: 'underarm' });
  const fN = bez({ x: -w / 2, y: h }, { x: -w / 2 + w * 0.18, y: h * 0.95 }, { x: -w * 0.18, y: 0 }, { x: 0, y: 0 }, 0.45);
  const bN = (t) => bez({ x: 0, y: 0 }, { x: w * 0.2, y: 0 }, { x: w / 2 - w * 0.16, y: h * 0.95 }, { x: w / 2, y: h }, t);
  const marks = [{ type: 'text', pts: [{ x: -w * 0.3, y: h + 4 }], text: 'front' }, { type: 'text', pts: [{ x: w * 0.3, y: h + 4 }], text: 'back' }];
  return { p: piece('sleeve', 'Sleeve', P, { cut: { n: 2, mirror: true }, marks, notches: [{ x: 0, y: 0 }, fN, bN(0.52), bN(0.6)], grain: { a: { x: 0, y: h + 2 }, b: { x: 0, y: L - 3 } } }), capLen: segLen(P, 0) + segLen(P, 1), h, w, L };
}

// Straps for "ties" use a separate long rectangle; everything else is shared.
export const tieStrap = (len, w) => rect('tie', 'Shoulder tie', w * 2, len, { sa: [1, 1, 1, 1], cut: { n: 4 }, marks: [{ type: 'dash', pts: [{ x: w, y: 0 }, { x: w, y: len }] }] });
export { lerp };
