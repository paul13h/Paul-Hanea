// Head tracking maths: perspective pose solving, smoothing, personal face scan and nose fit.
export const v = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2])
};
export const q = {
  id: () => [0, 0, 0, 1],
  mul: (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]],
  norm: a => { const n = Math.hypot(...a) || 1; return a.map(x => x / n); },
  conj: a => [-a[0], -a[1], -a[2], a[3]],
  fromVec: w => { const t = Math.hypot(...w); if (t < 1e-9) return [w[0] / 2, w[1] / 2, w[2] / 2, 1]; const s = Math.sin(t / 2) / t; return [w[0] * s, w[1] * s, w[2] * s, Math.cos(t / 2)]; },
  rot: (a, p) => { const u = [a[0], a[1], a[2]], t = v.mul(v.cross(u, p), 2); return v.add(v.add(p, v.mul(t, a[3])), v.cross(u, t)); },
  slerp: (a, b, t) => { let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; const c = d < 0 ? b.map(x => -x) : b; d = Math.abs(d);
    if (d > .9995) return q.norm(a.map((x, i) => x + (c[i] - x) * t));
    const th = Math.acos(d), s = Math.sin(th), w1 = Math.sin((1 - t) * th) / s, w2 = Math.sin(t * th) / s; return a.map((x, i) => x * w1 + c[i] * w2); },
  angle: (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])))
};

function solve6(A, b) {
  const n = 6, L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    if (i === j) { if (s <= 0) return null; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
  }
  const y = new Array(n), x = new Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return x;
}

// Perspective pose: rotate and move the 3D face so its landmarks land on the tracked image points.
export function solvePose(model, idx, pts, cam, pose, iters = 4, weights = null) {
  let R = pose.R, t = pose.t; const { f, cx, cy } = cam;
  let rms = 0;
  for (let it = 0; it < iters; it++) {
    const A = Array.from({ length: 6 }, () => new Array(6).fill(0)), g = new Array(6).fill(0); let e2 = 0;
    const rs = []; // first pass residuals give a robust scale
    for (let k = 0; k < idx.length; k++) {
      const r = q.rot(R, model[idx[k]]), X = r[0] + t[0], Y = r[1] + t[1], Z = r[2] + t[2], iz = -1 / Z;
      const u = cx + f * X * iz, w = cy + f * Y / Z, p = pts[idx[k]], eu = p[0] - u, ew = p[1] - w;
      const n = Math.hypot(eu, ew); e2 += n * n;
      const hub = n < 2.5 ? 1 : 2.5 / n, wt = hub * (weights ? weights[k] : 1);
      const a = f * iz, b = f * X * iz * iz, c = f / Z, d = -f * Y * iz * iz;
      // derivatives for du (dX,dY,dZ) = (a,0,b); dw = (0,c,d)
      // dP = w x r + dt -> dX = wy rz - wz ry, dY = wz rx - wx rz, dZ = wx ry - wy rx
      const J = [
        [b * r[1], a * r[2] - b * r[0], -a * r[1], a, 0, b],
        [-c * r[2] + d * r[1], -d * r[0], c * r[0], 0, c, d]];
      for (let m = 0; m < 2; m++) { const e = m ? ew : eu, Jm = J[m];
        for (let i = 0; i < 6; i++) { g[i] += wt * Jm[i] * e; for (let j = 0; j <= i; j++) A[i][j] += wt * Jm[i] * Jm[j]; } }
    }
    rms = Math.sqrt(e2 / idx.length);
    for (let i = 0; i < 6; i++) { A[i][i] *= 1.001; A[i][i] += 1e-6; for (let j = i + 1; j < 6; j++) A[i][j] = A[j][i]; }
    const dx = solve6(A, g); if (!dx) break;
    R = q.norm(q.mul(q.fromVec([dx[0], dx[1], dx[2]]), R));
    t = [t[0] + dx[3], t[1] + dx[4], t[2] + dx[5]];
  }
  return { R, t, rms };
}

export function initialPose(model, pts, cam, a = 33, b = 263) {
  const px = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]), mm = v.len(v.sub(model[a], model[b]));
  const Z = -cam.f * mm / px, c = [(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2];
  return { R: q.id(), t: [(c[0] - cam.cx) * -Z / cam.f, (c[1] - cam.cy) * Z / cam.f, Z] };
}

// One Euro filter: strong smoothing at rest, almost none during quick moves.
export class OneEuro {
  constructor(minCut, beta, dCut = 1) { this.mc = minCut; this.b = beta; this.dc = dCut; this.x = null; }
  reset() { this.x = null; }
  a(c, dt) { const r = 2 * Math.PI * c * dt; return r / (r + 1); }
  filter(x, dt) {
    if (this.x === null) { this.x = x; this.dx = 0; return x; }
    const d = (x - this.x) / dt, ad = this.a(this.dc, dt); this.dx += ad * (d - this.dx);
    const c = this.mc + this.b * Math.abs(this.dx), al = this.a(c, dt); this.x += al * (x - this.x); return this.x;
  }
}
export class QuatFilter {
  constructor(minCut, beta) { this.mc = minCut; this.b = beta; this.q = null; this.sp = 0; }
  reset() { this.q = null; this.sp = 0; }
  filter(x, dt) {
    if (!this.q) { this.q = x; return x; }
    const s = q.angle(this.q, x) / dt, a0 = 2 * Math.PI * 1.2 * dt / (1 + 2 * Math.PI * 1.2 * dt); this.sp += a0 * (s - this.sp);
    const c = this.mc + this.b * this.sp, r = 2 * Math.PI * c * dt; this.q = q.norm(q.slerp(this.q, x, r / (r + 1))); return this.q;
  }
}

// Personal face scan: triangulate each landmark from several head angles.
export function refineModel(model, frames, cam, nPts = 478, prior = .02) {
  const out = [];
  for (let i = 0; i < nPts; i++) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    const p0 = model[i];
    for (const fr of frames) {
      const pt = fr.pts[i], Ri = q.conj(fr.pose.R);
      const ray = [(pt[0] - cam.cx) / cam.f, -(pt[1] - cam.cy) / cam.f, -1];
      const n = Math.hypot(...ray), d = q.rot(Ri, ray.map(x => x / n)), o = q.rot(Ri, v.mul(fr.pose.t, -1));
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const M = (r === c ? 1 : 0) - d[r] * d[c]; A[r][c] += M; b[r] += M * o[c]; }
    }
    for (let r = 0; r < 3; r++) { A[r][r] += prior * frames.length; b[r] += prior * frames.length * p0[r]; }
    const [a1, a2, a3] = A[0], [d1, e, f] = A[1], [g, h, k] = A[2];
    const det = a1 * (e * k - f * h) - a2 * (d1 * k - f * g) + a3 * (d1 * h - e * g);
    if (Math.abs(det) < 1e-12) { out.push(p0.slice()); continue; }
    const I = [[(e * k - f * h) / det, (a3 * h - a2 * k) / det, (a2 * f - a3 * e) / det],
      [(f * g - d1 * k) / det, (a1 * k - a3 * g) / det, (a3 * d1 - a1 * f) / det],
      [(d1 * h - e * g) / det, (a2 * g - a1 * h) / det, (a1 * e - a2 * d1) / det]];
    out.push([v.dot(I[0], b), v.dot(I[1], b), v.dot(I[2], b)]);
  }
  return out;
}

export function median(a) { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; }

// Where do this frame's nose pads touch this nose? Cut the nose into slices and find the contact height.
export function noseProfile(model, tris, zBack = 6) {
  const y0 = model[168][1], y1 = model[4][1], rows = [];
  for (let k = 0; k <= 40; k++) {
    const y = y0 + (y1 - y0) * k / 40, seg = [];
    for (let i = 0; i < tris.length; i += 3) {
      const t = [tris[i], tris[i + 1], tris[i + 2]], cross = [];
      for (let e = 0; e < 3; e++) { const a = model[t[e]], b = model[t[(e + 1) % 3]];
        if ((a[1] - y) * (b[1] - y) < 0) { const s = (y - a[1]) / (b[1] - a[1]); cross.push([a[0] + (b[0] - a[0]) * s, a[2] + (b[2] - a[2]) * s]); } }
      if (cross.length === 2) seg.push(cross);
    }
    const pts = seg.flat().filter(p => Math.abs(p[0]) < 24); if (!pts.length) continue;
    const zTop = Math.max(...pts.map(p => p[1])), zt = zTop - zBack;
    let lx = 0, rx = 0;
    for (const [a, b] of seg) { if ((a[1] - zt) * (b[1] - zt) <= 0) { const s = (zt - a[1]) / ((b[1] - a[1]) || 1e-6), x = a[0] + (b[0] - a[0]) * s;
      if (x < 0 && x < lx && x > -24) lx = x; if (x > 0 && x > rx && x < 24) rx = x; } }
    if (rx > 0 && lx < 0) rows.push({ y, half: (rx - lx) / 2, zTop, z: zt });
  }
  return rows;
}

export function seatOnNose(rows, padHalfX) {
  for (let i = 1; i < rows.length; i++) if (rows[i - 1].half < padHalfX && rows[i].half >= padHalfX) {
    const a = rows[i - 1], b = rows[i], s = (padHalfX - a.half) / (b.half - a.half);
    return { y: a.y + (b.y - a.y) * s, z: a.z + (b.z - a.z) * s, contact: true };
  }
  const r = rows[0] && rows[0].half >= padHalfX ? rows[0] : rows[rows.length - 1];
  return r ? { y: r.y, z: r.z, contact: false } : null;
}
