// Signed distance field of the body on a regular grid, filled only in a narrow band around
// the skin (cloth never goes deeper). Negative inside. Sign comes from the smoothed vertex
// normal at the closest point, which is robust on this closed, smooth mesh.

export function vertexNormals(pos, tris) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // area weighted
    for (const i of [a, b, c]) { n[i] += nx; n[i + 1] += ny; n[i + 2] += nz; }
  }
  // Make them point outward: compare with the direction from the body's vertical axis.
  let s = 0;
  for (let i = 0; i < n.length; i += 3) s += n[i] * pos[i] + n[i + 2] * pos[i + 2];
  const k = s < 0 ? -1 : 1;
  for (let i = 0; i < n.length; i += 3) { const L = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] *= k / L; n[i + 1] *= k / L; n[i + 2] *= k / L; }
  return n;
}

// pads: [{verts, r}] — those vertices are treated as balls of radius r (padding thin parts like fingers).
export function buildSDF(pos, tris, { cell = 1, band = 3, pads = [] } = {}) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) { x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]); z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]); }
  const pad = band + 2 * cell;
  x0 -= pad; y0 -= pad; z0 -= pad;
  const nx = Math.ceil((x1 + pad - x0) / cell) + 1, ny = Math.ceil((y1 + pad - y0) / cell) + 1, nz = Math.ceil((z1 + pad - z0) / cell) + 1;
  const d = new Float32Array(nx * ny * nz).fill(band), nrm = vertexNormals(pos, tris);
  for (let t = 0; t < tris.length; t += 3) {
    const ia = tris[t] * 3, ib = tris[t + 1] * 3, ic = tris[t + 2] * 3;
    const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2], bx = pos[ib], by = pos[ib + 1], bz = pos[ib + 2], cx = pos[ic], cy = pos[ic + 1], cz = pos[ic + 2];
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
    const gx0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - band - x0) / cell)), gx1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) + band - x0) / cell));
    const gy0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - band - y0) / cell)), gy1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) + band - y0) / cell));
    const gz0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - band - z0) / cell)), gz1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) + band - z0) / cell));
    for (let gz = gz0; gz <= gz1; gz++) for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const px = x0 + gx * cell, py = y0 + gy * cell, pz = z0 + gz * cell, idx = (gz * ny + gy) * nx + gx;
      // Closest point on triangle (Ericson, Real-Time Collision Detection 5.1.5) as barycentrics u,v,w.
      const apx = px - ax, apy = py - ay, apz = pz - az;
      const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
      let u, v, w;
      if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; } else {
        const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
        if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; } else {
          const vc = d1 * d4 - d3 * d2;
          if (vc <= 0 && d1 >= 0 && d3 <= 0) { const s = d1 / (d1 - d3); u = 1 - s; v = s; w = 0; } else {
            const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
            if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; } else {
              const vb = d5 * d2 - d1 * d6;
              if (vb <= 0 && d2 >= 0 && d6 <= 0) { const s = d2 / (d2 - d6); u = 1 - s; v = 0; w = s; } else {
                const va = d3 * d6 - d5 * d4;
                if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const s = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - s; w = s; } else {
                  const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; u = 1 - v - w;
                }
              }
            }
          }
        }
      }
      const qx = px - (u * ax + v * bx + w * cx), qy = py - (u * ay + v * by + w * cy), qz = pz - (u * az + v * bz + w * cz);
      const dist = Math.sqrt(qx * qx + qy * qy + qz * qz);
      if (dist >= Math.abs(d[idx])) continue;
      const sx = u * nrm[ia] + v * nrm[ib] + w * nrm[ic], sy = u * nrm[ia + 1] + v * nrm[ib + 1] + w * nrm[ic + 1], sz = u * nrm[ia + 2] + v * nrm[ib + 2] + w * nrm[ic + 2];
      d[idx] = qx * sx + qy * sy + qz * sz < 0 ? -dist : dist;
    }
  }
  for (const { verts, r } of pads) for (const vi of verts) {
    const px = pos[vi * 3], py = pos[vi * 3 + 1], pz = pos[vi * 3 + 2], R = r + band;
    const gx0 = Math.max(0, Math.floor((px - R - x0) / cell)), gx1 = Math.min(nx - 1, Math.ceil((px + R - x0) / cell));
    const gy0 = Math.max(0, Math.floor((py - R - y0) / cell)), gy1 = Math.min(ny - 1, Math.ceil((py + R - y0) / cell));
    const gz0 = Math.max(0, Math.floor((pz - R - z0) / cell)), gz1 = Math.min(nz - 1, Math.ceil((pz + R - z0) / cell));
    for (let gz = gz0; gz <= gz1; gz++) for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const idx = (gz * ny + gy) * nx + gx, dd = Math.hypot(x0 + gx * cell - px, y0 + gy * cell - py, z0 + gz * cell - pz) - r;
      if (dd < d[idx]) d[idx] = dd;
    }
  }
  // Cells deeper than the band are still at +band: flood the outside from the grid edges
  // through positive cells; whatever the flood can't reach is inside the body.
  const N = d.length, seen = new Uint8Array(N), q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (x && y && z && x < nx - 1 && y < ny - 1 && z < nz - 1) continue;
    const i = (z * ny + y) * nx + x; seen[i] = 1; q[qt++] = i;
  }
  const sy = nx, sz = nx * ny;
  while (qh < qt) {
    const i = q[qh++], x = i % nx, y = ((i - x) / nx) % ny, z = Math.floor(i / sz);
    for (const [j, ok] of [[i - 1, x > 0], [i + 1, x < nx - 1], [i - sy, y > 0], [i + sy, y < ny - 1], [i - sz, z > 0], [i + sz, z < nz - 1]]) if (ok && !seen[j] && d[j] > 0) { seen[j] = 1; q[qt++] = j; }
  }
  for (let i = 0; i < N; i++) if (!seen[i] && d[i] >= band) d[i] = -band;
  return { d, nx, ny, nz, x0, y0, z0, cell, band };
}

// Trilinear distance and its gradient at (px,py,pz). out = [dist, gx, gy, gz]; returns false outside the grid.
export function sample(F, px, py, pz, out) {
  const { d, nx, ny, nz, cell } = F;
  const fx = (px - F.x0) / cell, fy = (py - F.y0) / cell, fz = (pz - F.z0) / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= nx - 1 || iy >= ny - 1 || iz >= nz - 1) { out[0] = F.band; return false; }
  const tx = fx - ix, ty = fy - iy, tz = fz - iz, i = (iz * ny + iy) * nx + ix, sy = nx, sz = nx * ny;
  const c000 = d[i], c100 = d[i + 1], c010 = d[i + sy], c110 = d[i + sy + 1], c001 = d[i + sz], c101 = d[i + sz + 1], c011 = d[i + sz + sy], c111 = d[i + sz + sy + 1];
  const c00 = c000 + (c100 - c000) * tx, c10 = c010 + (c110 - c010) * tx, c01 = c001 + (c101 - c001) * tx, c11 = c011 + (c111 - c011) * tx;
  const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
  out[0] = c0 + (c1 - c0) * tz;
  out[3] = (c1 - c0) / cell;
  out[2] = ((c10 - c00) * (1 - tz) + (c11 - c01) * tz) / cell;
  out[1] = (((c100 - c000) * (1 - ty) + (c110 - c010) * ty) * (1 - tz) + ((c101 - c001) * (1 - ty) + (c111 - c011) * ty) * tz) / cell;
  return true;
}
