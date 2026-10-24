// Cloth solver: XPBD with many small substeps (Macklin et al. 2019), which stays stable and
// stiff with one constraint pass per substep. Seams start open and are pulled shut over the
// first half second while gravity fades in, then the garment hangs and settles on the body.
// Self-collision: every point keeps a small gap from fabric that isn't its neighbour on the pattern
// (found with a spatial hash), so folds and layers can't pass through each other.
// ponytail: point–point only; fast-moving cloth can slip between points (fine for a settling drape).
import { sample } from './sdf.js';

// bend/stretch: softness relative to the particle masses (bigger = softer). density g/cm².
export const FABRICS = {
  denim: { name: 'Denim', density: 0.035, bend: 0.25, stretch: 0, friction: 0.5 },
  cotton: { name: 'Cotton', density: 0.015, bend: 1, stretch: 0, friction: 0.45 },
  linen: { name: 'Linen', density: 0.018, bend: 0.6, stretch: 0, friction: 0.45 },
  rayon: { name: 'Rayon / viscose', density: 0.014, bend: 5, stretch: 0, friction: 0.35 },
  chiffon: { name: 'Chiffon', density: 0.006, bend: 15, stretch: 0, friction: 0.3 },
  jersey: { name: 'Jersey knit', density: 0.018, bend: 4, stretch: 0.4, friction: 0.5 },
};

export function makeSim(sys, F, fabric = FABRICS.cotton, { thick = 0.5, sewTime = 0.5, settle = 3.2, gap = 0.9, self = true } = {}) {
  const { N } = sys, x = sys.x, prev = new Float32Array(x), v = new Float32Array(N * 3), w = new Float32Array(N);
  let wSum = 0;
  for (let i = 0; i < N; i++) { w[i] = sys.mass[i] > 0 ? 1 / (sys.mass[i] * fabric.density) : 0; wSum += w[i]; }
  const wAvg = wSum / N;
  // Constraints are solved in a shuffled order: a fixed sweep biases the cloth into diagonal ripples.
  const pack = (arr) => {
    const n = arr.length / 3, ord = Array.from({ length: n }, (_, k) => k);
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let k = n - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [ord[k], ord[j]] = [ord[j], ord[k]]; }
    return { ij: Int32Array.from(ord.flatMap((k) => [arr[k * 3], arr[k * 3 + 1]])), r: Float32Array.from(ord.map((k) => arr[k * 3 + 2])) };
  };
  const S = pack(sys.stretch), Bd = pack(sys.bend), St = pack(sys.strong || []);
  // Seams: point si sewn to the spot between sj0 and sj1 at fraction st.
  const nS = sys.seams.length, si = new Int32Array(nS), sj0 = new Int32Array(nS), sj1 = new Int32Array(nS), st = new Float32Array(nS), seam0 = new Float32Array(nS);
  const seamGap = (k) => { const i = si[k] * 3, a = sj0[k] * 3, b = sj1[k] * 3, t = st[k]; return Math.hypot(x[i] - x[a] - (x[b] - x[a]) * t, x[i + 1] - x[a + 1] - (x[b + 1] - x[a + 1]) * t, x[i + 2] - x[a + 2] - (x[b + 2] - x[a + 2]) * t); };
  sys.seams.forEach(([i, j0, j1 = j0, t = 0], k) => { si[k] = i; sj0[k] = j0; sj1[k] = j1; st[k] = t; });
  for (let k = 0; k < nS; k++) seam0[k] = seamGap(k);
  const pinI = Int32Array.from(sys.pins.map((p) => p[0])), pinX = Float32Array.from(sys.pins.flatMap((p) => p.slice(1)));
  const probe = new Float32Array(4), grip = sys.grip;
  // For self-collision: which piece each point is on, its pattern position, and what it's sewn to.
  const inst = new Int32Array(N), p2 = sys.pts2;
  sys.inst.forEach((I, k) => inst.fill(k, I.base, I.base + I.pc.mesh.pts.length));
  const deg = new Int32Array(N + 1);
  const pairs = sys.seams.flatMap(([i, j0, j1 = j0]) => (j1 === j0 ? [[i, j0]] : [[i, j0], [i, j1]]));
  for (const [i, j] of pairs) { deg[i + 1]++; deg[j + 1]++; }
  for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
  const nbr = new Int32Array(deg[N]), fillAt = deg.slice(0, N);
  for (const [i, j] of pairs) { nbr[fillAt[i]++] = j; nbr[fillAt[j]++] = i; }
  const REX = 3; // fabric within 3 cm on the pattern (or across a seam) is never pushed apart
  const near2D = (a, b) => inst[a] === inst[b] && (p2[a * 2] - p2[b * 2]) ** 2 + (p2[a * 2 + 1] - p2[b * 2 + 1]) ** 2 < REX * REX;
  const exempt = (i, j) => {
    if (near2D(i, j)) return true;
    for (let k = deg[i]; k < deg[i + 1]; k++) if (nbr[k] === j || near2D(nbr[k], j)) return true;
    for (let k = deg[j]; k < deg[j + 1]; k++) if (near2D(nbr[k], i)) return true;
    return false;
  };
  let size = 1; while (size < N * 2) size <<= 1;
  const cellStart = new Int32Array(size + 1), cellOf = new Int32Array(N), sorted = new Int32Array(N), inv = 1 / gap;
  const hash = (ix, iy, iz) => ((Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481)) >>> 0) & (size - 1);
  function selfCollide() {
    cellStart.fill(0);
    for (let i = 0; i < N; i++) { const c = hash(Math.floor(x[i * 3] * inv), Math.floor(x[i * 3 + 1] * inv), Math.floor(x[i * 3 + 2] * inv)); cellOf[i] = c; cellStart[c + 1]++; }
    for (let c = 0; c < size; c++) cellStart[c + 1] += cellStart[c];
    const at = cellStart.slice(0, size);
    for (let i = 0; i < N; i++) sorted[at[cellOf[i]]++] = i;
    const g2 = gap * gap;
    for (let i = 0; i < N; i++) {
      const ix = Math.floor(x[i * 3] * inv), iy = Math.floor(x[i * 3 + 1] * inv), iz = Math.floor(x[i * 3 + 2] * inv);
      for (let n = 0; n < 27; n++) {
        const c = hash(ix + (n % 3) - 1, iy + ((n / 3 | 0) % 3) - 1, iz + (n / 9 | 0) - 1);
        for (let q = cellStart[c], e = cellStart[c + 1]; q < e; q++) {
          const j = sorted[q];
          if (j <= i) continue;
          const ex = x[j * 3] - x[i * 3], ey = x[j * 3 + 1] - x[i * 3 + 1], ez = x[j * 3 + 2] - x[i * 3 + 2], d2 = ex * ex + ey * ey + ez * ez;
          if (d2 >= g2 || d2 < 1e-12 || exempt(i, j)) continue;
          const d = Math.sqrt(d2), wi = w[i], wj = w[j], ws = wi + wj;
          if (!ws) continue;
          const s = (gap - d) / (d * ws);
          x[i * 3] -= ex * s * wi; x[i * 3 + 1] -= ey * s * wi; x[i * 3 + 2] -= ez * s * wi;
          x[j * 3] += ex * s * wj; x[j * 3 + 1] += ey * s * wj; x[j * 3 + 2] += ez * s * wj;
        }
      }
    }
  }
  let t = 0, step = 0;

  // soft < 1 lets a link get shorter more easily than longer: gathers and eased seams bunch up
  // in pleats finer than the mesh, so squashing stands in for them.
  function distances(ij, rest, alpha, soft = 1) {
    for (let k = 0, n = rest.length; k < n; k++) {
      const i = ij[k * 2] * 3, j = ij[k * 2 + 1] * 3, wi = w[i / 3], wj = w[j / 3], ws = wi + wj + alpha;
      if (ws === 0) continue;
      const dx = x[j] - x[i], dy = x[j + 1] - x[i + 1], dz = x[j + 2] - x[i + 2], L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-9) continue;
      const C = L - rest[k], s = (C < 0 ? soft : 1) * C / (ws * L);
      x[i] += wi * s * dx; x[i + 1] += wi * s * dy; x[i + 2] += wi * s * dz;
      x[j] -= wj * s * dx; x[j + 1] -= wj * s * dy; x[j + 2] -= wj * s * dz;
    }
  }

  function substep(hs) {
    const g = 981 * smooth(sewTime * 0.6, sewTime * 1.6, t), damp = Math.exp(-(t < sewTime * 1.6 ? 12 : 1.2) * hs), vmax = 300;
    for (let i = 0; i < N; i++) {
      if (!w[i]) continue;
      const k = i * 3;
      v[k + 1] -= g * hs;
      let vx = v[k] * damp, vy = v[k + 1] * damp, vz = v[k + 2] * damp; const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (sp > vmax) { vx *= vmax / sp; vy *= vmax / sp; vz *= vmax / sp; }
      prev[k] = x[k]; prev[k + 1] = x[k + 1]; prev[k + 2] = x[k + 2];
      x[k] += vx * hs; x[k + 1] += vy * hs; x[k + 2] += vz * hs;
    }
    distances(S.ij, S.r, fabric.stretch * wAvg, 0.3);
    distances(Bd.ij, Bd.r, fabric.bend * wAvg);
    for (let it = 0; it < 10; it++) distances(St.ij, St.r, 0);
    // Seams: the allowed gap shrinks from where it started to zero while sewing; then they're held shut.
    const close = Math.max(0, 1 - t / sewTime);
    for (let pass = 0; pass < (close ? 1 : 3); pass++) for (let k = 0; k < nS; k++) {
      const i = si[k] * 3, a = sj0[k] * 3, b = sj1[k] * 3, f = st[k], g0 = 1 - f, wi = w[si[k]], wa = w[sj0[k]] * g0, wb = w[sj1[k]] * f;
      const ws = wi + wa * g0 + wb * f;
      if (!ws) continue;
      const dx = x[a] + (x[b] - x[a]) * f - x[i], dy = x[a + 1] + (x[b + 1] - x[a + 1]) * f - x[i + 1], dz = x[a + 2] + (x[b + 2] - x[a + 2]) * f - x[i + 2];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz), r = seam0[k] * close;
      if (L <= r || L < 1e-9) continue;
      const s = (L - r) / (ws * L);
      x[i] += wi * s * dx; x[i + 1] += wi * s * dy; x[i + 2] += wi * s * dz;
      x[a] -= wa * s * dx; x[a + 1] -= wa * s * dy; x[a + 2] -= wa * s * dz;
      if (b !== a) { x[b] -= wb * s * dx; x[b + 1] -= wb * s * dy; x[b + 2] -= wb * s * dz; }
    }
    if (self && t > sewTime * 0.6 && (step++ & 3) === 0) selfCollide(); // once the seams are mostly closed; every 4th substep is plenty for settling cloth
    for (let k = 0; k < pinI.length; k++) { const i = pinI[k] * 3; for (let a = 0; a < 3; a++) x[i + a] += (pinX[k * 3 + a] - x[i + a]) * 0.3; }
    // Body collision with friction.
    const mu = fabric.friction;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      if (!sample(F, x[k], x[k + 1], x[k + 2], probe) || probe[0] >= thick) continue;
      let nx = probe[1], ny = probe[2], nz = probe[3]; const gl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (gl < 1e-6) continue;
      nx /= gl; ny /= gl; nz /= gl;
      const push = thick - probe[0];
      x[k] += nx * push; x[k + 1] += ny * push; x[k + 2] += nz * push;
      const dx = x[k] - prev[k], dy = x[k + 1] - prev[k + 1], dz = x[k + 2] - prev[k + 2], dn = dx * nx + dy * ny + dz * nz;
      const f = grip && grip[i] ? 1 : mu;
      x[k] -= (dx - dn * nx) * f; x[k + 1] -= (dy - dn * ny) * f; x[k + 2] -= (dz - dn * nz) * f;
    }
    for (let i = 0; i < N; i++) if (x[i * 3 + 1] < thick) { x[i * 3 + 1] = thick; x[i * 3] = prev[i * 3]; x[i * 3 + 2] = prev[i * 3 + 2]; } // the floor
    for (let i = 0; i < N * 3; i++) v[i] = (x[i] - prev[i]) / hs;
    t += hs;
  }

  return {
    x, get t() { return t; }, get done() { return t >= settle; }, settle,
    // Advance one 60 fps frame of simulated time.
    frame(substeps = 16) { const hs = 1 / 60 / substeps; for (let s = 0; s < substeps; s++) substep(hs); },
    gap() { // largest remaining seam gap, cm
      let mx = 0;
      for (let k = 0; k < nS; k++) mx = Math.max(mx, seamGap(k));
      return mx;
    },
  };
}
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
