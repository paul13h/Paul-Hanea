// Offline replay of the page's tracking (face scan + track() from v2/app.js) on landmarks saved by dump_l.py.
// Lets tracking changes be measured in seconds instead of re-rendering a whole clip.
//   import { replay } from './replay.mjs'; const out = replay(L, { fov: 43, track: myTrack })
import { v, q, solvePose, initialPose, OneEuro, QuatFilter, refineModel, median } from '../v2/solver.js';
import { REF, RIGID as RIGID_ALL } from '../v2/face-ref.js';
export const EDGE = new Set([127, 356, 234, 454, 21, 251, 54, 284, 103, 332, 67, 297, 162, 389, 93, 323, 132, 361, 58, 288]);
export const RIGID = RIGID_ALL.filter(k => !EDGE.has(k));
export function withIris(m) {
  const out = m.map(p => p.slice()), mid = (a, b) => [(m[a][0] + m[b][0]) / 2, (m[a][1] + m[b][1]) / 2, (m[a][2] + m[b][2]) / 2 + 4];
  const ring = c => { const r = 5.85; return [c, [c[0] + r, c[1], c[2]], [c[0], c[1] + r, c[2]], [c[0] - r, c[1], c[2]], [c[0], c[1] - r, c[2]]]; };
  return out.concat(ring(mid(33, 133)), ring(mid(263, 362)));
}
export const yawOf = R => { const f = q.rot(R, [0, 0, 1]); return Math.atan2(f[0], f[2]) * 57.3; };
// positive = looking up
export const pitchOf = R => { const f = q.rot(R, [0, 0, 1]); return Math.atan2(f[1], Math.hypot(f[0], f[2])) * 57.3; };
export const project = (cam, R, t, p) => { const r = v.add(q.rot(R, p), t); return [cam.cx + cam.f * r[0] / -r[2], cam.cy + cam.f * r[1] / r[2]]; };

// the v12 tracker, as in app.js
export function makeTrackV12(ctx) {
  const rotF = new QuatFilter(2.5, 3), zF = new OneEuro(.8, .012), axF = new OneEuro(3, .5), ayF = new OneEuro(3, .5);
  const ANCHOR = [168, 6], YAW_KNEE = 22, YAW_GAIN = .55; let pose = null, lastT = 0;
  return {
    reset() { rotF.reset(); zF.reset(); axF.reset(); ayF.reset(); pose = null; },
    track(pts, tMs) {
      const { model, cam } = ctx;
      if (!pose) pose = solvePose(model, RIGID, pts, cam, initialPose(model, pts, cam), 18);
      else pose = solvePose(model, RIGID, pts, cam, pose, 3);
      if (pose.rms > 25) pose = solvePose(model, RIGID, pts, cam, initialPose(model, pts, cam), 18);
      const dt = Math.max(.008, Math.min(.1, (tMs - lastT) / 1000)); lastT = tMs;
      let Rs = rotF.filter(pose.R, dt); const z = zF.filter(pose.t[2], dt);
      const yw = yawOf(Rs), over = Math.abs(yw) - YAW_KNEE;
      if (over > 0) Rs = q.norm(q.mul(Rs, q.fromVec([0, Math.sign(yw) * YAW_GAIN * over / 57.3, 0])));
      let ax = 0, ay = 0, am = [0, 0, 0];
      for (const i of ANCHOR) { ax += pts[i][0]; ay += pts[i][1]; am = v.add(am, model[i]); }
      const n = ANCHOR.length; ax = axF.filter(ax / n, dt); ay = ayF.filter(ay / n, dt); am = v.mul(am, 1 / n);
      const r = q.rot(Rs, am), Z = r[2] + z;
      const X = (ax - cam.cx) * -Z / cam.f, Y = (ay - cam.cy) * Z / cam.f;
      return { R: Rs, t: [X - r[0], Y - r[1], z], pts, raw: pose };
    }
  };
}

export function replay(L, { fov = 43, W = 960, H = 640, makeTrack = makeTrackV12, scan = true } = {}) {
  const cam = { f: (H / 2) / Math.tan(fov * Math.PI / 360), cx: W / 2, cy: H / 2 };
  const ctx = { model: withIris(REF), cam };
  let T = makeTrack(ctx);
  const sc = { on: scan, step: 0, frames: [], t0: null, sign: 0, every: 0 };
  const out = []; let found = 0;
  const finish = () => {
    sc.on = false;
    if (sc.frames.length >= 12) {
      const fr = sc.frames;
      for (let pass = 0; pass < 2; pass++) { ctx.model = refineModel(ctx.model, fr, cam, 478, pass ? .01 : .03); for (const f of fr) f.pose = solvePose(ctx.model, RIGID, f.pts, cam, f.pose, 4); }
      const sizes = [];
      for (const f of fr) if (Math.abs(f.yaw) < 12) {
        const d1 = Math.hypot(f.pts[469][0] - f.pts[471][0], f.pts[469][1] - f.pts[471][1]), d2 = Math.hypot(f.pts[474][0] - f.pts[476][0], f.pts[474][1] - f.pts[476][1]);
        sizes.push(11.7 / (((d1 + d2) / 2) * -f.pose.t[2] / cam.f));
      }
      const s = sizes.length ? Math.max(.82, Math.min(1.18, median(sizes))) : 1; ctx.model = ctx.model.map(p => v.mul(p, s));
    }
    T.reset(); ctx.scanEndFrame = out.length;
  };
  for (let i = 0; i < L.length; i++) {
    const tMs = 1000 + i * 1000 / 30, pts = L[i];
    if (!pts) { T.reset(); found = 0; out.push({ i, face: false }); continue; }
    found++;
    const tr = T.track(pts, tMs);
    if (sc.on) {
      if (sc.t0 === null) sc.t0 = tMs; const yaw = yawOf(tr.raw.R), el = tMs - sc.t0;
      if (++sc.every % 2 === 0 && sc.frames.length < 90) sc.frames.push({ pts, pose: { R: tr.raw.R, t: tr.raw.t }, yaw });
      if (sc.step === 0) { if (el > 1000 && Math.abs(yaw) < 12) sc.step = 1; }
      else if (sc.step === 1) { if (Math.abs(yaw) > 17) { sc.sign = Math.sign(yaw); sc.step = 2; } }
      else if (sc.step === 2) { if (-sc.sign * yaw > 17) sc.step = 3; }
      else if (sc.step === 3) { if (Math.abs(yaw) < 8) finish(); }
      if (sc.on && el > 14000) finish();
      out.push({ i, face: true, scanning: true }); continue;
    }
    out.push({ i, face: true, shown: found > 4, R: tr.R, t: tr.t, raw: tr.raw, pts });
  }
  return { out, ctx };
}
