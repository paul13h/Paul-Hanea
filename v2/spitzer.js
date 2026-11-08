// Akoni Spitzer, built as true 3D geometry from its product photos and published sizes.
// Units: mm. x right, y up, z towards the viewer. Origin: frame centre, at lens-centre height.
import * as THREE from 'three';
import { LENS } from './spitzer-data.js?v=11';

export const SPEC = {
  name: 'Akoni Spitzer', lens: 54, bridge: 18, temple: 142, price: '€ 880',
  padHalfX: 8.6,      // half distance between the nose pads
  padY: -8.5,         // pad contact height relative to lens centre
  padZ: -7.5,         // pad contact, behind the frame front
  hingeX: 70.5, hingeY: 20.4, hingeZ: -13.5,
  wrapR: 240,
  tilt: 8 * Math.PI / 180
};

const R = SPEC.wrapR;
const wrapZ = x => -x * x / (2 * R);

function bendGeometry(g, z0 = 0) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + wrapZ(p.getX(i)) + z0);
  p.needsUpdate = true; g.computeVertexNormals(); return g;
}

function offsetContour(pts, d) {
  const n = pts.length, out = [];
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sign = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 2 + n) % n], b = pts[(i + 2) % n];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    out.push([pts[i][0] + sign * d * ty / l, pts[i][1] - sign * d * tx / l]);
  }
  return out;
}

// Sweep a closed 2D profile (u across, v normal) along a 3D polyline.
function sweep(path, profile, opts = {}) {
  const up0 = opts.up || new THREE.Vector3(0, 1, 0), closed = !!opts.closed;
  const pos = [], idx = [], np = profile.length, m = path.length;
  for (let i = 0; i < m; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(m - 1, i + 1)];
    const t = b.clone().sub(a).normalize();
    const side = new THREE.Vector3().crossVectors(up0, t);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(t, side).normalize();
    const s = opts.scale ? opts.scale(i / (m - 1)) : 1;
    for (const [u, v] of profile) {
      const q = path[i].clone().addScaledVector(side, u * s).addScaledVector(up, v * s);
      pos.push(q.x, q.y, q.z);
    }
  }
  const segs = closed ? m : m - 1;
  for (let i = 0; i < segs; i++) for (let j = 0; j < np; j++) {
    const i1 = (i + 1) % m, j1 = (j + 1) % np;
    const a = i * np + j, b = i1 * np + j, c = i1 * np + j1, d = i * np + j1;
    idx.push(a, b, d, b, c, d);
  }
  if (!closed) { // caps
    const cap = (off, flip) => { const c = pos.length / 3; let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < np; j++) { cx += pos[(off + j) * 3]; cy += pos[(off + j) * 3 + 1]; cz += pos[(off + j) * 3 + 2]; }
      pos.push(cx / np, cy / np, cz / np);
      for (let j = 0; j < np; j++) { const a = off + j, b = off + (j + 1) % np; flip ? idx.push(c, b, a) : idx.push(c, a, b); } };
    cap(0, true); cap((m - 1) * np, false);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}

const rounded = (w, h, n = 10) => { const a = [];
  for (let i = 0; i < n * 2; i++) { const t = i / (n * 2) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const e = 0.45; a.push([Math.sign(c) * Math.abs(c) ** e * w / 2, Math.sign(s) * Math.abs(s) ** e * h / 2]); }
  return a; };
const circle = (d, n = 12) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * 2 * Math.PI) * d / 2, Math.sin(i / n * 2 * Math.PI) * d / 2]);

function lensMesh(contour) {
  // polar grid so the lens can carry a real curve
  let cx = 0, cy = 0; contour.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= contour.length; cy /= contour.length;
  const rings = 8, n = contour.length, pos = [], uv = [], idx = [];
  pos.push(cx, cy, 0); uv.push(.5, .5);
  for (let r = 1; r <= rings; r++) for (let i = 0; i < n; i++) {
    const t = r / rings, x = cx + (contour[i][0] - cx) * t, y = cy + (contour[i][1] - cy) * t;
    pos.push(x, y, 0); uv.push(0, (y + 20) / 40);
  }
  for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + (i + 1) % n);
  for (let r = 0; r < rings - 1; r++) for (let i = 0; i < n; i++) {
    const a = 1 + r * n + i, b = 1 + r * n + (i + 1) % n, c = a + n, d = b + n;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const dx = p.getX(i) - cx, dy = p.getY(i) - cy; p.setZ(i, wrapZ(p.getX(i)) - (dx * dx + dy * dy) / (2 * 150)); }
  g.computeVertexNormals(); return g;
}

function gradientTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#16302a'); g.addColorStop(.6, '#1f3d35'); g.addColorStop(1, '#2d5047');   // deep green, as in the product photos
  x.fillStyle = g; x.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildSpitzer() {
  const metal = new THREE.MeshStandardMaterial({ color: 0xe4e5e7, metalness: 1, roughness: .16 });
  const brushed = new THREE.MeshStandardMaterial({ color: 0xc8c9cb, metalness: 1, roughness: .38 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8b26a, metalness: 1, roughness: .25 });
  const acetate = new THREE.MeshPhysicalMaterial({ color: 0x7d8792, metalness: 0, roughness: .12, clearcoat: 1, clearcoatRoughness: .06, envMapIntensity: .45,
    transparent: true, opacity: .5, side: THREE.DoubleSide });
  const shield = acetate.clone(); shield.opacity = .28;
  const pad = new THREE.MeshPhysicalMaterial({ color: 0xd8dcdc, roughness: .2, clearcoat: 1, transparent: true, opacity: .55 });
  const tint = new THREE.MeshBasicMaterial({ map: gradientTexture(), blending: THREE.MultiplyBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const gloss = new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0, roughness: .05, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

  const root = new THREE.Group(), front = new THREE.Group(); root.add(front);
  const add = (geo, mat, order = 2, parent = front) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = order; parent.add(m); return m; };

  const left = LENS, right = LENS.map(([x, y]) => [-x, y]).reverse();
  for (const c of [left, right]) {
    add(lensMesh(c), tint, 5);
    add(lensMesh(c), gloss, 6);
    const outer = offsetContour(c, 3.5);
    const sh = new THREE.Shape(outer.map(p => new THREE.Vector2(p[0], p[1])));
    sh.holes.push(new THREE.Path(offsetContour(c, -0.15).map(p => new THREE.Vector2(p[0], p[1]))));
    const rim = new THREE.ExtrudeGeometry(sh, { depth: 2.4, bevelEnabled: true, bevelThickness: .7, bevelSize: .55, bevelSegments: 3, curveSegments: 4, steps: 2 });
    rim.translate(0, 0, -1.2);
    add(bendGeometry(rim), acetate, 3);
    // fine metal line around the lens groove
    const wire = c.concat([c[0]]).map(p => new THREE.Vector3(p[0], p[1], wrapZ(p[0]) + 1.25));
    add(sweep(wire, circle(.55, 6), { up: new THREE.Vector3(0, 0, 1) }), brushed, 4);
  }

  // Double top bar with machined grooves
  const barPath = []; for (let x = -38; x <= 38.01; x += 2) barPath.push(new THREE.Vector3(x, 23.6 + 1.1 * Math.cos(x / 38 * 1.57), wrapZ(x) + 2.2));
  const grooved = []; const hw = 2.5, ht = .7;
  for (let i = 0; i <= 18; i++) { const u = -hw + 2 * hw * i / 18; grooved.push([ht + .16 * Math.cos(u * 8.5), u]); }
  for (let i = 0; i <= 18; i++) { const u = hw - 2 * hw * i / 18; grooved.push([-ht, u]); }
  add(sweep(barPath, grooved.map(([v, u]) => [u, v]), { up: new THREE.Vector3(0, 0, 1) }), metal);
  // metal shoulders from bar down to the hinges
  for (const s of [-1, 1]) {
    const path = [[38, 25], [46, 25.3], [55, 24.8], [63, 23.6], [69, 21.9], [72.5, 20.6]].map(([x, y]) => new THREE.Vector3(s * x, y, wrapZ(x) + 1.6));
    add(sweep(path, rounded(3.6, 1.5, 6), { up: new THREE.Vector3(0, 0, 1), scale: t => 1 - .25 * t }), metal);
    // hinge block
    const hinge = new THREE.Mesh(new THREE.BoxGeometry(5, 5.5, 8), metal);
    hinge.position.set(s * 71.5, 20.2, wrapZ(71.5) - 2); front.add(hinge);
    // side shield
    const pos = [], idx = [], rows = 22, cols = 7;
    const outerC = offsetContour(s < 0 ? left : right, 3.6).filter(p => Math.abs(p[0]) > 54 && p[1] < 22);
    outerC.sort((a, b) => b[1] - a[1]);
    for (let r = 0; r < rows; r++) {
      const q = outerC[Math.round(r / (rows - 1) * (outerC.length - 1))], t = r / (rows - 1);
      const depth = 14 * Math.sin(Math.PI * Math.min(1, .16 + t * .86)) ** .65;
      for (let c = 0; c < cols; c++) { const v = c / (cols - 1), z = wrapZ(q[0]) - .5 - depth * v;
        pos.push(q[0] + s * 4.5 * Math.sin(v * 1.35), q[1] + (t < .5 ? -1 : 1) * 1.8 * v, z); }
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) { const a = r * cols + c; idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    add(g, shield, 7);
    // nose pad and pad arm
    const padM = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), pad);
    padM.scale.set(1.5, 6.2, 3.1); padM.position.set(s * SPEC.padHalfX, SPEC.padY, SPEC.padZ + 2.5); padM.rotation.z = s * .22; padM.rotation.y = s * .45; padM.renderOrder = 7; front.add(padM);
    const arm = new THREE.CatmullRomCurve3([new THREE.Vector3(s * 11.5, 4, 0), new THREE.Vector3(s * 9.8, -1, -.4), new THREE.Vector3(s * 9.5, -6, -2.5), new THREE.Vector3(s * 8.9, -8, -4)]).getPoints(16);
    add(sweep(arm, circle(.7, 8), { up: new THREE.Vector3(0, 0, 1) }), metal);
  }
  // lower bridge
  const low = []; for (let x = -13; x <= 13.01; x += 1.3) low.push(new THREE.Vector3(x, 11.4 + 1.4 * (1 - (x / 13) ** 2), wrapZ(x) + 1.2));
  add(sweep(low, rounded(2.8, 1.2, 6), { up: new THREE.Vector3(0, 0, 1) }), brushed);

  // Temples: separate pivots, so they can open to reach each person's ears
  const temples = {};
  for (const [name, s] of [['L', -1], ['R', 1]]) {
    const pivot = new THREE.Group(); pivot.position.set(s * SPEC.hingeX, SPEC.hingeY, SPEC.hingeZ); root.add(pivot);
    const p1 = new THREE.CatmullRomCurve3([[0, 0, 4], [0, 0, -14], [0, -.4, -46], [0, -1.8, -84]].map(a => new THREE.Vector3(...a))).getPoints(36);
    add(sweep(p1, rounded(1.1, 2.8, 6), { up: new THREE.Vector3(0, 1, 0), scale: t => 1 - .22 * t }), brushed, 2, pivot);
    const p2 = new THREE.CatmullRomCurve3([[0, -1.8, -84], [0, -2.6, -102], [0, -5, -116], [0, -12.5, -130], [0, -22, -139]].map(a => new THREE.Vector3(...a))).getPoints(40);
    add(sweep(p2, rounded(2.2, 3.8, 8), { up: new THREE.Vector3(0, 1, 0) }), acetate, 3, pivot);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.45, 3.2, 14), gold); tip.position.set(0, -23.2, -140.4); tip.rotation.x = .85; pivot.add(tip);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, .42, 8, 18), new THREE.MeshStandardMaterial({ color: 0x20262a, roughness: .4 })); ring.position.set(0, -1.8, -84); pivot.add(ring);
    temples[name] = pivot;
  }
  front.rotation.x = 0;
  return { root, front, temples, lenses: [left, right], materials: { metal, brushed, acetate, shield, tint, gloss } };
}
