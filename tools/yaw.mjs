import fs from 'fs';
import { run } from './off.mjs';
import { v, q, solvePose, initialPose } from '/home/claude/paul-hanea/v2/solver.js';
import { RIGID } from '/home/claude/paul-hanea/v2/face-ref.js';
const L = JSON.parse(fs.readFileSync(process.argv[2]));
const { model, cam } = run(60, {});
const C = [0, -5, -60];
const EDGE = new Set([127, 356, 234, 454, 21, 251, 54, 284, 103, 332, 67, 297, 162, 389, 93, 323, 132, 361, 58, 288]);
const central = RIGID.filter(k => !EDGE.has(k));
const yawOf = R => { const f = q.rot(R, [0, 0, 1]); return Math.atan2(f[0], f[2]) * 57.3; };
const TEST = [1, 4, 33, 263, 133, 362, 168, 61, 291, 199];   // points the glasses care about, measured by the detector
function go(name, idx, vis) {
  let pose = null; const B = {};
  for (let i = 260; i < L.length; i++) { const pts = L[i]; if (!pts) { pose = null; continue; }
    let w = null;
    if (vis && pose) w = idx.map(k => { const n = v.sub(q.rot(pose.R, v.sub(model[k], C)), [0, 0, 0]); const z = n[2] / v.len(n); return Math.max(.03, Math.min(1, (z + .15) / .55)); });
    pose = pose ? solvePose(model, idx, pts, cam, pose, 3, w) : solvePose(model, idx, pts, cam, initialPose(model, pts, cam), 18);
    const pr = p => { const r = v.add(q.rot(pose.R, p), pose.t); return [cam.cx + cam.f * r[0] / -r[2], cam.cy + cam.f * r[1] / r[2]]; };
    const e = TEST.map(k => { const a = pr(model[k]); return Math.hypot(a[0] - pts[k][0], a[1] - pts[k][1]); });
    const b = Math.min(3, Math.floor(Math.abs(yawOf(pose.R)) / 15)); (B[b] = B[b] || []).push(e.reduce((s, x) => s + x) / e.length);
  }
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1].toFixed(2); };
  console.log(name.padEnd(22), Object.keys(B).map(b => `yaw ${b * 15}-${b * 15 + 15}°: ${med(B[b])}px (n=${B[b].length})`).join(' | '));
}
go('all rigid', RIGID, false);
go('without face edges', central, false);
go('visibility weighted', RIGID, true);
go('central + visibility', central, true);
