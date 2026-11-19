// Carrying a drape over to a changed garment. After a pattern edit the pieces are meshed afresh, so the
// cloth's points are new; each takes its place from the same spot on the old piece's draped cloth. The
// drape then only has to settle the change, instead of being sewn and hung from scratch.

// old, sys: assembled garments (see assemble); old.x holds the finished drape.
// Returns the starting positions for sys, or null if the two don't have the same pieces.
export function carryOver(old, sys) {
  if (!old || old.inst.length !== sys.inst.length) return null;
  const out = new Float32Array(sys.N * 3);
  for (let n = 0; n < sys.inst.length; n++) {
    const I = sys.inst[n], J = old.inst[n];
    if (I.key !== J.key || I.k !== J.k || I.frame !== J.frame || I.mirror !== J.mirror) return null;
    const P = I.pc.mesh.pts, Q = J.pc.mesh.pts, T = J.pc.mesh.tris;
    if (!T.length) return null;
    // The old piece's triangles, sorted into a grid of 4 cm squares for looking up.
    const C = 4, grid = new Map(), cell = (x, y) => `${Math.floor(x / C)},${Math.floor(y / C)}`;
    T.forEach((t, k) => {
      const xs = t.map((v) => Q[v].x), ys = t.map((v) => Q[v].y);
      for (let gx = Math.floor(Math.min(...xs) / C); gx <= Math.floor(Math.max(...xs) / C); gx++) for (let gy = Math.floor(Math.min(...ys) / C); gy <= Math.floor(Math.max(...ys) / C); gy++) { const key = `${gx},${gy}`; (grid.get(key) || grid.set(key, []).get(key)).push(k); }
    });
    const weigh = (t, p) => { // where p lies in triangle t (u, v, 1 - u - v) and how far outside (0 = inside)
      const a = Q[t[0]], b = Q[t[1]], c = Q[t[2]], den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y) || 1e-9;
      const u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / den, v = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / den;
      return { t, u, v, out: Math.max(0, -u, -v, u + v - 1) };
    };
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      let best = null;
      for (const k of grid.get(cell(p.x, p.y)) || []) { const r = weigh(T[k], p); if (!best || r.out < best.out) best = r; if (!r.out) break; }
      // Past the old piece's edge (the piece grew): the old triangle with the nearest corner, carried on outwards.
      if (!best || best.out > 0) {
        let near = null, nd = Infinity;
        for (const t of T) for (const v of t) { const d = (Q[v].x - p.x) ** 2 + (Q[v].y - p.y) ** 2; if (d < nd) { nd = d; near = t; } }
        const r = weigh(near, p);
        if (!best || r.out < best.out) best = r;
      }
      // New cloth lies on in the plane of the edge it grew from, at its full length: bunched up at the old edge
      // it would stay crumpled. (Held to a couple of hand's widths, in case that triangle is folded oddly.)
      const cl = (k) => Math.max(-12, Math.min(13, k)), u = cl(best.u), v = cl(best.v), w = [u, v, 1 - u - v];
      for (let a = 0; a < 3; a++) out[(I.base + i) * 3 + a] = w[0] * old.x[(J.base + best.t[0]) * 3 + a] + w[1] * old.x[(J.base + best.t[1]) * 3 + a] + w[2] * old.x[(J.base + best.t[2]) * 3 + a];
    }
  }
  return out.every(Number.isFinite) ? out : null;
}

// Carry a draped garment along with a pose: each cloth point goes where the limb it lies on goes
// (move: see poser in body.js). Trouser legs go with their own leg; cloth that hangs between the legs
// goes with both, half and half in the middle. Returns the new positions; the drape then has to settle.
export function carry(sys, move) {
  const out = new Float32Array(sys.N * 3), q = [0, 0, 0];
  for (const I of sys.inst) for (let i = I.base, e = I.base + I.pc.mesh.pts.length; i < e; i++) {
    move(sys.x[i * 3], sys.x[i * 3 + 1], sys.x[i * 3 + 2], q, I.frame !== 'legs');
    out[i * 3] = q[0]; out[i * 3 + 1] = q[1]; out[i * 3 + 2] = q[2];
  }
  return out;
}
