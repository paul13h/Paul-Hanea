// Occluders, version 2 (?oc=1; ?oc=0 or no param keeps the v27 occluders exactly as they were).
// Invisible, depth-only meshes that hide the parts of the frame the real head would hide.
//  - Nose, per side: the nose occluder sits NOSE_Z (2.5 mm) behind the scanned nose so that it never cuts jagged pieces out of
//    the near lens's rim. On a turn that also let the far lens's rim show in front of the nose next to it, where the real nose
//    hides it (Paul's real frame, iPhone clip, yaw 30-50; the occluder's outline matches the real nose, ?ocv=1). Now the half of
//    the nose turned away from the camera, below the bridge, is moved towards the camera along the line of sight: its outline
//    in the picture stays exactly the same, but the far rim behind that outline is hidden. The near half stays where it was.
//  - The face mesh has holes at the eyes and the mouth; through the far eye's hole the far arm showed inside the head on strong
//    turns (yaw 60-75). They are closed (a fan of triangles over each opening).
//  - Far arm: v27 hid the arm on the side turned away from the camera as soon as the turn passed ~15° (it popped off, a few px
//    at the far corner). Now both arms are always drawn and the head hides them: the face occluder plus a skull (an ellipsoid
//    inside the arms that fills the head behind the face, so the far arm cannot show through the gap behind the edge of the
//    face mesh).
//  - ?olm=0 (test): the arms are also drawn behind the lenses (v11 masked them out with the lens shapes). On the real frame
//    the far arm does show through the far lens up to the edge of the face (laptop clip yaw 11-31 and -43, iPhone clip yaw
//    +33..+49), and with olm=0 its extent matches there, but ours is ~2x as thick and lower, and on the iPhone clip at yaw
//    -35..-45 it crosses the middle of the lens where the real one is not seen at all (our far arm runs lower than the real
//    one: fit track). So the lens mask stays on by default.
// ?ocv=1 (test only): draws the face occluder in translucent green, to compare its outline with the real nose and face.
export function initOcc({ THREE, head, faceGeo, glasses, occMat, QS }) {
  const mode = +(QS.get('oc') ?? 0);
  // d: mm the far half of the nose moves towards the camera; k: sin(yaw) at which it has moved all the way;
  // y0..y1: mm under the eye line where the move fades in (the bridge sits on the nose above that)
  const P = { d: +(QS.get('ofd') ?? 10), k: +(QS.get('ofk') ?? .3), y0: +(QS.get('oy0') ?? 8), y1: +(QS.get('oy1') ?? 14) };
  let last = null, nose = [], midX = 0, noseC = [0, 0, 0], nearZ = 0, eyeY = 0;
  const SK = { in: +(QS.get('osi') ?? 3), front: +(QS.get('osf') ?? -30), back: +(QS.get('osb') ?? -185), top: +(QS.get('ost') ?? 95), bot: +(QS.get('osd') ?? -70) };
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), occMat); skull.renderOrder = -2; skull.visible = false; head.add(skull);
  // arms drawn behind the lenses too (the lens shapes no longer mask them out; the head occluders hide what the head hides)
  const armMats = new Set();
  for (const t of Object.values(glasses.temples)) t.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.stencilWrite && m.stencilFunc === THREE.NotEqualStencilFunc) armMats.add(m); });
  const lensMask = on => { for (const m of armMats) m.stencilWrite = on; };
  if (mode) lensMask(QS.get('olm') !== '0');
  if (QS.has('ocv')) {
    const m = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ color: 0x00ff40, transparent: true, opacity: .28, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = 20; m.frustumCulled = false; head.add(m);
  }
  const HOLES = [[33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
    [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191]];
  let filled = false;
  // after setOccluders filled faceGeo: remember the nose vertices (base position without the NOSE_Z offset)
  function build(model, isNose, noseZ) {
    if (!mode) return;
    if (!filled && faceGeo.index) {
      const idx = Array.from(faceGeo.index.array);
      for (const r of HOLES) for (let j = 1; j < r.length - 1; j++) idx.push(r[0], r[j], r[j + 1]);
      faceGeo.setIndex(idx); filled = true;
    }
    const p = faceGeo.attributes.position; midX = model[168][0]; nearZ = noseZ; nose = []; eyeY = (model[133][1] + model[362][1]) / 2;
    for (let i = 0; i < 468; i++) if (isNose[i]) nose.push({ i, x: p.getX(i), y: p.getY(i), z: p.getZ(i) - noseZ, ax: model[i][0] - midX });
    noseC = [model[4][0], model[4][1], model[4][2]];
    // skull: an ellipsoid between the sides of the face (minus SK.in mm, so it stays inside the arms, which run 2.5 mm outside
    // them), from SK.front to SK.back mm behind the nose bridge, SK.bot..SK.top mm above it
    const side = Math.min(...[234, 127, 162].map(k => midX - model[k][0]), ...[454, 356, 389].map(k => model[k][0] - midX));
    const y0 = model[168][1], z0 = model[168][2];
    skull.scale.set(side - SK.in, (SK.top - SK.bot) / 2, (SK.front - SK.back) / 2);
    skull.position.set(midX, y0 + (SK.top + SK.bot) / 2, z0 + (SK.front + SK.back) / 2);
    skull.visible = true;
  }
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // every frame: R (quaternion x,y,z,w) and t of the head
  function frame(R, t) {
    last = [R, t];
    if (!mode || !nose.length) return;
    glasses.temples.L.visible = glasses.temples.R.visible = true;   // the head hides the far arm, not a cut-off angle
    // camera position in head coordinates: R^-1 (-t)
    const [qx, qy, qz, qw] = R, ix = -qx, iy = -qy, iz = -qz, px = -t[0], py = -t[1], pz = -t[2];
    const ux = 2 * (iy * pz - iz * py), uy = 2 * (iz * px - ix * pz), uz = 2 * (ix * py - iy * px);
    const cx = px + qw * ux + (iy * uz - iz * uy), cy = py + qw * uy + (iz * ux - ix * uz), cz = pz + qw * uz + (ix * uy - iy * ux);
    const dx = cx - noseC[0], dy = cy - noseC[1], dz = cz - noseC[2], s = dx / Math.hypot(dx, dy, dz);   // ~ sin(yaw), + = camera on +x
    const p = faceGeo.attributes.position;
    for (const n of nose) {
      // away: how far this vertex is on the side of the nose turned away from the camera; only below the frame's bridge
      // (seat ~11 mm under the eye line; the move is full from 14 mm down), so the bridge, which sits on the nose, is never cut
      const away = -Math.sign(n.ax) * s, k = sstep(.05, P.k, away) * sstep(.5, 3, Math.abs(n.ax)) * sstep(eyeY - P.y0, eyeY - P.y1, n.y);
      let x = n.x, y = n.y, z = n.z + nearZ * (1 - k);
      if (k > 0) { const ex = cx - x, ey = cy - y, ez = cz - z, d = P.d * k / Math.hypot(ex, ey, ez); x += ex * d; y += ey * d; z += ez * d; }
      p.setXYZ(n.i, x, y, z);
    }
    p.needsUpdate = true;
  }
  // test tools: change the parameters and redo the last frame (several variants from one tracking run)
  const set = o => { Object.assign(P, o); for (const k in o) if (k in SK) SK[k] = o[k]; if (o.skull !== undefined) skull.visible = !!o.skull; if (o.lensMask !== undefined) lensMask(!!o.lensMask); if (last) frame(...last); };
  return { mode, build, frame, set, P };
}
