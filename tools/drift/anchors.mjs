// anchors.mjs <data>: swim when the glasses are tied to a single landmark (or a set) instead of [168, 6].
// Ranks landmarks as anchors: the right anchor moves with the real frame as the head turns and pitches.
import { evalVariant } from './drift.mjs';
const sets = (process.env.SETS || '').split(';').filter(Boolean).map(s => s.split(',').map(Number));
const single = [168, 6, 197, 195, 5, 4, 1, 8, 9, 151, 133, 362, 33, 263, 245, 465, 193, 417, 122, 351, 188, 412, 114, 343, 55, 285, 107, 336, 159, 386, 145, 374, 468, 473, 2, 98, 327];
const cand = sets.length ? sets : single.map(k => [k]);
const res = [];
for (const A of cand) { const r = evalVariant('anchor ' + A.join(','), { anchor: A }, false); res.push([A.join(','), r.sum]); }
res.sort((a, b) => a[1].rmsY + a[1].rmsX - b[1].rmsY - b[1].rmsX);
for (const [n, s] of res) console.log(n.padEnd(24), 'swim dx', s.swimX.toFixed(2), 'dy', s.swimY.toFixed(2), '| rms dx', s.rmsX.toFixed(2), 'dy', s.rmsY.toFixed(2), '| rest ear', s.restEar.toFixed(2));
