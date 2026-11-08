import fs from 'fs';
import { run } from './off.mjs';
import { v, q, solvePose, initialPose, OneEuro, QuatFilter } from '/home/claude/paul-hanea/v2/solver.js';
import { RIGID } from '/home/claude/paul-hanea/v2/face-ref.js';
const L0 = JSON.parse(fs.readFileSync(process.argv[2]));
// reference: centred 5-frame average of the detections, so detector noise is not counted as error
const L = L0, G = L0.map((p, i) => { if (!p) return null; const nb = [-2, -1, 0, 1, 2].map(d => L0[i + d]).filter(Boolean); return p.map((_, k) => [nb.reduce((s, x) => s + x[k][0], 0) / nb.length, nb.reduce((s, x) => s + x[k][1], 0) / nb.length]); });
const base = run(60, {});
const { model, cam } = base;
function evalv(name, o) {
  const rotF = new QuatFilter(o.rmc ?? 1.1, o.rb ?? .55), zF = new OneEuro(.8, .012), axF = new OneEuro(o.amc ?? 2.2, o.ab ?? .018), ayF = new OneEuro(o.amc ?? 2.2, o.ab ?? .018);
  const idx = o.idx || RIGID, w = idx.map(k => (o.wmap && o.wmap[k]) || 1);
  let pose = null; const E = [], J = [], ys = []; let prev = null;
  for (let i = 260; i < L.length; i++) { const pts = L[i]; if (!pts) { pose = null; [rotF, zF, axF, ayF].forEach(f => f.reset()); continue; }
    pose = pose ? solvePose(model, idx, pts, cam, pose, 3, w) : solvePose(model, idx, pts, cam, initialPose(model, pts, cam), 18, w);
    if (pose.rms > 25) pose = solvePose(model, idx, pts, cam, initialPose(model, pts, cam), 18, w);
    const dt = 1 / 30, Rs = o.noRotF ? pose.R : rotF.filter(pose.R, dt), z = zF.filter(pose.t[2], dt);
    const A = o.anchor; let ax = 0, ay = 0, am = [0, 0, 0];
    for (const k of A) { ax += pts[k][0]; ay += pts[k][1]; am = v.add(am, model[k]); }
    ax = axF.filter(ax / A.length, dt); ay = ayF.filter(ay / A.length, dt); am = v.mul(am, 1 / A.length);
    const r = q.rot(Rs, am), Z = r[2] + z; const t = [(ax - cam.cx) * -Z / cam.f - r[0], (ay - cam.cy) * Z / cam.f - r[1], z];
    const pr = p => { const rr = v.add(q.rot(Rs, p), t); return [cam.cx + cam.f * rr[0] / -rr[2], cam.cy + cam.f * rr[1] / rr[2]]; };
    const e168 = (() => { const a = pr(model[168]); const g = G[i]; return Math.hypot(a[0] - g[168][0], a[1] - g[168][1]); })();
    const eEye = Math.max(...[33, 263].map(k => { const a = pr(model[k]), g = G[i]; return Math.hypot(a[0] - g[k][0], a[1] - g[k][1]); }));
    E.push([e168, eEye]); const h = pr([62, 18, -8]); if (prev) J.push(Math.hypot(h[0] - prev[0], h[1] - prev[1])); prev = h; }
  const pc = (a, k) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length * k)].toFixed(2); };
  const step = J; // frame-to-frame hinge motion; small values = calm
  console.log(name.padEnd(28), 'bridge p50', pc(E.map(e => e[0]), .5), 'p95', pc(E.map(e => e[0]), .95), '| outer eye p95', pc(E.map(e => e[1]), .95), '| hinge step p25', pc(step, .25));
}
evalv('168, no filter', { anchor: [168], amc: 1000, ab: 0 });
evalv('168, beta .2', { anchor: [168], amc: 3, ab: .2, rmc: 2.5, rb: 1.2 });
evalv('168, beta .5', { anchor: [168], amc: 3, ab: .5, rmc: 2.5, rb: 1.2 });
evalv('168+6, beta .5, rot fast', { anchor: [168, 6], amc: 3, ab: .5, rmc: 2.5, rb: 3 });
