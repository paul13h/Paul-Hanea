// offset3d.mjs <data>: is the ghost-vs-real shift one constant 3D offset of the frame on the head?
// Fits, per frame, image shift = projection of (lens centre + D) - projection of (lens centre), D in head coordinates (mm),
// by least squares over all measured frames. If a constant D explains most of the swim, the swim is the frame's position on
// the head (fit), not tracking. Prints D and the swim left after removing it.
import { evalVariant, lensPts } from './drift.mjs';
const { v, q } = await import((process.env.ROOT || '/Users/paulhanea/Documents/Virtual Try-On/Paul-Hanea-drift') + '/v2/solver.js');
const { project } = await import((process.env.ROOT || '/Users/paulhanea/Documents/Virtual Try-On/Paul-Hanea-drift') + '/tools/replay.mjs');
const r = evalVariant('base', {}, false), { out, ctx, rows } = r;
const excl = (process.env.EXCL || '').split(',').filter(Boolean).map(s => s.split('-').map(Number));
const use = rows.filter(w => !excl.some(([a, b]) => w.i >= a && w.i <= b));
// lens centre in head coordinates: midpoint of the two lens points (lensPts uses the same construction)
const cen = (f, D) => { const l = lensPts(ctx, f.R, f.t, { shift: () => [D[0], D[1]] }); return [(l[0][0] + l[1][0]) / 2, (l[0][1] + l[1][1]) / 2]; };
function fit(rows, dims) {
  const A = [], b = [];
  for (const w of rows) { const f = out[w.i], c0 = cen(f, [0, 0]), pxmm = w.pxmm;
    // basis: unit offsets in head x, y, z (z by moving the projection point along head z)
    const J = dims.map(d => { if (d < 2) { const D = [0, 0]; D[d] = 1; const c = cen(f, D); return [(c[0] - c0[0]) / pxmm, (c[1] - c0[1]) / pxmm]; }
      const l = lensPts(ctx, f.R, f.t, {}), P = [0, 0, 1], a = project(ctx.cam, f.R, f.t, [0, 0, 0]), bb = project(ctx.cam, f.R, f.t, P); return [(bb[0] - a[0]) / pxmm, (bb[1] - a[1]) / pxmm]; });
    for (let k = 0; k < 2; k++) { A.push(J.map(j => j[k])); b.push(k ? w.dy : w.dx); } }
  // normal equations
  const n = dims.length, M = Array.from({ length: n }, () => new Array(n).fill(0)), g = new Array(n).fill(0);
  A.forEach((a, i) => { for (let p = 0; p < n; p++) { g[p] += a[p] * b[i]; for (let s = 0; s < n; s++) M[p][s] += a[p] * a[s]; } });
  // gauss
  for (let p = 0; p < n; p++) { for (let s = p + 1; s < n; s++) { const fct = M[s][p] / M[p][p]; for (let t = p; t < n; t++) M[s][t] -= fct * M[p][t]; g[s] -= fct * g[p]; } }
  const x = new Array(n); for (let p = n - 1; p >= 0; p--) { let s = g[p]; for (let t = p + 1; t < n; t++) s -= M[p][t] * x[t]; x[p] = s / M[p][p]; }
  const res = A.map((a, i) => b[i] - a.reduce((s, y, p) => s + y * x[p], 0));
  return { x, res };
}
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const SEG = [[400, 440], [456, 500], [552, 592], [656, 680], [704, 728], [768, 792], [824, 848]].filter(([a, b]) => use.some(w => w.i >= a && w.i <= b));
for (const dims of [[0, 1], [0, 1, 2]]) {
  const { x, res } = fit(use, dims);
  const rx = use.map((w, i) => res[2 * i]), ry = use.map((w, i) => res[2 * i + 1]);
  const segs = SEG.map(([a, b]) => { const k = use.map((w, i) => [w, i]).filter(([w]) => w.i >= a && w.i <= b); return [med(k.map(([, i]) => rx[i])), med(k.map(([, i]) => ry[i]))]; });
  const rng = k => Math.max(...segs.map(s => s[k])) - Math.min(...segs.map(s => s[k]));
  console.log('fit dims', dims.join(','), 'D (mm, head x/y/z) =', x.map(z => z.toFixed(2)).join(' '), '| residual seg medians dx', segs.map(s => s[0].toFixed(1)).join(' '), ' dy', segs.map(s => s[1].toFixed(1)).join(' '),
    '| seg range dx', rng(0).toFixed(2), 'dy', rng(1).toFixed(2), '| rms dx', Math.sqrt(rx.reduce((s, z) => s + z * z, 0) / rx.length).toFixed(2), 'dy', Math.sqrt(ry.reduce((s, z) => s + z * z, 0) / ry.length).toFixed(2));
}
