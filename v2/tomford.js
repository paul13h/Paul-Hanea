// Tom Ford FT5902-B, black acetate, 54□17-145. Built from Paul's own frame (photos + webcam video).
// Units: mm. x right, y up, z towards the viewer. Origin: frame centre at lens-centre height.
import * as THREE from 'three';
import { TF_OUTER, TF_LENS_L, TF_LENS_R } from './tomford-data.js?v=11';

export const SPEC = {
  name: 'Tom Ford FT5902-B', lens: 54, bridge: 17, temple: 145, price: '€ 330',
  padHalfX: 8.2,      // where the high acetate bridge touches the sides of the nose
  padY: -4.5,         // checked against Paul's real frame in his webcam video (red overlay test)
  padZ: -6.2,
  hingeX: 67.5, hingeY: 16.0, hingeZ: -6.8,
  wrapR: 320
};
const wrapZ = x => -x * x / (2 * SPEC.wrapR);
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

function lensGeo(c) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(v2(c)), 24);
  const p = g.attributes.position; let cx = 0, cy = 0; c.forEach(q => { cx += q[0]; cy += q[1]; }); cx /= c.length; cy /= c.length;
  for (let i = 0; i < p.count; i++) { const dx = p.getX(i) - cx, dy = p.getY(i) - cy; p.setZ(i, -2.2 - (dx * dx + dy * dy) / 600); }
  return bend(g);
}

function temple(side, acetate, metal) {
  // the arm as on Paul's frame (photo IMG_1403): a tall flat paddle at the hinge (about 9.5 mm), tapering to about
  // 5.5 mm by the middle, straight back past the ear, then bending down behind it with a slightly fuller tip
  const pts = [[0, 0, 0], [0, -.8, -62], [0, -2, -112], [0, -6, -124], [0, -13, -134], [0, -21, -141]].map(a => new THREE.Vector3(...a));
  const curve = new THREE.CatmullRomCurve3(pts), N = 72, prof = [], pos = [], idx = [], col = [], dist = [];
  for (let i = 0; i < 16; i++) { const t = i / 16 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); prof.push([Math.sign(c) * Math.abs(c) ** .35, Math.sign(s) * Math.abs(s) ** .35]); }
  const len = curve.getLength();
  for (let i = 0; i <= N; i++) {
    const u = i / N, p = curve.getPointAt(u), tg = curve.getTangentAt(u).normalize();
    const sideV = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3().crossVectors(tg, sideV).normalize().negate();
    const h = 5.6 + 3.9 * Math.max(0, 1 - u / .45) ** 1.5 + (u > .9 ? 1.1 * (u - .9) / .1 : 0), w = 4.0 - .9 * u;
    // the top edge stays straight and the paddle grows downwards, as on the real arm
    const drop = (h - 5.6) / 2;
    for (const [a, b] of prof) { const q = p.clone().addScaledVector(sideV, a * w / 2).addScaledVector(up, b * h / 2 - drop); pos.push(q.x, q.y, q.z); col.push(1, 1, 1, 1); dist.push(u * len); }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < 16; j++) { const a = i * 16 + j, b = i * 16 + (j + 1) % 16; idx.push(a, a + 16, b, b, a + 16, b + 16); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx); g.computeVertexNormals();
  g.userData.dist = dist;
  const grp = new THREE.Group(), arm = new THREE.Mesh(g, acetate); arm.renderOrder = 3; grp.add(arm); grp.userData.arm = arm;
  // the stem of the silver T: starts right at the hinge, so with the T's crossbar on the front corner it reads as one piece
  // (as on the real frame seen from the side), and runs about 24 mm back along the upper part of the arm
  const strip = new THREE.Mesh(new THREE.BoxGeometry(.6, 1.1, 24), metal); strip.position.set(side * 2.1, .2, -12.6); grp.add(strip);
  // the side of the head and the ear below the arm (invisible, depth only): seen from below, as when looking up,
  // they hide the back half of the arm like on Paul's real frame; from the side or from above they are below the arm
  // and hide nothing. Hangs 4 mm under the arm, from 48 mm behind the hinge, 14 mm towards the head to 5 mm outside it.
  const under = new THREE.Mesh(new THREE.BoxGeometry(19, 66, 102), new THREE.MeshBasicMaterial({ colorWrite: false }));
  under.position.set(-side * 4.5, -4 - 33, -48 - 51); under.renderOrder = -2;
  if (!/[?&]ub=0/.test(location.search)) grp.add(under);
  // (v15 and before also had an invisible "side of the head" panel above the arm against arms sticking up like antennas when
  // looking down; that was really the arms pointing into the head. Paul's real arms ARE visible running up the sides of the
  // head when he looks down, and the panel made them look too thin, so it is gone.)
  return grp;
}

// The arm disappears where it meets the ear: it passes over the top of the ear and runs behind it.
// ear = distance along the arm from the hinge to the top of the ear (mm), from the face scan.
function setArmEnd(temples, ear) {
  for (const pivot of Object.values(temples)) {
    const arm = pivot.children[0].userData.arm, g = arm.geometry, c = g.attributes.color, d = g.userData.dist;
    for (let i = 0; i < d.length; i++) c.setW(i, Math.max(0, Math.min(1, (ear + 9 - d[i]) / 7)));
    c.needsUpdate = true;
  }
}

export function buildTomFord() {
  const acetate = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0b, roughness: .22, metalness: 0, clearcoat: 1, clearcoatRoughness: .025, envMapIntensity: .55 });   // glossy black, like the real frame
  const metal = new THREE.MeshStandardMaterial({ color: 0xeceef0, metalness: 1, roughness: .12, envMapIntensity: 1.3 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9b46c, metalness: 1, roughness: .2 });   // kept for other colourways; this one has silver T's
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: .04, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: .18 });
  // same finish as the front: on Paul's real frame the arms catch the light just like the front does
  const armAcetate = acetate.clone(); armAcetate.envMapIntensity = +(new URLSearchParams(location.search).get('ae') ?? .5); armAcetate.vertexColors = true; armAcetate.transparent = true;
  const armMetal = metal.clone(); armMetal.envMapIntensity = .8;
  // through a lens you see your own temple, never the arm (it runs behind the head's side):
  // the lens shapes mark the stencil, and the arms are not drawn where it is marked
  for (const m of [armAcetate, armMetal]) Object.assign(m, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
  const maskMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
  const root = new THREE.Group(), front = new THREE.Group(); root.add(front);

  const shape = new THREE.Shape(v2(TF_OUTER));
  for (const c of [TF_LENS_L, TF_LENS_R]) shape.holes.push(new THREE.Path(v2(c)));
  // bevelOffset keeps the rounded edge inside the traced outline, so the rims stay as slim as on the real frame
  const fg = new THREE.ExtrudeGeometry(shape, { depth: 4.0, bevelEnabled: true, bevelThickness: 1.0, bevelSize: .9, bevelOffset: -.9, bevelSegments: 5, curveSegments: 6, steps: 1 });
  fg.translate(0, 0, -4.6);
  const fm = new THREE.Mesh(smooth(bend(fg)), acetate); fm.renderOrder = 2; front.add(fm);
  for (const c of [TF_LENS_L, TF_LENS_R]) { const m = new THREE.Mesh(lensGeo(c), lensMat); m.renderOrder = 6; front.add(m); const k = new THREE.Mesh(m.geometry, maskMat); k.renderOrder = 1; front.add(k); }

  // gold "T" on both front corners
  for (const s of [-1, 1]) {
    // like the real frame: the T lies on its side, crossbar along the outer edge, stem pointing to the lens
    const t = new THREE.Group(), x = s * 67.6;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.0, .6), metal), stem = new THREE.Mesh(new THREE.BoxGeometry(1.0, 4.9, .6), metal);
    bar.position.y = 2.45; t.add(bar, stem); t.rotation.z = -s * Math.PI / 2; t.position.set(x, 15.2, wrapZ(x) + .8); front.add(t);
  }
  const temples = {};
  for (const [n, s] of [['L', -1], ['R', 1]]) {
    const pivot = new THREE.Group(); pivot.position.set(s * SPEC.hingeX, SPEC.hingeY, SPEC.hingeZ + wrapZ(SPEC.hingeX) * 0); root.add(pivot);
    pivot.add(temple(s, armAcetate, armMetal)); temples[n] = pivot;
  }
  return { root, front, temples, lenses: [TF_LENS_L, TF_LENS_R], materials: { acetate, metal, gold, lensMat }, setArmEnd: ear => setArmEnd(temples, ear) };
}
