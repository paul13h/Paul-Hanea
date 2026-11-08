// Tom Ford FT5902-B, black acetate, 54□17-145. Built from Paul's own frame (photos + webcam video).
// Units: mm. x right, y up, z towards the viewer. Origin: frame centre at lens-centre height.
import * as THREE from 'three';
import { TF_OUTER, TF_LENS_L, TF_LENS_R } from './tomford-data.js?v=11';

export const SPEC = {
  name: 'Tom Ford FT5902-B', lens: 54, bridge: 17, temple: 145, price: '€ 330',
  padHalfX: 8.2,      // where the high acetate bridge touches the sides of the nose
  padY: -4.5,         // checked against Paul's real frame in his webcam video (red overlay test)
  padZ: -6.2,
  hingeX: 67.5, hingeY: 14.8, hingeZ: -6.8,
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
  // a tapered acetate arm, straight to the ear, then bending down behind it
  const pts = [[0, 0, 0], [0, -.6, -55], [0, -1.5, -100], [0, -6, -112], [0, -15, -124], [0, -26, -132]].map(a => new THREE.Vector3(...a));   // straight, then bending down behind the ear (product side photo)
  const curve = new THREE.CatmullRomCurve3(pts), N = 60, prof = [], pos = [], idx = [];
  for (let i = 0; i < 16; i++) { const t = i / 16 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); prof.push([Math.sign(c) * Math.abs(c) ** .35, Math.sign(s) * Math.abs(s) ** .35]); }
  for (let i = 0; i <= N; i++) {
    const u = i / N, p = curve.getPoint(u), tg = curve.getTangent(u).normalize();
    const sideV = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3().crossVectors(tg, sideV).normalize().negate();
    const h = 7.4 - 1.6 * u, w = 4.2 - 1.2 * u;   // a thick acetate arm, about 7 mm tall at the hinge
    for (const [a, b] of prof) { const q = p.clone().addScaledVector(sideV, a * w / 2).addScaledVector(up, b * h / 2); pos.push(q.x, q.y, q.z); }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < 16; j++) { const a = i * 16 + j, b = i * 16 + (j + 1) % 16; idx.push(a, a + 16, b, b, a + 16, b + 16); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const grp = new THREE.Group(), arm = new THREE.Mesh(g, acetate); arm.renderOrder = 3; grp.add(arm);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(.6, 1.2, 26), metal); strip.position.set(side * 2.15, 1.2, -18); grp.add(strip);   // the long silver T on the outside of the arm:
  const cross = new THREE.Mesh(new THREE.BoxGeometry(.6, 4.6, 1.2), metal); cross.position.set(side * 2.15, 1.2, -4.6); grp.add(cross);    // stem along the arm, short crossbar near the hinge
  return grp;
}

export function buildTomFord() {
  const acetate = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0b, roughness: .22, metalness: 0, clearcoat: 1, clearcoatRoughness: .025, envMapIntensity: .85 });   // glossy black, like the real frame
  const metal = new THREE.MeshStandardMaterial({ color: 0xeceef0, metalness: 1, roughness: .12, envMapIntensity: 1.3 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9b46c, metalness: 1, roughness: .2 });   // kept for other colourways; this one has silver T's
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: .04, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: .18 });
  // the arms are mostly seen through the lenses or against the skin: less mirror-like, so they stay black like the real ones
  const armAcetate = acetate.clone(); armAcetate.envMapIntensity = .25; armAcetate.clearcoat = .5;
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
  return { root, front, temples, lenses: [TF_LENS_L, TF_LENS_R], materials: { acetate, metal, gold, lensMat } };
}
