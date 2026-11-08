// Tom Ford FT5902-B, black acetate, 54□17-145. Built from Paul's own frame (photos + webcam video).
// Units: mm. x right, y up, z towards the viewer. Origin: frame centre at lens-centre height.
import * as THREE from 'three';
import { TF_OUTER, TF_LENS_L, TF_LENS_R } from './tomford-data.js?v=7';

export const SPEC = {
  name: 'Tom Ford FT5902-B', lens: 54, bridge: 17, temple: 145, price: '€ 330',
  padHalfX: 8.8,      // where the acetate bridge touches the sides of the nose
  padY: -10.5,        // calibrated: the real frame rides this much higher than the first estimate
  padZ: -5.8,
  hingeX: 66.2, hingeY: 13, hingeZ: -6.5,
  wrapR: 320
};
const wrapZ = x => -x * x / (2 * SPEC.wrapR);
const bend = g => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + wrapZ(p.getX(i))); p.needsUpdate = true; g.computeVertexNormals(); return g; };
const v2 = a => a.map(p => new THREE.Vector2(p[0], p[1]));

function lensGeo(c) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(v2(c)), 24);
  const p = g.attributes.position; let cx = 0, cy = 0; c.forEach(q => { cx += q[0]; cy += q[1]; }); cx /= c.length; cy /= c.length;
  for (let i = 0; i < p.count; i++) { const dx = p.getX(i) - cx, dy = p.getY(i) - cy; p.setZ(i, -2.2 - (dx * dx + dy * dy) / 600); }
  return bend(g);
}

function temple(side, acetate, metal) {
  // a tapered acetate arm, straight to the ear, then bending down behind it
  const pts = [[0, 0, 0], [0, .3, -40], [0, 0, -95], [0, -2.5, -112], [0, -12, -128], [0, -24, -138]].map(a => new THREE.Vector3(...a));
  const curve = new THREE.CatmullRomCurve3(pts), N = 60, prof = [], pos = [], idx = [];
  for (let i = 0; i < 16; i++) { const t = i / 16 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); prof.push([Math.sign(c) * Math.abs(c) ** .35, Math.sign(s) * Math.abs(s) ** .35]); }
  for (let i = 0; i <= N; i++) {
    const u = i / N, p = curve.getPoint(u), tg = curve.getTangent(u).normalize();
    const sideV = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3().crossVectors(tg, sideV).normalize().negate();
    const h = 6.2 - 2.4 * Math.min(1, u * 1.6), w = 3.4 - 1.0 * u;
    for (const [a, b] of prof) { const q = p.clone().addScaledVector(sideV, a * w / 2).addScaledVector(up, b * h / 2); pos.push(q.x, q.y, q.z); }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < 16; j++) { const a = i * 16 + j, b = i * 16 + (j + 1) % 16; idx.push(a, a + 16, b, b, a + 16, b + 16); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const grp = new THREE.Group(), arm = new THREE.Mesh(g, acetate); arm.renderOrder = 3; grp.add(arm);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(.5, 1.1, 24), metal); strip.position.set(side * 1.75, .6, -15); grp.add(strip);   // the thin metal bar on the outside
  return grp;
}

export function buildTomFord() {
  const acetate = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: .3, metalness: 0, clearcoat: 1, clearcoatRoughness: .06 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xcfd0d2, metalness: 1, roughness: .22 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9b46c, metalness: 1, roughness: .2 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: .04, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: .55 });
  const root = new THREE.Group(), front = new THREE.Group(); root.add(front);

  const shape = new THREE.Shape(v2(TF_OUTER));
  for (const c of [TF_LENS_L, TF_LENS_R]) shape.holes.push(new THREE.Path(v2(c)));
  const fg = new THREE.ExtrudeGeometry(shape, { depth: 4.2, bevelEnabled: true, bevelThickness: .9, bevelSize: .8, bevelSegments: 4, curveSegments: 6, steps: 1 });
  fg.translate(0, 0, -4.6);
  const fm = new THREE.Mesh(bend(fg), acetate); fm.renderOrder = 2; front.add(fm);
  for (const c of [TF_LENS_L, TF_LENS_R]) { const m = new THREE.Mesh(lensGeo(c), lensMat); m.renderOrder = 6; front.add(m); }

  // gold "T" on both front corners
  for (const s of [-1, 1]) {
    const t = new THREE.Group(), x = s * 62.3;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(4.2, .8, .5), gold), stem = new THREE.Mesh(new THREE.BoxGeometry(.8, 3.6, .5), gold);
    bar.position.y = 1.6; t.add(bar, stem); t.position.set(x, 13.6, wrapZ(x) + .75); front.add(t);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, .4, 10), metal); pin.rotation.x = Math.PI / 2; pin.position.set(s * 63.4, 10.6, wrapZ(63.4) + .6); front.add(pin);
  }
  const temples = {};
  for (const [n, s] of [['L', -1], ['R', 1]]) {
    const pivot = new THREE.Group(); pivot.position.set(s * SPEC.hingeX, SPEC.hingeY, SPEC.hingeZ + wrapZ(SPEC.hingeX) * 0); root.add(pivot);
    pivot.add(temple(s, acetate, metal)); temples[n] = pivot;
  }
  return { root, front, temples, materials: { acetate, metal, gold, lensMat } };
}
