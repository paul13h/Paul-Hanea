// Tom Ford FT5902-B, black acetate, 54□17-145. Built from Paul's own frame (photos + webcam video).
// Units: mm. x right, y up, z towards the viewer. Origin: frame centre at lens-centre height.
import * as THREE from 'three';
import { TF_OUTER, TF_LENS_L, TF_LENS_R } from './tomford-data.js?v=17';

export const SPEC = {
  name: 'Tom Ford FT5902-B', lens: 54, bridge: 17, temple: 145, price: '€ 330',
  padHalfX: 8.2,      // where the high acetate bridge touches the sides of the nose
  padY: -4.5,         // checked against Paul's real frame in his webcam video (red overlay test)
  padZ: -6.2,
  // v17: the hinge sits just inside the back of the front's corner (before, it was 0.5 mm in front of it and the arm's
  // front end showed on the front), with the arm's outer side flush with the corner's outer edge (x = 70.4).
  // v18: right at the back of the corner; the arm reaches 1.2 mm into it, so there is no gap
  // v19: hinge 2 mm lower and the arm a fixed 12° from the front's normal, as on a real frame: with the arm's line through the
  // middle of the arm, the T then lands mid-corner and the arm's top meets the top of the corner (checked against Paul's
  // real frame in his laptop video, 9 Nov). earY: where the arm meets the top of the ear, above the side-of-face landmarks
  hingeX: 68.2, hingeY: +(new URLSearchParams(location.search).get('hy') ?? 14), hingeZ: 0,   // hingeZ: set below, from the shape of the corner
  armAngle: 12, earY: 9,
  wrapR: 320
};
// the front curves round the face, and its outer 5 mm turn back steeply, as the corners of the real frame do (about 65° at
// the edge): seen from the side, the T's stem on the corner then already points back along the arm, as on the real frame
const CORNER_X = 65.5, CORNER_K = .2;
const wrapZ = x => -x * x / (2 * SPEC.wrapR) - CORNER_K * Math.max(0, Math.abs(x) - CORNER_X) ** 2;
const wrapSlope = x => -x / SPEC.wrapR - 2 * CORNER_K * Math.sign(x) * Math.max(0, Math.abs(x) - CORNER_X);
SPEC.hingeZ = wrapZ(70.4) - 5.9;   // just behind the back of the corner
const bend = g => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + wrapZ(p.getX(i))); p.needsUpdate = true; g.computeVertexNormals(); return g; };
// Smooth shading for the acetate: average the normals of faces that meet at a shallow angle, keep real edges crisp.
function smooth(g, creaseDeg = 38) {
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, key = i => `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
  const groups = new Map(); for (let i = 0; i < p.count; i++) { const k = key(i); (groups.get(k) || groups.set(k, []).get(k)).push(i); }
  const cos = Math.cos(creaseDeg * Math.PI / 180), out = new Float32Array(n.count * 3);
  for (const ids of groups.values()) for (const i of ids) {
    let x = 0, y = 0, z = 0; const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    for (const j of ids) { const mx = n.getX(j), my = n.getY(j), mz = n.getZ(j); if (nx * mx + ny * my + nz * mz >= cos) { x += mx; y += my; z += mz; } }
    const l = Math.hypot(x, y, z) || 1; out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3)); return g;
}
const v2 = a => a.map(p => new THREE.Vector2(p[0], p[1]));
// The outline and lenses were traced from photos pixel by pixel: their edges are staircases (steps of 0.14 mm), which the
// glossy finish showed as ridges across the top of the frame. Smoothed along the edge (gaussian, sigma in mm).
function smoothLoop(c, sigma) {
  const r = resample(c, .25), n = r.length, k = Math.ceil(3 * sigma / .25), wts = [];
  for (let j = -k; j <= k; j++) wts.push(Math.exp(-((j * .25) ** 2) / (2 * sigma * sigma)));
  const W = wts.reduce((a, b) => a + b, 0);
  return r.map((_, i) => { let x = 0, y = 0; for (let j = -k; j <= k; j++) { const q = r[(i + j + n) % n], w = wts[j + k]; x += q[0] * w; y += q[1] * w; } return [x / W, y / W]; });
}
function resample(c, step) {
  const out = [];
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}

function lensGeo(c) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(v2(c)), 24);
  const p = g.attributes.position; let cx = 0, cy = 0; c.forEach(q => { cx += q[0]; cy += q[1]; }); cx /= c.length; cy /= c.length;
  for (let i = 0; i < p.count; i++) { const dx = p.getX(i) - cx, dy = p.getY(i) - cy; p.setZ(i, -2.2 - (dx * dx + dy * dy) / 600); }
  return bend(g);
}

// Sweeps a rounded section along a curve (arms, silver line). sec(u) -> [width, height, x offset, y offset] in the section's
// frame: x along `sideV`, y along `up` = the direction perpendicular to the curve and to sideV.
const PROF = []; for (let i = 0; i < 16; i++) { const t = i / 16 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); PROF.push([Math.sign(c) * Math.abs(c) ** .35, Math.sign(s) * Math.abs(s) ** .35]); }
function sweep(curve, u0, u1, n, sec, sideV = new THREE.Vector3(1, 0, 0)) {
  const pos = [], dist = [], len = curve.getLength();
  for (let i = 0; i <= n; i++) {
    const u = u0 + (u1 - u0) * i / n, p = curve.getPointAt(u), tg = curve.getTangentAt(u).normalize();
    const sv = sideV.clone().addScaledVector(tg, -sideV.dot(tg)).normalize(), up = new THREE.Vector3().crossVectors(tg, sv).normalize().negate();
    const [w, h, ox, oy] = sec(u);
    for (const [a, b] of PROF) { const q = p.clone().addScaledVector(sv, a * w / 2 + ox).addScaledVector(up, b * h / 2 + oy); pos.push(q.x, q.y, q.z); dist.push(u * len); }
  }
  const idx = []; for (let i = 0; i < n; i++) for (let j = 0; j < 16; j++) { const a = i * 16 + j, b = i * 16 + (j + 1) % 16; idx.push(a, a + 16, b, b, a + 16, b + 16); }
  return { pos, idx, dist, len };
}

// The arm as on Paul's frame (photos IMG_1403 side, IMG_1410 front, and the real frame turned in Paul's video).
// On the real frame the block behind the front's corner points the same way as the arm, so the T's line runs as one straight
// line from the corner along the arm. Here the arm itself forms that block: it starts at the front face (L mm before the
// hinge seam), following its own direction up and down, with only its outward opening taken at the hinge, so its side stays
// flush with the corner. Its top is cut back there so it never stands above the corner. At the hinge it is as tall and wide as
// the corner (8 x 4.2 mm), then the bottom edge rises to about 6 mm by the middle and 5.5 mm at the ear while the top stays
// straight; it runs straight back past the ear and down behind it with a fuller tip.
const ARM_TOP = 4.6, LINE_LEN = 22, LINE_OFF = -.6, LINE_H = .9;
function armCurve(f) {
  const ox = f.side * f.L * Math.tan(f.open);
  const pts = [new THREE.Vector3(ox, 0, f.L), new THREE.Vector3(ox / 2, 0, f.L / 2), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -.3, -22),
    new THREE.Vector3(0, -.8, -62), new THREE.Vector3(0, -2, -112), new THREE.Vector3(0, -6, -124), new THREE.Vector3(0, -13, -134), new THREE.Vector3(0, -21, -141)];
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}
// v19: taller, as the real arm looks next to the front in Paul's laptop video: 9.5 mm at the hinge (IMG_1403), ~7 mm halfway
// to the ear. Its top is level with the top of the corner where they meet, so the corner no longer stands above the arm.
function armSection(u, len, f) {
  const d = u * len - f.L, k = Math.max(0, 1 - Math.max(0, d) / 80);
  const h = 6.6 - .8 * u + 2.9 * k ** 1.3 + (u > .9 ? 1.1 * (u - .9) / .1 : 0), w = 4.2 - 1.0 * u;
  // in front of the hinge the arm rises with its angle; it is only cut back where it would stand above the corner (y 20)
  const top = ARM_TOP - .3 * u - (u > .9 ? .3 * (u - .9) / .1 : 0), cut = d < 0 ? Math.max(0, -d * Math.tan(f.rel) - (20 - SPEC.hingeY - ARM_TOP)) : 0;
  return { w, h: h - cut, mid: top - cut - (h - cut) / 2 };
}
function buildArm(f) {
  const curve = armCurve(f), len = curve.getLength(), N = 100;
  const arm = sweep(curve, 0, 1, N, u => { const s = armSection(u, len, f); return [s.w, s.h, 0, s.mid]; });
  // two groups: the outer side and top (lit like the front), and the inner side and underside, which face the head and are in
  // its shadow (on the real frame they stay black even when the outside catches the ceiling light)
  const outer = [], inner = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < 16; j++) {
    const a = i * 16 + j, b = i * 16 + (j + 1) % 16, x = PROF[j][0] + PROF[(j + 1) % 16][0], y = PROF[j][1] + PROF[(j + 1) % 16][1];
    (x * f.side < -.2 || y < -.6 ? inner : outer).push(a, a + 16, b, b, a + 16, b + 16);
  }
  const g = new THREE.BufferGeometry(); g.addGroup(0, outer.length, 0); g.addGroup(outer.length, inner.length, 1);
  g.setAttribute('position', new THREE.Float32BufferAttribute(arm.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(arm.dist.map(() => [1, 1, 1, 1]).flat(), 4));
  g.setIndex([...outer, ...inner]); g.computeVertexNormals(); g.userData.dist = arm.dist.map(x => x - f.L);
  // the silver line on the outside of the arm, from the front face to LINE_LEN mm behind the hinge seam
  // v19: one straight line through the middle of the arm, as on the real frame (v18 kept it at the T's height, which put it
  // on the arm's bottom edge when the arm angles down from the front). It starts at the front face, where the T's stem meets it
  const u0 = .2 / len, u1 = (f.L + LINE_LEN) / len, mid0 = armSection(f.L / len, len, f).mid + LINE_OFF;
  const ln = sweep(curve, u0, u1, 40, u => {
    const s = armSection(u, len, f), d = u * len - f.L;
    return [.35, LINE_H, f.side * (s.w / 2 + .05), d < 0 ? mid0 : s.mid + LINE_OFF];
  });
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(ln.pos, 3)); lg.setIndex(ln.idx); lg.computeVertexNormals();
  return { arm: g, line: lg };
}

function temple(side, mats) {
  const grp = new THREE.Group(), geo = buildArm({ side, L: 6, open: .15, rel: .25 });
  const arm = new THREE.Mesh(geo.arm, [mats.acetate, mats.shade]); arm.renderOrder = 3; grp.add(arm);
  const line = new THREE.Mesh(geo.line, mats.metal); line.renderOrder = 3; grp.add(line);
  // the side of the head and the ear below the arm (invisible, depth only): seen from below, as when looking up,
  // they hide the back half of the arm like on Paul's real frame; from the side or from above they are below the arm
  // and hide nothing. Hangs 4 mm under the arm, from 48 mm behind the hinge, 14 mm towards the head to 5 mm outside it.
  const occ = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  const under = new THREE.Mesh(new THREE.BoxGeometry(19, 66, 102), occ);
  under.position.set(-side * 4.5, -4 - 33, -48 - 51); under.renderOrder = -2;
  if (!/[?&]ub=0/.test(location.search)) grp.add(under);
  // the ear (invisible, depth only): an upright oval just outside the arm, its front edge where the arm meets the top of
  // the ear. Seen from the side the arm goes behind the ear there, as on the real frame, instead of being drawn over it.
  const ear = new THREE.Mesh(new THREE.CircleGeometry(1, 40), occ); ear.scale.set(15, 30, 1); ear.rotation.y = Math.PI / 2; ear.renderOrder = -2;
  if (!/[?&]eo=0/.test(location.search)) grp.add(ear);
  grp.userData = { side, arm, line, ear, key: '' };
  return grp;
}

// Fits the arms to the face: rebuilds them for the current angles between arm and front, puts the ear where the arm meets
// the top of the ear (ear = distance along the arm from the hinge, from the face scan), fades out the tip that runs behind
// the ear, and puts the T where the arm's silver line meets the front.
function setArmEnd(temples, tees, ear) {
  for (const pivot of Object.values(temples)) {
    const t = pivot.children[0], u = t.userData, side = u.side;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(pivot.quaternion);          // the arm's direction, front coordinates
    const zf = wrapZ(70.4) + .2, L = zf - SPEC.hingeZ;                                   // front face to hinge seam
    const rel = Math.atan2(-dir.y, -dir.z), open = Math.abs(Math.atan2(dir.x, -dir.z));
    const f = { side, L, open, rel }, key = [rel, open].map(x => x.toFixed(3)).join();
    if (key !== u.key) {
      const geo = buildArm(f); u.arm.geometry.dispose(); u.line.geometry.dispose();
      u.arm.geometry = geo.arm; u.line.geometry = geo.line; u.key = key;
    }
    const g = u.arm.geometry, c = g.attributes.color, d = g.userData.dist;
    for (let i = 0; i < d.length; i++) c.setW(i, Math.max(0, Math.min(1, (ear + 36 - d[i]) / 10)));
    c.needsUpdate = true;
    // v19: the ear is an upright oval 30 x 60 mm whose top is level with the arm, so the arm goes behind the curve of the
    // top of the ear as on the real frame (v18 scaled the wrong axis: the oval was 2 mm wide and hid almost nothing, and the
    // arm just faded out in front of the ear). The arm fades out behind it, out of sight.
    u.ear.position.set(side * 5.2, -28, -(ear + 21)); u.ear.rotation.set(0, Math.PI / 2 - side * .26, 0);
    // the T: its stem runs round the corner from the crossbar to where the arm's line starts, already sloping like the arm,
    // so crossbar, stem and line read as one T with a long stem, as on the real frame seen from the side
    // the T: its stem runs round the corner from the crossbar to where the arm's line starts, sloping like the arm, so
    // crossbar, stem and line read as one straight T with a long stem, as on the real frame seen from the side
    const yEdge = SPEC.hingeY + armSection(0, 1, { L: 0, rel: 0 }).mid + LINE_OFF + L * Math.tan(rel), [cross, stem] = tees[side < 0 ? 'L' : 'R'];
    const pts = [66.9, 67.8, 68.7, 69.6, 70.5].map(x => new THREE.Vector3(side * x, yEdge + (wrapZ(x) - wrapZ(70.4)) * Math.tan(rel), wrapZ(x) + .55));
    const sw = sweep(new THREE.CatmullRomCurve3(pts), 0, 1, 12, () => [1.0, LINE_H * .55, 0, 0], new THREE.Vector3(0, 1, 0));
    stem.geometry.dispose(); stem.geometry = new THREE.BufferGeometry(); stem.geometry.setAttribute('position', new THREE.Float32BufferAttribute(sw.pos, 3));
    stem.geometry.setIndex(sw.idx); stem.geometry.computeVertexNormals(); stem.position.y = 0;
    cross.position.y = pts[0].y;
  }
}

export function buildTomFord() {
  const acetate = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0b, roughness: .22, metalness: 0, clearcoat: 1, clearcoatRoughness: .025, envMapIntensity: .55 });   // glossy black, like the real frame
  // polished silver: a little emissive so it stays bright silver like the real T instead of mirroring the skin (pinkish)
  const metal = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, metalness: 1, roughness: .16, envMapIntensity: 1.0, emissive: 0x3c3d40 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9b46c, metalness: 1, roughness: .2 });   // kept for other colourways; this one has silver T's
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: .04, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: .18 });
  // same finish as the front: on Paul's real frame the arms catch the light just like the front does
  const armAcetate = acetate.clone(); armAcetate.envMapIntensity = +(new URLSearchParams(location.search).get('ae') ?? .5); armAcetate.vertexColors = true; armAcetate.transparent = true;
  const armMetal = metal.clone(); armMetal.emissive.setHex(0x6a6b6e);   // the line on the arm faces sideways and caught less light than the T: on the real arm it stands out as brightly
  const armShade = armAcetate.clone(); armShade.envMapIntensity = .08; armShade.clearcoat = .3;
  // through a lens you see your own temple, never the arm (it runs behind the head's side):
  // the lens shapes mark the stencil, and the arms are not drawn where it is marked
  for (const m of [armAcetate, armShade, armMetal]) Object.assign(m, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
  const maskMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
  const root = new THREE.Group(), front = new THREE.Group(); root.add(front);

  // smoothed (see smoothLoop) and resampled every 0.6 mm so it also bends smoothly round the face
  const OUT = resample(smoothLoop(TF_OUTER, 1.2), .6), LENS = [TF_LENS_L, TF_LENS_R].map(c => resample(smoothLoop(c, 1.2), .6));
  const shape = new THREE.Shape(v2(OUT));
  for (const c of LENS) shape.holes.push(new THREE.Path(v2(c)));
  // bevelOffset keeps the rounded edge inside the traced outline, so the rims stay as slim as on the real frame
  const fg = new THREE.ExtrudeGeometry(shape, { depth: 4.0, bevelEnabled: true, bevelThickness: 1.0, bevelSize: .9, bevelOffset: -.9, bevelSegments: 5, curveSegments: 6, steps: 1 });
  fg.translate(0, 0, -4.6);
  const fm = new THREE.Mesh(smooth(bend(fg)), acetate); fm.renderOrder = 2; front.add(fm);
  for (const c of LENS) { const m = new THREE.Mesh(lensGeo(c), lensMat); m.renderOrder = 6; front.add(m); const k = new THREE.Mesh(m.geometry, maskMat); k.renderOrder = 1; front.add(k); }

  // the silver T on both corners, as on Paul's frame (photo IMG_1410): the crossbar stands upright on the lens side, the stem
  // runs outwards to the corner, wraps round its outer edge and carries on along the arm (strip in temple()) as one line
  const tees = {};
  for (const s of [-1, 1]) {
    const y = 14.6, zf = x => wrapZ(x) + .55;                      // measured on IMG_1410: crossbar 3.5 mm in from the edge
    const cross = new THREE.Mesh(new THREE.BoxGeometry(.9, 4.8, .5), metal); cross.position.set(s * 66.9, y, zf(66.9)); cross.rotation.y = -Math.atan(wrapSlope(s * 66.9)); front.add(cross);
    // the stem follows the corner's curve from the crossbar to the edge
    const sc = new THREE.CatmullRomCurve3([66.9, 68.1, 69.3, 70.5].map(x => new THREE.Vector3(s * x, 0, zf(x))));
    const sw = sweep(sc, 0, 1, 12, () => [1.0, .5, 0, 0], new THREE.Vector3(0, 1, 0)), sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sw.pos, 3)); sg.setIndex(sw.idx); sg.computeVertexNormals();
    const stem = new THREE.Mesh(sg, metal); stem.position.y = y; front.add(stem);
    tees[s < 0 ? 'L' : 'R'] = [cross, stem];                       // height set by setArmEnd, level with the arm's line
  }
  const temples = {};
  for (const [n, s] of [['L', -1], ['R', 1]]) {
    const pivot = new THREE.Group(); pivot.position.set(s * SPEC.hingeX, SPEC.hingeY, SPEC.hingeZ + wrapZ(SPEC.hingeX) * 0); root.add(pivot);
    pivot.add(temple(s, { acetate: armAcetate, metal: armMetal, shade: armShade })); temples[n] = pivot;
  }
  return { root, front, temples, lenses: LENS, materials: { acetate, metal, gold, lensMat }, setArmEnd: ear => setArmEnd(temples, tees, ear) };
}
