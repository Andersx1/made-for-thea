// Geometry for tracing paper patterns from photos.

// Homography mapping 4 source points to 4 destination points (solves the standard 8×8 system).
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) { // Gaussian elimination with partial pivoting
    let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null; // three corners in a line
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
export function applyH(H, p) { const w = H[6] * p.x + H[7] * p.y + H[8]; return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w }; }

// Image pixels → cm, from a calibration: { mode: 'scale', a, b, real } or { mode: 'rect', corners[4] (TL,TR,BR,BL), w, h }.
export function toCm(cal) {
  if (cal?.mode === 'rect' && cal.corners?.length === 4 && cal.w > 0 && cal.h > 0) {
    const H = homography(cal.corners, [{ x: 0, y: 0 }, { x: cal.w, y: 0 }, { x: cal.w, y: cal.h }, { x: 0, y: cal.h }]);
    if (H) return (p) => applyH(H, p);
  }
  if (cal?.mode === 'scale' && cal.a && cal.b && cal.real > 0) {
    const s = cal.real / Math.hypot(cal.b.x - cal.a.x, cal.b.y - cal.a.y);
    return (p) => ({ x: p.x * s, y: p.y * s });
  }
  return null;
}

// Closed outline through clicked points → {nodes, segs}. Smooth uses Catmull-Rom curves;
// points marked as corners stay sharp (a segment between two corners is straight).
export function traceShape(pts, { smooth = true, sa = 1.5 } = {}) {
  const n = pts.length, nodes = pts.map((p) => ({ x: p.x, y: p.y })), segs = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    if (!smooth || (p1.corner && p2.corner)) { segs.push({ sa }); continue; }
    const c1 = p1.corner ? { x: p1.x, y: p1.y } : { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = p2.corner ? { x: p2.x, y: p2.y } : { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    segs.push({ sa, c1, c2 });
  }
  return { nodes, segs };
}
