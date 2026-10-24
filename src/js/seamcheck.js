// "Walk the seams": compares the lengths of edges that get sewn together, using the pieces as
// they are now (so hand edits are checked too). Each check: [label, a, b, lo, hi] where a − b should
// fall between lo and hi (cm).
import { segLen, dist } from './geom.js';

export function seamChecks(g, m) {
  const P = (k) => g.pieces.find((p) => p.key === k);
  const len = (k, ...names) => { const p = P(k); return p ? p.segs.reduce((a, s, i) => a + (names.includes(s.name) ? segLen(p, i) : 0), 0) : 0; };
  const has = (k) => !!P(k);
  // Waist darts whose legs sit on the given edge level (V darts ending on the edge, not diamonds).
  const darts = (k) => { const p = P(k); return p ? p.marks.filter((mk) => mk.type === 'dart' && mk.pts.length === 3 && Math.abs(mk.pts[0].y - mk.pts[2].y) < 1.5).reduce((a, mk) => a + dist(mk.pts[0], mk.pts[2]), 0) : 0; };
  const bustDart = () => { const p = P('front'); const d = p?.marks.find((mk) => mk.type === 'dart' && mk.pts.length === 3); return d ? dist(d.pts[0], d.pts[2]) : 0; };
  const C = [];
  if (g.type === 'skirt' && has('front') && has('back')) C.push(['Side seams (front vs back)', len('front', 'side'), len('back', 'side'), -0.4, 0.4]);
  if (g.type === 'top' || g.type === 'dress') {
    if (has('front') && has('back') && g.options.neckline !== 'strappy') {
      C.push(['Side seams, bust dart sewn (front vs back)', len('front', 'side') + len('sidefront', 'side') - (has('sidefront') ? 0 : bustDart()), len('back', 'side') + len('sideback', 'side'), -0.6, 0.6]);
      if (has('sidefront')) C.push(['Front princess seams', len('front', 'princess'), len('sidefront', 'princess'), -0.4, 0.4]);
      if (has('sideback')) C.push(['Back princess seams', len('back', 'princess'), len('sideback', 'princess'), -0.4, 0.4]);
      C.push(['Shoulder seams (back eases onto front)', len('back', 'shoulder'), len('front', 'shoulder'), 0.2, 0.8]);
    }
    if (has('sleeve')) C.push(['Sleeve cap vs armhole (ease)', len('sleeve', 'cap'), ['front', 'back', 'sidefront', 'sideback'].reduce((a, k) => a + len(k, 'armhole'), 0), g.options.sleeve === 'puff' ? 5 : 1.2, g.options.sleeve === 'puff' ? 16 : 4.5]);
    if (g.type === 'dress' && has('skirtfront') && !['gathered'].includes(g.options.skirtStyle) && g.options.back !== 'shirred') {
      const fold = (k) => (P(k)?.cut.fold ? 2 : P(k)?.cut.n || 2);
      const overlap = g.options.closure === 'buttons' ? 4 : 0; // the two 2 cm button stands lie on top of each other
      const bod = ['front', 'back', 'sidefront', 'sideback'].filter(has).reduce((a, k) => a + fold(k) * (len(k, 'hem') - darts(k)), 0) - overlap;
      const sk = g.options.skirtStyle === 'circle' ? len('skirtpanel', 'waist') * P('skirtpanel').cut.n : fold('skirtfront') * (len('skirtfront', 'waist') - darts('skirtfront')) + fold('skirtback') * (len('skirtback', 'waist') - darts('skirtback'));
      C.push(['Waist seam (bodice vs skirt)', bod, sk, -2, 2]);
    }
  }
  if (g.type === 'jacket' && has('front')) {
    C.push(['Side seams (front vs back)', len('sidefront', 'side'), len('sideback', 'side'), -0.4, 0.4]);
    C.push(['Front panel seams', len('front', 'panel'), len('sidefront', 'panel'), -0.3, 0.3]);
    C.push(['Back panel seams', len('back', 'panel'), len('sideback', 'panel'), -0.3, 0.3]);
    C.push(['Front yoke seam', len('frontyoke', 'yoke'), len('front', 'yoke') + len('sidefront', 'yoke'), -0.3, 0.3]);
    C.push(['Back yoke seam (yoke on fold vs centre + side)', len('backyoke', 'yoke'), len('back', 'yoke') + len('sideback', 'yoke'), -0.3, 0.3]);
    C.push(['Shoulder seams (back eases onto front)', len('backyoke', 'shoulder'), len('frontyoke', 'shoulder'), 0.2, 0.8]);
    C.push(['Sleeve cap vs armhole (ease)', len('sleeve', 'cap'), ['frontyoke', 'sidefront', 'backyoke', 'sideback'].reduce((a, k) => a + len(k, 'armhole'), 0), 1.2, 4.5]);
    C.push(['Collar stand vs neckline (half)', len('stand', 'neck'), len('frontyoke', 'neck') + len('backyoke', 'neck'), -0.5, 0.5]);
  }
  if (g.type === 'trousers' || g.type === 'jeans') {
    C.push(['Inside leg seams (front vs back)', len('front', 'inseam'), len('back', 'inseam'), -0.3, 1.5]);
    C.push(['Outside leg seams (front vs back)', len('front', 'side') + len('facing', 'side'), len('back', 'side') + len('yoke', 'side'), -1, 1]);
    if (has('yoke')) C.push(['Yoke seam (yoke vs back)', len('yoke', 'yoke'), len('back', 'yoke'), -0.5, 0.5]);
    const crotch = len('front', 'centre', 'crotch', 'fly') + len('back', 'centre', 'crotch') + len('yoke', 'centre');
    const drop = { high: 0, mid: 4, low: 8 }[g.options.rise] ?? 0; // a lower rise shortens the seam at both ends
    const roomy = { fitted: 10, regular: 12, relaxed: 16 }[g.options.fit] ?? 12; // looser fits get a longer, roomier crotch
    if (m?.crotchLength) C.push(['Crotch seam vs your crotch length (ease)', crotch, m.crotchLength - 2 * drop, -6, roomy]);
  }
  return C.map(([label, a, b, lo, hi]) => ({ label, a, b, diff: a - b, ok: a - b >= lo && a - b <= hi, lo, hi }));
}
