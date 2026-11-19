// Outfits: garments are draped one at a time, each over the body with the garments already on it.
// Those underneath stay as they are (they aren't squeezed or moved by what goes on top).
import { buildSDF } from './sdf.js';
import { outward, bandMesh } from './garment.js';

// The body (its points at pos) and the draped garments on it (under: assembled garments) as one solid
// for the next garment to lie on. F: the body's own field, for telling each piece's outside from its inside.
export function shell(body, pos, under, F) {
  // Waistbands, collars and cuffs are drawn on along an edge of the cloth (see bandMesh): they count too,
  // or a top would lie inside the waistband of the trousers under it.
  const bands = under.flatMap((s) => s.bands.map((b) => { const M = bandMesh(b), p = new Float32Array(b.verts.length * M.rows * 3); M.update(s.x, p); return { p, index: M.index }; }));
  let nv = pos.length / 3, nt = body.tris.length;
  for (const s of under) { nv += s.N; for (const I of s.inst) nt += I.pc.mesh.tris.length * 3; }
  for (const b of bands) { nv += b.p.length / 3; nt += b.index.length; }
  const P = new Float32Array(nv * 3), T = new Uint32Array(nt);
  P.set(pos); T.set(body.tris);
  let vo = pos.length / 3, to = body.tris.length;
  for (const s of under) {
    P.set(s.x, vo * 3);
    for (const I of s.inst) for (const k of outward(s, I, F)) T[to++] = vo + I.base + k;
    vo += s.N;
  }
  for (const b of bands) { // wound to face away from the body's centre line, like the cloth
    P.set(b.p, vo * 3);
    let vote = 0;
    for (let t = 0; t < b.index.length; t += 3) {
      const [A, B, C] = [0, 1, 2].map((k) => b.index[t + k] * 3), ux = b.p[B] - b.p[A], uy = b.p[B + 1] - b.p[A + 1], uz = b.p[B + 2] - b.p[A + 2], vx = b.p[C] - b.p[A], vy = b.p[C + 1] - b.p[A + 1], vz = b.p[C + 2] - b.p[A + 2];
      vote += (uy * vz - uz * vy) * b.p[A] + (ux * vy - uy * vx) * b.p[A + 2];
    }
    for (let t = 0; t < b.index.length; t += 3) { T[to++] = vo + b.index[t]; T[to++] = vo + b.index[t + (vote < 0 ? 2 : 1)]; T[to++] = vo + b.index[t + (vote < 0 ? 1 : 2)]; }
    vo += b.p.length / 3;
  }
  return buildSDF(P, T, { pads: body.pads });
}

// A garment starts out placed round the bare body, so parts of it can begin underneath a fuller garment
// already there (a top's hem inside a flared skirt). Below the bust, where what's worn is a simple shape
// round the body, each such point is moved straight out to just outside it.
export function clearOf(sys, under, body) {
  const top = body.landmarks.underbust, NB = 96, NY = Math.ceil(top) + 1, R = new Float32Array(NB * NY), wl = body.loops['waist-circ'];
  let cz = 0; for (const i of wl) cz += body.pos[i * 3 + 2]; cz /= wl.length;
  const put = (x, y, z) => {
    if (y < 0 || y >= top) return;
    const k = Math.floor(y) * NB + (Math.floor((Math.atan2(x, z - cz) / (2 * Math.PI) + 0.5) * NB) % NB), r = Math.hypot(x, z - cz);
    if (r > R[k]) R[k] = r;
  };
  for (const s of under) for (const I of s.inst) for (const t of I.pc.mesh.tris) { // corners, edge middles and the middle of every triangle
    const [a, b, c] = t.map((v) => [s.x[(I.base + v) * 3], s.x[(I.base + v) * 3 + 1], s.x[(I.base + v) * 3 + 2]]);
    for (const q of [a, b, c, [0, 1, 2].map((k) => (a[k] + b[k]) / 2), [0, 1, 2].map((k) => (b[k] + c[k]) / 2), [0, 1, 2].map((k) => (c[k] + a[k]) / 2), [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3)]) put(q[0], q[1], q[2]);
  }
  const far = (yi, bi) => { let m = 0; for (let dy = -1; dy <= 1; dy++) for (let db = -1; db <= 1; db++) { const y = yi + dy; if (y >= 0 && y < NY) m = Math.max(m, R[y * NB + (bi + db + NB) % NB]); } return m; }; // neighbours too: no gaps
  let moved = 0;
  for (let i = 0; i < sys.N; i++) {
    const x = sys.x[i * 3], y = sys.x[i * 3 + 1], z = sys.x[i * 3 + 2] - cz;
    if (y < 0 || y >= top) continue;
    const r = Math.hypot(x, z) || 1e-6, want = far(Math.floor(y), Math.floor((Math.atan2(x, z) / (2 * Math.PI) + 0.5) * NB) % NB) + 1;
    // Underneath it: out to a centimetre clear. What is already outside stays where it is.
    if (want > 1 && r < want - 1) { sys.x[i * 3] = x * want / r; sys.x[i * 3 + 2] = cz + z * want / r; moved++; }
  }
  return moved;
}
