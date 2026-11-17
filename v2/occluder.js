// Occluders, version 2 (?oc=1; ?oc=0 or no param keeps the v27 occluders exactly as they were).
// Invisible, depth-only meshes that hide the parts of the frame the real head would hide.
//  - Nose, per side: the nose occluder sits NOSE_Z (2.5 mm) behind the scanned nose so that it never cuts jagged pieces out of
//    the near lens's rim. On a turn that also let the far lens's rim show in front of the nose next to it, where the real nose
//    hides it (Paul's real frame, iPhone clip, yaw 30-50; the occluder's outline matches the real nose, ?ocv=1). Now the half of
//    the nose turned away from the camera, below the bridge, is moved towards the camera along the line of sight: its outline
//    in the picture stays exactly the same, but the far rim behind that outline is hidden. The near half stays where it was.
// ?ocv=1 (test only): draws the face occluder in translucent green, to compare its outline with the real nose and face.
export function initOcc({ THREE, head, faceGeo, QS }) {
  const mode = +(QS.get('oc') ?? 0);
  // d: mm the far half of the nose moves towards the camera; k: sin(yaw) at which it has moved all the way;
  // y0..y1: mm under the eye line where the move fades in (the bridge sits on the nose above that)
  const P = { d: +(QS.get('ofd') ?? 6), k: +(QS.get('ofk') ?? .3), y0: +(QS.get('oy0') ?? 12), y1: +(QS.get('oy1') ?? 18) };
  let last = null, nose = [], midX = 0, noseC = [0, 0, 0], nearZ = 0, eyeY = 0;
  if (QS.has('ocv')) {
    const m = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ color: 0x00ff40, transparent: true, opacity: .28, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = 20; m.frustumCulled = false; head.add(m);
  }
  // after setOccluders filled faceGeo: remember the nose vertices (base position without the NOSE_Z offset)
  function build(model, isNose, noseZ) {
    if (!mode) return;
    const p = faceGeo.attributes.position; midX = model[168][0]; nearZ = noseZ; nose = []; eyeY = (model[133][1] + model[362][1]) / 2;
    for (let i = 0; i < 468; i++) if (isNose[i]) nose.push({ i, x: p.getX(i), y: p.getY(i), z: p.getZ(i) - noseZ, ax: model[i][0] - midX });
    noseC = [model[4][0], model[4][1], model[4][2]];
  }
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // every frame: R (quaternion x,y,z,w) and t of the head
  function frame(R, t) {
    last = [R, t];
    if (!mode || !nose.length) return;
    // camera position in head coordinates: R^-1 (-t)
    const [qx, qy, qz, qw] = R, ix = -qx, iy = -qy, iz = -qz, px = -t[0], py = -t[1], pz = -t[2];
    const ux = 2 * (iy * pz - iz * py), uy = 2 * (iz * px - ix * pz), uz = 2 * (ix * py - iy * px);
    const cx = px + qw * ux + (iy * uz - iz * uy), cy = py + qw * uy + (iz * ux - ix * uz), cz = pz + qw * uz + (ix * uy - iy * ux);
    const dx = cx - noseC[0], dy = cy - noseC[1], dz = cz - noseC[2], s = dx / Math.hypot(dx, dy, dz);   // ~ sin(yaw), + = camera on +x
    const p = faceGeo.attributes.position;
    for (const n of nose) {
      // away: how far this vertex is on the side of the nose turned away from the camera; only below the frame's bridge
      // (seat ~11 mm under the eye line), so the bridge, which sits on the nose, is never cut
      const away = -Math.sign(n.ax) * s, k = sstep(.05, P.k, away) * sstep(.5, 3, Math.abs(n.ax)) * sstep(eyeY - P.y0, eyeY - P.y1, n.y);
      let x = n.x, y = n.y, z = n.z + nearZ * (1 - k);
      if (k > 0) { const ex = cx - x, ey = cy - y, ez = cz - z, d = P.d * k / Math.hypot(ex, ey, ez); x += ex * d; y += ey * d; z += ez * d; }
      p.setXYZ(n.i, x, y, z);
    }
    p.needsUpdate = true;
  }
  // test tools: change the parameters and redo the last frame (several variants from one tracking run)
  const set = o => { Object.assign(P, o); if (last) frame(...last); };
  return { mode, build, frame, set, P };
}
