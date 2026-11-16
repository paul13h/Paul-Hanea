// drift.mjs: tracking variants in Node vs the real frame position measured from the baseline render (measure.py).
//   node drift.mjs <data> [variant names...]
import fs from 'fs';
const ROOT = process.env.ROOT || '/Users/paulhanea/Documents/Virtual Try-On/Paul-Hanea-drift';
const { v, q, solvePose, initialPose, OneEuro, QuatFilter } = await import(ROOT + '/v2/solver.js');
const { replay, RIGID, yawOf, pitchOf, project } = await import(ROOT + '/tools/replay.mjs');
const D = process.argv[2], L = JSON.parse(fs.readFileSync(D + '/L_kmix.json'));
const base = JSON.parse(fs.readFileSync(D + '/runs/k_base/kmix.json')), drift = JSON.parse(fs.readFileSync(D + '/runs/k_base/kmix_drift.json'));
const rec = base.rec, fit = base.fit;
export function makeTrack(o = {}) {
  return ctx => {
    const rf = o.rot || [2, 10], rot = o.rot === null ? null : (o.mkRot ? o.mkRot() : new QuatFilter(...rf)), zF = new OneEuro(...(o.z || [.8, .012]));
    const anc = o.anc || [3, .5], axF = new OneEuro(...anc), ayF = new OneEuro(...anc), A = o.anchor || [168, 6], idx = o.rigid || RIGID;
    let pose = null, lastT = 0; const st = {};
    return {
      reset() { rot && rot.reset(); zF.reset(); axF.reset(); ayF.reset(); pose = null; },
      track(pts, tMs) {
        const { model, cam } = ctx, w = o.weights ? o.weights(idx, model) : null;
        if (!pose) pose = solvePose(model, idx, pts, cam, initialPose(model, pts, cam), 18, w);
        else pose = solvePose(model, idx, pts, cam, pose, o.iters || 3, w);
        if (pose.rms > 25) pose = solvePose(model, idx, pts, cam, initialPose(model, pts, cam), 18, w);
        const dt = Math.max(.008, Math.min(.1, (tMs - lastT) / 1000)); lastT = tMs;
        let Rs = rot ? rot.filter(pose.R, dt) : pose.R; const z = o.zraw ? pose.t[2] : zF.filter(pose.t[2], dt);
        const yk = o.yk ?? 22, yg = o.yg ?? .55;
        const yw = yawOf(Rs), over = Math.abs(yw) - yk; if (over > 0 && yg) Rs = q.norm(q.mul(Rs, q.fromVec([0, Math.sign(yw) * yg * over / 57.3, 0])));
        if (o.post) Rs = o.post(Rs, pose, ctx);
        let ax = 0, ay = 0, am = [0, 0, 0];
        for (const i of A) { ax += pts[i][0]; ay += pts[i][1]; am = v.add(am, model[i]); }
        const n = A.length; ax = axF.filter(ax / n, dt); ay = ayF.filter(ay / n, dt); am = v.mul(am, 1 / n);
        if (o.anchorFn) { const a = o.anchorFn(pts, model, pose, ctx, Rs, dt, st); if (a) { ax = a.ax; ay = a.ay; am = a.am; } }
        const r = q.rot(Rs, am), Z = r[2] + z;
        return { R: Rs, t: [(ax - cam.cx) * -Z / cam.f - r[0], (ay - cam.cy) * Z / cam.f - r[1], z], pts, raw: pose };
      }
    };
  };
}
// glasses in head coordinates, as applyFit/setHead
const SPEC = { padY: -4.5, padZ: -6.2 }, lm = fit.lm, tilt = fit.tilt / 57.3;
export function lensPts(ctx, R, t, o = {}) {
  const m = ctx.model, midX = (m[168][0] + (m[33][0] + m[263][0]) / 2) / 2;
  const rx = p => [p[0], p[1] * Math.cos(tilt) - p[2] * Math.sin(tilt), p[1] * Math.sin(tilt) + p[2] * Math.cos(tilt)];
  const pad = rx([0, SPEC.padY, SPEC.padZ]);
  const bp = [midX - pad[0], fit.seat.y - 2 - pad[1], (o.seatZ ?? ctx.seatZ) - pad[2]];
  const PX = o.px ?? 6, c = v.mul(t, -1 / v.len(t)), ch = q.rot(q.conj(R), c);
  const pos = [bp[0] - PX * ch[0] * ch[2] + (o.shift ? o.shift(ch, R)[0] : 0), bp[1] + (o.shift ? o.shift(ch, R)[1] : 0), bp[2]];
  return [-35.5, 35.5].map(x => project(ctx.cam, R, t, v.add(pos, rx([x, 0, -2]))));
}
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; }, pct = (a, k) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * k)]; };
export function evalVariant(name, o = {}, verbose = true) {
  const res = replay(L, { fov: 46, makeTrack: makeTrack(o) }), { out, ctx } = res;
  // seatZ: calibrate once so that the baseline lens projection reproduces the page's (rec.lens)
  if (ctx.seatZ === undefined) { let bestZ = 0, be = 1e9; for (let z = -12; z <= 12; z += .1) { let e = 0; for (const i of [430, 480, 570, 670, 716]) { const r = rec[i], p = lensPts(ctx, r.R, r.t, { seatZ: z }); e += Math.hypot(p[0][0] - r.lens[0][0], p[0][1] - r.lens[0][1]) + Math.hypot(p[1][0] - r.lens[1][0], p[1][1] - r.lens[1][1]); } if (e < be) { be = e; bestZ = z; } } ctx.seatZ = bestZ; evalVariant.seatZ = bestZ; evalVariant.cal = be / 10; }
  const rows = [], ear = [], hinge = [], lag = [];
  const rawT = makeTrack({ ...o, rot: null, anc: [1e6, 0], zraw: true });   // same variant without any smoothing = where the head is now
  const raw = replay(L, { fov: 46, makeTrack: rawT }).out;
  let prev = null;
  for (let i = 394; i < out.length; i++) {
    const f = out[i]; if (!f.R || !f.shown) { prev = null; continue; }
    const lp = lensPts(ctx, f.R, f.t, o), d = drift[i], pxmm = ctx.cam.f / -f.t[2];
    const E = [78 * (yawOf(f.R) > 0 ? -1 : 1), 15, -125];   // near arm's ear end
    const e = project(ctx.cam, f.R, f.t, E), h = project(ctx.cam, f.R, f.t, [62, 18, -8]);
    if (raw[i].R) { const e0 = project(ctx.cam, raw[i].R, raw[i].t, E); lag.push([i, Math.hypot(e[0] - e0[0], e[1] - e0[1])]); }
    if (prev) { hinge.push([i, Math.hypot(h[0] - prev.h[0], h[1] - prev.h[1])]); ear.push([i, Math.hypot(e[0] - prev.e[0], e[1] - prev.e[1])]); }
    prev = { h, e };
    if (d && d.all[2] > .25 && !d.all[3] && rec[i].lens) {
      const real = [(rec[i].lens[0][0] + rec[i].lens[1][0]) / 2 + d.all[0], (rec[i].lens[0][1] + rec[i].lens[1][1]) / 2 + d.all[1]];
      const mine = [(lp[0][0] + lp[1][0]) / 2, (lp[0][1] + lp[1][1]) / 2];
      // roll: per-lens dy difference
      const rollReal = d.L && d.R && d.L[2] > .2 && d.R[2] > .2 ? (d.R[1] - d.L[1]) : null;
      rows.push({ i, yaw: yawOf(rec[i].R), pitch: pitchOf(rec[i].R), dx: (real[0] - mine[0]) / pxmm, dy: (real[1] - mine[1]) / pxmm, roll: rollReal === null ? null : rollReal - ((lp[1][1] - lp[0][1]) - (rec[i].lens[1][1] - rec[i].lens[0][1])), pxmm });
    }
  }
  const p0 = med(rows.filter(r => r.i >= 400 && r.i <= 440).map(r => r.pitch));
  const bins = [['yaw<-35', r => r.yaw < -35 && Math.abs(r.pitch - p0) < 8], ['yaw-35..-22', r => r.yaw >= -35 && r.yaw < -22 && Math.abs(r.pitch - p0) < 8], ['yaw-22..-10', r => r.yaw >= -22 && r.yaw < -10 && Math.abs(r.pitch - p0) < 8],
    ['straight', r => Math.abs(r.yaw) < 10 && Math.abs(r.pitch - p0) < 8], ['yaw10..22', r => r.yaw >= 10 && r.yaw < 22 && Math.abs(r.pitch - p0) < 8], ['yaw22..35', r => r.yaw >= 22 && r.yaw < 35 && Math.abs(r.pitch - p0) < 8], ['yaw>35', r => r.yaw >= 35 && Math.abs(r.pitch - p0) < 8],
    ['down>18', r => Math.abs(r.yaw) < 10 && r.pitch - p0 < -18], ['down8..18', r => Math.abs(r.yaw) < 10 && r.pitch - p0 < -8 && r.pitch - p0 >= -18], ['up8..18', r => Math.abs(r.yaw) < 10 && r.pitch - p0 > 8 && r.pitch - p0 <= 18], ['up>18', r => Math.abs(r.yaw) < 10 && r.pitch - p0 > 18]];
  const B = bins.map(([n, f]) => { const s = rows.filter(f); return { n, k: s.length, dx: med(s.map(r => r.dx)), dy: med(s.map(r => r.dy)), roll: med(s.filter(r => r.roll !== null).map(r => r.roll)) }; }).filter(b => b.k >= 3);
  const s0 = B.find(b => b.n === 'straight');
  const rest = a => med(a.filter(([i]) => i >= 400 && i <= 440).map(x => x[1]));
  const fast = lag.filter(([i]) => ear.find(e => e[0] === i && e[1] > 4)).map(x => x[1]);
  const sum = { name, swimX: Math.max(...B.map(b => b.dx)) - Math.min(...B.map(b => b.dx)), swimY: Math.max(...B.map(b => b.dy)) - Math.min(...B.map(b => b.dy)),
    rmsX: Math.sqrt(rows.reduce((s, r) => s + (r.dx - s0.dx) ** 2, 0) / rows.length), rmsY: Math.sqrt(rows.reduce((s, r) => s + (r.dy - s0.dy) ** 2, 0) / rows.length),
    restHinge: rest(hinge), restEar: rest(ear), lagP90: pct(lag.map(x => x[1]), .9), lagFastP90: pct(fast, .9), lagMax: Math.max(...lag.map(x => x[1])) };
  if (verbose) {
    console.log(`== ${name}`);
    console.log('   ' + B.map(b => b.n.padStart(11)).join('')); console.log('dx ' + B.map(b => (b.dx - 0).toFixed(1).padStart(11)).join('')); console.log('dy ' + B.map(b => (b.dy - 0).toFixed(1).padStart(11)).join(''));
    console.log('n  ' + B.map(b => String(b.k).padStart(11)).join(''));
  }
  console.log(`   ${name.padEnd(34)} swim range dx ${sum.swimX.toFixed(2)} dy ${sum.swimY.toFixed(2)} mm | rms vs straight dx ${sum.rmsX.toFixed(2)} dy ${sum.rmsY.toFixed(2)} | rest px/frame hinge ${sum.restHinge.toFixed(2)} ear ${sum.restEar.toFixed(2)} | ear lag p90 ${sum.lagP90.toFixed(1)} fast-p90 ${sum.lagFastP90.toFixed(1)} max ${sum.lagMax.toFixed(1)} px`);
  return { sum, B, rows, out, ctx, lag, ear };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = evalVariant('page now (rf 2,10)');
  console.log('seatZ', evalVariant.seatZ, 'lens reprojection error px', evalVariant.cal.toFixed(2));
  let e = 0, n = 0; for (let i = 394; i < 870; i++) if (r.out[i].R && rec[i].R) { e = Math.max(e, q.angle(r.out[i].R, rec[i].R) * 57.3); n++; } console.log('max R diff vs page (deg)', e.toFixed(4), n);
  evalVariant('v22 rf 2,3', { rot: [2, 3] }, false);
  evalVariant('no rot filter', { rot: null }, false);
}
