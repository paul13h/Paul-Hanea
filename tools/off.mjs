import fs from 'fs';
import { v, q, solvePose, initialPose, refineModel, median, OneEuro, QuatFilter } from '/home/claude/paul-hanea/v2/solver.js';
import { REF, RIGID } from '/home/claude/paul-hanea/v2/face-ref.js';
const L = JSON.parse(fs.readFileSync(process.argv[2]));
const W = 540, H = 960;
function withIris(m) { const out = m.map(p => p.slice()), mid = (a, b) => [(m[a][0] + m[b][0]) / 2, (m[a][1] + m[b][1]) / 2, (m[a][2] + m[b][2]) / 2 + 4];
  const ring = c => { const r = 5.85; return [c, [c[0] + r, c[1], c[2]], [c[0], c[1] + r, c[2]], [c[0] - r, c[1], c[2]], [c[0], c[1] - r, c[2]]]; };
  return out.concat(ring(mid(33, 133)), ring(mid(263, 362))); }
const yawOf = R => { const f = q.rot(R, [0, 0, 1]); return Math.atan2(f[0], f[2]) * 57.3; };
export function run(fov, opts = {}) {
  const cam = { f: (H / 2) / Math.tan(fov * Math.PI / 360), cx: W / 2, cy: H / 2 };
  let model = withIris(REF), pose = null; const frames = [];
  const idx = opts.idx || RIGID;
  const scanEnd = opts.scanEnd ?? 260;
  for (let i = 0; i < scanEnd; i++) { const pts = L[i]; if (!pts) { pose = null; continue; }
    pose = pose ? solvePose(model, idx, pts, cam, pose, 3) : solvePose(model, idx, pts, cam, initialPose(model, pts, cam), 18);
    if (i % 2 === 0) frames.push({ pts, pose: { R: pose.R, t: pose.t }, yaw: yawOf(pose.R) }); }
  if (opts.scan !== false) {
    for (let pass = 0; pass < 2; pass++) { model = refineModel(model, frames, cam, 478, pass ? .01 : .03); for (const f of frames) f.pose = solvePose(model, idx, f.pts, cam, f.pose, 4); }
    const sizes = []; for (const f of frames) if (Math.abs(f.yaw) < 12) { const d1 = Math.hypot(f.pts[469][0] - f.pts[471][0], f.pts[469][1] - f.pts[471][1]), d2 = Math.hypot(f.pts[474][0] - f.pts[476][0], f.pts[474][1] - f.pts[476][1]); sizes.push(11.7 / (((d1 + d2) / 2) * -f.pose.t[2] / cam.f)); }
    const s = Math.max(.82, Math.min(1.18, median(sizes))); model = model.map(p => v.mul(p, s));
  }
  // evaluate on the rest
  pose = null; const rms = [], err = [];
  for (let i = scanEnd; i < L.length; i++) { const pts = L[i]; if (!pts) { pose = null; continue; }
    pose = pose ? solvePose(model, idx, pts, cam, pose, 3) : solvePose(model, idx, pts, cam, initialPose(model, pts, cam), 18);
    rms.push(pose.rms);
    const pr = p => { const r = v.add(q.rot(pose.R, p), pose.t); return [cam.cx + cam.f * r[0] / -r[2], cam.cy + cam.f * r[1] / r[2]]; };
    const e = [168, 133, 362, 6].map(k => { const a = pr(model[k]); return Math.hypot(a[0] - pts[k][0], a[1] - pts[k][1]); }); err.push(Math.max(...e)); }
  const p = (a, k) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * k)].toFixed(2); };
  return { fov, rmsMed: p(rms, .5), rmsP95: p(rms, .95), anchorErrP95: p(err, .95), ipd: v.len(v.sub(model[468], model[473])).toFixed(1), eyeW: v.len(v.sub(model[33], model[263])).toFixed(1), model, cam };
}
if (process.argv[3] === 'grid') for (const fov of [40, 50, 60, 70, 80]) for (const scan of [false, true]) { const r = run(fov, { scan }); delete r.model; delete r.cam; console.log(JSON.stringify({ scan, ...r })); }
