// Fit map: where the draped cloth is pulled tight round the body and where it hangs loose.
// Tight = the fabric's links are stretched past their pattern length (it is too small there);
// loose = it hangs away from the skin. A guide to where to let out or take in, like the drape itself.
import { sample } from './sdf.js';

// Stretch round the body where "tight" starts and where it is fully red. In the simulation cloth sits
// half a centimetre off the skin, so it goes about 3 cm further round than on a real body: that alone
// stretches a close fit by 3%, so tight starts above it.
const T0 = 0.03, T1 = 0.1;
const NEAR = 1.2; // cm from the skin: closer than this is "just right"

// How much each cloth point is stretched round the body (0.05 = 5% longer than on the pattern),
// evened out over its neighbours.
export function strain(sys) {
  const { N, x, stretch: S } = sys, n = S.length / 3, wsum = new Float32Array(N), deg = new Float32Array(N);
  let e = new Float32Array(N);
  if (!sys.fitOf) { // per point: 1 sewn into a seam, 2 on a sleeve
    sys.fitOf = new Uint8Array(N);
    for (const [i, j0, j1] of sys.seams) sys.fitOf[i] |= 1, sys.fitOf[j0] |= 1, sys.fitOf[j1] |= 1;
    for (const I of sys.inst) if (I.frame === 'sleeve') for (let i = I.base, end = I.base + I.pc.mesh.pts.length; i < end; i++) sys.fitOf[i] |= 2;
  }
  const of = sys.fitOf;
  for (let k = 0; k < n; k++) {
    const i = S[k * 3], j = S[k * 3 + 1];
    deg[i]++; deg[j]++;
    // Links that run along a seam are left out: sewing an edge to a longer or shorter one (easing,
    // gathering, a closed dart) stretches them however well the garment fits.
    if (of[i] & of[j] & 1) continue;
    const dy = x[i * 3 + 1] - x[j * 3 + 1], L = Math.hypot(x[i * 3] - x[j * 3], dy, x[i * 3 + 2] - x[j * 3 + 2]) || 1e-9, s = L / S[k * 3 + 2] - 1;
    // Only stretch going round the body counts. Up-and-down pull is the garment's own weight hanging
    // from the shoulders or the waist seam, not a pattern that's too small. (Sleeves slope, so all of theirs counts.)
    const w = of[i] & 2 ? 1 : 1 - (dy / L) ** 2;
    e[i] += s * w; e[j] += s * w; wsum[i] += w; wsum[j] += w;
  }
  for (let i = 0; i < N; i++) e[i] /= wsum[i] || 1;
  for (let pass = 0; pass < 2; pass++) { // averaged with the neighbours, so single pulled points (a pin, a dart tip) don't speckle
    const sum = Float32Array.from(e);
    for (let k = 0; k < n; k++) { const i = S[k * 3], j = S[k * 3 + 1]; sum[i] += e[j]; sum[j] += e[i]; }
    for (let i = 0; i < N; i++) sum[i] /= deg[i] + 1;
    e = sum;
  }
  return e;
}

// One number per cloth point: 0 just right, up to +1 tight, down to -1 loose.
export function fitMap(sys, F, out = new Float32Array(sys.N), t0 = T0, t1 = T1) {
  const { N, x } = sys, e = strain(sys), probe = [0, 0, 0, 0], far = F.band - 0.2;
  for (let i = 0; i < N; i++) {
    if (e[i] > t0) { out[i] = Math.min(1, (e[i] - t0) / (t1 - t0)); continue; }
    sample(F, x[i * 3], x[i * 3 + 1], x[i * 3 + 2], probe);
    out[i] = -Math.max(0, Math.min(1, (probe[0] - NEAR) / (far - NEAR)));
  }
  return out;
}

// Parts of the body where a good share of the cloth is clearly tight, top to bottom.
// L = the body's landmarks (heights of the bust, waist, hip…).
// min / part: how tight a point must be to count, and what share of the zone must be. Set so drafted
// garments in their own size name nothing, and a skirt 8 cm too small round the hips names the hips.
export function tightZones(sys, fit, L, min = 0.5, part = 0.3) {
  const Z = [['sleeves', 0, 0], ['shoulders', L.bust + 8, Infinity], ['bust', L.underbust, L.bust + 8], ['waist', (L.waist + L.hip) / 2, L.underbust], ['hips', L.crotch, (L.waist + L.hip) / 2], ['thighs', L.knee, L.crotch], ['lower legs', -Infinity, L.knee]];
  const all = Z.map(() => 0), tight = Z.map(() => 0), S = sys.stretch;
  // The waist edge is held on the body at set spots, which pulls at the cloth right beside it
  // whatever the fit, so that edge and the points next to it don't count.
  const held = new Uint8Array(sys.N), pinned = new Uint8Array(sys.N);
  for (const [i] of sys.pins) pinned[i] = held[i] = 1;
  for (let k = 0; k < S.length; k += 3) if (pinned[S[k]] || pinned[S[k + 1]]) held[S[k]] = held[S[k + 1]] = 1;
  for (const I of sys.inst) for (let i = I.base, e = I.base + I.pc.mesh.pts.length; i < e; i++) {
    if (held[i]) continue;
    const y = sys.x[i * 3 + 1], z = I.frame === 'sleeve' ? 0 : Z.findIndex((q, k) => k && y >= q[1] && y < q[2]);
    if (z < 0) continue;
    all[z]++; if (fit[i] >= min) tight[z]++;
  }
  return Z.map((q) => q[0]).filter((_, z) => all[z] >= 30 && tight[z] / all[z] >= part);
}
