// How much does the drawn head slip against the face? Replays saved landmarks (dump_l.py) through the scan and tracking
// in Node and measures, per frame, the distance between where the tracked head puts a face point and where FaceMesh sees it.
//   node tools/slip.mjs <L_clip.json> [fov] [variant...]
// Points: bridge (168), inner eye corners (133, 362), sides of the face in front of the ears (127, 356) - where the arms rest.
import fs from 'fs';
import { v, q, solvePose, initialPose, OneEuro, QuatFilter } from '../v2/solver.js';
import { replay, RIGID, yawOf, project } from './replay.mjs';
const L = JSON.parse(fs.readFileSync(process.argv[2])), fov = +(process.argv[3] || 46);

// the page's tracker with options: rot = [minCutoff, beta] of the rotation filter (null: no filter), anc = anchor filter
export function makeTrack(opt = {}) {
  return ctx => {
    const rot = opt.rot === null ? null : new QuatFilter(...(opt.rot || [2.5, 3])), zF = new OneEuro(.8, .012);
    const axF = new OneEuro(...(opt.anc || [3, .5])), ayF = new OneEuro(...(opt.anc || [3, .5]));
    let pose = null, lastT = 0;
    return {
      reset() { rot && rot.reset(); zF.reset(); axF.reset(); ayF.reset(); pose = null; },
      track(pts, tMs) {
        const { model, cam } = ctx;
        if (!pose) pose = solvePose(model, opt.rigid || RIGID, pts, cam, initialPose(model, pts, cam), 18);
        else pose = solvePose(model, opt.rigid || RIGID, pts, cam, pose, opt.iters || 3);
        if (pose.rms > 25) pose = solvePose(model, opt.rigid || RIGID, pts, cam, initialPose(model, pts, cam), 18);
        const dt = Math.max(.008, Math.min(.1, (tMs - lastT) / 1000)); lastT = tMs;
        let Rs = rot ? rot.filter(pose.R, dt) : pose.R; const z = opt.zraw ? pose.t[2] : zF.filter(pose.t[2], dt);
        if (opt.yawBoost !== false) { const yw = yawOf(Rs), over = Math.abs(yw) - 22; if (over > 0) Rs = q.norm(q.mul(Rs, q.fromVec([0, Math.sign(yw) * .55 * over / 57.3, 0]))); }
        let ax = 0, ay = 0, am = [0, 0, 0];
        for (const i of [168, 6]) { ax += pts[i][0]; ay += pts[i][1]; am = v.add(am, model[i]); }
        ax = axF.filter(ax / 2, dt); ay = ayF.filter(ay / 2, dt); am = v.mul(am, .5);
        const r = q.rot(Rs, am), Z = r[2] + z;
        return { R: Rs, t: [(ax - cam.cx) * -Z / cam.f - r[0], (ay - cam.cy) * Z / cam.f - r[1], z], pts, raw: pose };
      }
    };
  };
}
export function slip(res, ids) {
  const { out, ctx } = res, rows = [];
  for (const o of out) {
    if (!o.R || !o.shown) continue;
    const mm = 33 / Math.hypot(o.pts[133][0] - o.pts[362][0], o.pts[133][1] - o.pts[362][1]);
    rows.push(ids.map(k => { const p = project(ctx.cam, o.R, o.t, ctx.model[k]); return Math.hypot(p[0] - o.pts[k][0], p[1] - o.pts[k][1]) * mm; }));
  }
  return rows;
}
export const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }, p90 = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * .9)]; };
if (import.meta.url === `file://${process.argv[1]}`) {
const V = {
  'page now': {},
  'no rotation smoothing': { rot: null },
  'light rotation smoothing': { rot: [6, 8] },
  'no yaw boost': { yawBoost: false },
  'no smoothing at all': { rot: null, anc: [1e6, 0], zraw: true },
};
const ids = [168, 133, 362, 127, 356];
console.log('slip in mm, median / p90:   bridge   eye corners   face sides (arms)');
for (const [name, opt] of Object.entries(V)) {
  const rows = slip(replay(L, { fov, makeTrack: makeTrack(opt) }), ids);
  const col = j => rows.map(r => r[j]), both = (a, b) => rows.map(r => (r[a] + r[b]) / 2);
  const f = a => `${med(a).toFixed(1)} / ${p90(a).toFixed(1)}`;
  console.log(`  ${name.padEnd(26)} ${f(col(0)).padEnd(10)} ${f(both(1, 2)).padEnd(13)} ${f(both(3, 4))}`);
}
}
