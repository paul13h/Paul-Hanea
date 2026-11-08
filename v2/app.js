import * as THREE from 'three';
import { studioEnv } from './env.js?v=14';
import { buildSpitzer, SPEC as SPEC_SP } from './spitzer.js?v=14';
import { buildTomFord, SPEC as SPEC_TF } from './tomford.js?v=14';
import { REF, RIGID as RIGID_ALL } from './face-ref.js?v=14';
// Points on the outline of the face slide along the silhouette when the head turns, so they are left out of the pose.
const EDGE = new Set([127, 356, 234, 454, 21, 251, 54, 284, 103, 332, 67, 297, 162, 389, 93, 323, 132, 361, 58, 288]);
const RIGID = RIGID_ALL.filter(k => !EDGE.has(k));
import { v, q, solvePose, initialPose, OneEuro, QuatFilter, refineModel, median, noseProfile, seatOnNose } from './solver.js?v=14';

const $ = id => document.getElementById(id);
const stage = $('stage'), canvas = $('view'), videoEl = $('video');
const startView = $('startView'), scanView = $('scanView'), scanText = $('scanText'), scanBar = $('scanBar'), fitCard = $('fitCard');

// ---------------------------------------------------------------- scene
const QS = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: 'high-performance', preserveDrawingBuffer: QS.has('capture') });
renderer.setPixelRatio(1);   // draw the frame at the camera's own resolution, so it is exactly as sharp as the video
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.environment = studioEnv(renderer);
// Reflections from the real room: the camera image, blurred and wrapped around the glasses, refreshed every second.
const envC = document.createElement('canvas'); envC.width = 256; envC.height = 128; const envX = envC.getContext('2d');
const pmrem = new THREE.PMREMGenerator(renderer); let envRT = null;
function roomEnv(img, w, h) {
  envX.filter = 'blur(6px)';
  envX.drawImage(img, 0, 0, w, h * .7, -20, -10, 296, 92);              // room behind the camera, approximated by what it sees
  envX.drawImage(img, 0, h * .55, w, h * .45, -20, 78, 296, 60);
  envX.filter = 'none';
  const g = envX.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(.35, 'rgba(255,255,255,0)'); g.addColorStop(.75, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
  envX.fillStyle = g; envX.fillRect(0, 0, 256, 128);
  envX.fillStyle = 'rgba(255,255,255,.95)'; envX.fillRect(118, 6, 20, 14);   // a soft ceiling light for highlights on metal and gloss
  envX.filter = 'blur(3px)'; envX.fillStyle = 'rgba(255,255,255,.75)'; envX.fillRect(150, 22, 44, 30); envX.fillRect(52, 26, 30, 24); envX.filter = 'none';   // windows / bright walls
  const t = new THREE.CanvasTexture(envC); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  const rt = pmrem.fromEquirectangular(t); t.dispose();
  if (envRT) envRT.dispose(); envRT = rt; scene.environment = rt.texture;
}
const bg = document.createElement('canvas'), bgCtx = bg.getContext('2d', { alpha: false });
const bgTex = new THREE.CanvasTexture(bg); bgTex.colorSpace = THREE.SRGBColorSpace; scene.background = bgTex;
const FOV = +QS.get('fov') || 46;                                   // typical laptop or phone front camera, vertical
const camera = new THREE.PerspectiveCamera(FOV, 4 / 3, 20, 3000);
const cam = { f: 1, cx: 0, cy: 0 };
const head = new THREE.Group(); head.matrixAutoUpdate = false; scene.add(head);
const IS_TF = QS.get('frame') === 'tf', SPEC = IS_TF ? SPEC_TF : SPEC_SP;
const glasses = IS_TF ? buildTomFord() : buildSpitzer(); head.add(glasses.root); head.visible = false;
if (IS_TF) { document.title = 'Tom Ford FT5902-B – Virtuelle Anprobe'; document.querySelector('header b').textContent = 'Tom Ford FT5902-B'; document.querySelector('aside h2').textContent = 'FT5902-B'; document.querySelector('aside .p').textContent = '54□17-145 · Schwarz'; }
if (QS.has('ghost')) glasses.root.traverse(o => { if (o.isMesh && o.material.colorWrite !== false && o.renderOrder >= 0 && o.renderOrder < 6) { o.material = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: .45, depthWrite: false }); } });

// soft contact shadow that the frame casts on the face
(function addShadow() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 512, 256);
  // the shadow follows the rims of this frame, a little below them, never across the middle of the lens
  const k = 512 / 146, px = (p, dy) => [256 + p[0] * k, 128 - (p[1] + 2.5 - dy) * k];
  x.filter = 'blur(7px)'; x.strokeStyle = 'rgba(60,44,36,.42)'; x.lineWidth = 3.4 * k; x.lineJoin = 'round';
  for (const c of glasses.lenses) { x.beginPath(); c.forEach((p, i) => { const [u, v] = px(p, 2.2); i ? x.lineTo(u, v) : x.moveTo(u, v); }); x.closePath(); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(146, 73), new THREE.MeshBasicMaterial({ map: t, blending: THREE.MultiplyBlending, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    // never inside the lens openings: with the head tilted the shadow would show there as a second, shifted rim
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.KeepStencilOp }));
  m.position.set(0, -2.5, -13); m.renderOrder = -1; m.visible = !QS.has('ghost'); glasses.root.add(m);
})();

// model with iris points appended (468-477)
function withIris(m) {
  const out = m.map(p => p.slice()), mid = (a, b) => [(m[a][0] + m[b][0]) / 2, (m[a][1] + m[b][1]) / 2, (m[a][2] + m[b][2]) / 2 + 4];
  const c1 = mid(33, 133), c2 = mid(263, 362), r = 5.85;
  const ring = c => [c, [c[0] + r, c[1], c[2]], [c[0], c[1] + r, c[2]], [c[0] - r, c[1], c[2]], [c[0], c[1] - r, c[2]]];
  // MediaPipe order: 468 centre, then 469..472; 473 centre, then 474..477
  return out.concat(ring(c1), ring(c2));
}
// Paul (v14): the frame looks best a little lower than where his real one sits, so start 2 mm lower (= 4 taps on "Tiefer").
const SEAT_DROP = +(QS.get('sd') ?? 2);
let model = withIris(REF), tris = [], scanned = false, fit = null, nudge = -SEAT_DROP;

// occluders: hide the temples behind the head and the near face
const occMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
const faceGeo = new THREE.BufferGeometry();
faceGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(468 * 3), 3));
const faceOcc = new THREE.Mesh(faceGeo, occMat); faceOcc.renderOrder = -2; faceOcc.frustumCulled = false; head.add(faceOcc);
const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), occMat); skull.renderOrder = -2; skull.visible = false; head.add(skull);

function buildTris() {
  if (typeof FACEMESH_TESSELATION === 'undefined') return;
  const adj = new Map();
  for (const [a, b] of FACEMESH_TESSELATION) { if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set()); adj.get(a).add(b); adj.get(b).add(a); }
  const idx = [];
  for (const [a, nb] of adj) for (const b of nb) { if (b <= a) continue; for (const c of nb) { if (c > b && adj.get(b).has(c)) idx.push(a, b, c); } }
  tris = idx; window.__tris = idx; faceGeo.setIndex(idx);
}

function setOccluders() {
  const p = faceGeo.attributes.position, c = [0, -8, -72];
  const eyeY = (model[133][1] + model[362][1]) / 2, tipY = model[1][1];
  for (let i = 0; i < 468; i++) { const m = model[i];
    // the nose keeps its full size (plus 1 mm), so it can hide the far lens when the head turns
    const ax = Math.abs(m[0] - model[168][0]);
    const nose = ax < 13 && m[1] < eyeY - 1 && m[1] > tipY - 4;
    // the top of the nose between the eyes is always behind the bridge of the frame: keep it well back,
    // or it pokes through the top bar and leaves an empty notch
    const bridge = ax < 18 && m[1] >= eyeY - 1 && m[1] < eyeY + 24;
    const side = ax > 44 && m[1] > model[1][1];   // near the temples the arms run over the face surface
    const k = nose ? 1 : side ? .985 - Math.min(.11, (ax - 44) * .006) : .985;
    p.setXYZ(i, c[0] + (m[0] - c[0]) * k, c[1] + (m[1] - c[1]) * k, c[2] + (m[2] - c[2]) * k + (nose ? 1 : bridge ? -4 : 0)); }
  p.needsUpdate = true; faceGeo.computeBoundingSphere();
  const ex = (Math.abs(model[234][0]) + Math.abs(model[454][0])) / 2;
  // the back of the head hides the far arm; it stays narrower than the sides of the face so the near arm, which runs
  // just outside the head, is never hidden
  skull.scale.set(ex - 7, 96, 92); skull.position.set((model[234][0] + model[454][0]) / 2, 8, model[234][2] - 30);
}

// ---------------------------------------------------------------- fit engine
function computeFit() {
  const midX = (model[168][0] + (model[33][0] + model[263][0]) / 2) / 2;
  // nose slices are measured from the centre line
  const centred = model.map(p => [p[0] - midX, p[1], p[2]]);
  const eyeLine = (centred[133][1] + centred[362][1]) / 2;
  // the bridge area only: a frame cannot rest on the brow or on the tip of the nose
  const rows = tris.length ? noseProfile(centred, tris, 7).filter(r => r.y < eyeLine - 3 && r.y > eyeLine - 19) : [];
  const seat = seatOnNose(rows, SPEC.padHalfX) || { y: eyeLine - 11, z: model[168][2] - 9, contact: false };
  const pupil = v.mul(v.add(model[468], model[473]), .5), eyeZ = Math.max(model[468][2], model[473][2]) + 2.5;
  let seatZ = seat.z;
  const backZ = seatZ - SPEC.padZ - 3.4;                 // back of the lens at the eye
  if (backZ < eyeZ + 10) seatZ += eyeZ + 10 - backZ;     // lenses never touch the lashes
  // the arm passes just outside the widest part of the face next to the eyes and reaches the ear
  const sideX = Math.max(...[234, 454, 127, 356, 162, 389].map(k => Math.abs(model[k][0] - midX)));
  const earR = [sideX + 2.5, (model[356][1] + model[127][1]) / 2 + 10,   // top of the ear, where the arm rests (above the side landmarks)
    (model[356][2] + model[127][2]) / 2 - 7];
  const hy = seat.y - SPEC.padY + SPEC.hingeY, hz = seatZ - SPEC.padZ + SPEC.hingeZ;
  let tilt = Math.atan2(earR[1] - hy, hz - earR[2]) + 2 * Math.PI / 180;
  tilt = (Math.max(5, Math.min(12, tilt * 57.3)) + TILT_X) / 57.3;
  const open = Math.atan2(earR[0] - SPEC.hingeX, hz - earR[2]);
  // the arms are not glued to the front: they angle down from the hinge to the ear, whatever the tilt of the front
  const armDown = Math.max(0, Math.min(14 / 57.3, Math.atan2(hy - earR[1], hz - earR[2])));
  const ipd = v.len(v.sub(model[468], model[473]));
  const faceW = Math.abs(model[234][0] - model[454][0]);
  return { midX, seat, seatZ, tilt, open, armDown, ipd, faceW, pupilY: pupil[1], rows, contact: seat.contact };
}

const basePos = new THREE.Vector3();
function applyFit() {
  if (!fit) return;
  const r = glasses.root; r.rotation.set(fit.tilt, 0, 0);
  const pad = new THREE.Vector3(0, SPEC.padY, SPEC.padZ).applyEuler(r.rotation);
  r.position.set(fit.midX - pad.x, fit.seat.y + nudge - pad.y, fit.seatZ - pad.z);
  basePos.copy(r.position);
  const a = Math.max(-.05, Math.min(.2, fit.open));
  glasses.temples.L.rotation.set(-(fit.armDown + fit.tilt), -a, 0); glasses.temples.R.rotation.set(-(fit.armDown + fit.tilt), a, 0);
}

function renderFitCard() {
  const fw = 2 * SPEC.hingeX + 5, ratio = fw / fit.faceW;
  const width = ratio > 1.04 ? 'etwas breit' : ratio < .9 ? 'etwas schmal' : 'passend';
  const seatDrop = fit.pupilY - (fit.seat.y + nudge - SPEC.padY);
  const h = Math.abs(seatDrop) < 3 ? 'mittig vor den Augen' : seatDrop > 0 ? 'etwas tiefer' : 'etwas höher';
  $('fitWidth').textContent = width;
  $('fitHeight').textContent = h;
  $('fitPd').textContent = '≈ ' + Math.round(fit.ipd) + ' mm';
  $('fitNose').textContent = fit.contact ? 'Stege liegen am Nasenrücken an' : 'Stege ggf. anpassen';
  fitCard.hidden = false;
}

// ---------------------------------------------------------------- tracking and smoothing
let pose = null, W = 0, H = 0, lastT = 0, seen = 0, found = 0;
// Quick moves pass straight through; only tiny resting noise is filtered out.
// Tuned on real webcam footage: calm at rest, follows fast turns without trailing behind.
const rotF = new QuatFilter(2.5, 3), zF = new OneEuro(.8, .012), axF = new OneEuro(3, .5), ayF = new OneEuro(3, .5);
const ANCHOR = [168, 6];
// Both checked frame by frame against Paul's real Tom Ford (ghost=1 over his video, looking up, down and to the sides):
// TILT_X: the real front leans forward more than the fitted tilt (seen from below it looks taller, from above flatter).
// PARALLAX: in turned views the real front sits further towards the nose than the tracked bridge point suggests.
const PARALLAX = +(QS.get('px') ?? 9), TILT_X = +(QS.get('tx') ?? 12);
const YAW_KNEE = +(QS.get('yk') ?? 22), YAW_GAIN = +(QS.get('yg') ?? .55);
const resetFilters = () => { rotF.reset(); zF.reset(); axF.reset(); ayF.reset(); pose = null; };

function resize(w, h) {
  if (w === W && h === H) return;
  W = w; H = h; bg.width = w; bg.height = h; bgTex.dispose();
  renderer.setSize(w, h, false); canvas.style.aspectRatio = `${w} / ${h}`; stage.style.setProperty('--ar', `${w} / ${h}`);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  cam.f = (h / 2) / Math.tan(FOV * Math.PI / 360); cam.cx = w / 2; cam.cy = h / 2;
}

function track(lms, w, h, tMs) {
  const pts = lms.map(l => [l.x * w, l.y * h]);
  if (!pose) pose = solvePose(model, RIGID, pts, cam, initialPose(model, pts, cam), 18);
  else pose = solvePose(model, RIGID, pts, cam, pose, 3);
  if (pose.rms > 25) pose = solvePose(model, RIGID, pts, cam, initialPose(model, pts, cam), 18);   // lost: start again
  const dt = Math.max(.008, Math.min(.1, (tMs - lastT) / 1000)); lastT = tMs;
  let Rs = rotF.filter(pose.R, dt); const z = zF.filter(pose.t[2], dt);
  // Face tracking under-reads strong turns (the far side of the face is hidden), so add back part of the missing turn.
  const yw = yawOf(Rs), over = Math.abs(yw) - YAW_KNEE;
  if (over > 0) Rs = q.norm(q.mul(Rs, q.fromVec([0, Math.sign(yw) * YAW_GAIN * over / 57.3, 0])));
  // Anchor: tied to the nose bridge and inner eye corners, so the frame cannot slide on the face
  let ax = 0, ay = 0, am = [0, 0, 0];
  for (const i of ANCHOR) { ax += pts[i][0]; ay += pts[i][1]; am = v.add(am, model[i]); }
  const n = ANCHOR.length; ax = axF.filter(ax / n, dt); ay = ayF.filter(ay / n, dt); am = v.mul(am, 1 / n);
  const r = q.rot(Rs, am), Z = r[2] + z;
  const X = (ax - cam.cx) * -Z / cam.f, Y = (ay - cam.cy) * Z / cam.f;
  const t = [X - r[0], Y - r[1], z];
  return { R: Rs, t, pts, raw: pose };
}

const qObj = new THREE.Quaternion(), pObj = new THREE.Vector3(), sObj = new THREE.Vector3(1, 1, 1);
function setHead(p) {
  qObj.set(...p.R); pObj.set(...p.t); head.matrix.compose(pObj, qObj, sObj); head.matrixWorldNeedsUpdate = true; head.visible = true;
  // Parallax: when the head turns, the real frame shifts sideways against the tracked nose bridge as if it sat PARALLAX mm
  // further in front of it. Shift it sideways by that amount (not closer, which would enlarge it; up/down is handled by TILT_X).
  if (PARALLAX) {
    const c = v.mul(p.t, -1 / v.len(p.t)), ch = q.rot(q.conj(p.R), c), fc = ch[2];
    // sideways part of (head forward minus its part along the line of sight), in head coordinates
    glasses.root.position.set(basePos.x - PARALLAX * ch[0] * fc, basePos.y, basePos.z);
  } else glasses.root.position.copy(basePos);
  // the arm on the side turned away from the camera is behind the head; the near arm stays fully visible up to the ear
  for (const [name, s] of [['L', -1], ['R', 1]]) { const away = q.rot(p.R, [s, 0, 0])[2]; glasses.temples[name].visible = away > -.26; }
}

// ---------------------------------------------------------------- face scan
const scan = { on: false, step: 0, frames: [], t0: 0, sign: 0 };
function yawOf(R) { const f = q.rot(R, [0, 0, 1]); return Math.atan2(f[0], f[2]) * 57.3; }
function beginScan() {
  Object.assign(scan, { on: true, step: 0, frames: [], t0: null, sign: 0, every: 0 });
  head.visible = false; scanView.hidden = false; fitCard.hidden = true; say('Bitte schauen Sie gerade in die Kamera.', 0);
}
function say(text, p) { scanText.textContent = text; scanBar.style.width = Math.round(p * 100) + '%'; }
function scanStep(tr, now) {
  if (scan.t0 === null) scan.t0 = now;
  const yaw = yawOf(tr.raw.R), el = now - scan.t0;
  if (++scan.every % 2 === 0 && scan.frames.length < 90) scan.frames.push({ pts: tr.pts, pose: { R: tr.raw.R, t: tr.raw.t }, yaw });
  if (scan.step === 0) { say('Bitte schauen Sie gerade in die Kamera.', Math.min(.2, el / 5000)); if (el > 1000 && Math.abs(yaw) < 12) scan.step = 1; }
  else if (scan.step === 1) { say('Drehen Sie den Kopf langsam zu einer Seite.', .2 + Math.min(.3, Math.abs(yaw) / 60)); if (Math.abs(yaw) > 17) { scan.sign = Math.sign(yaw); scan.step = 2; } }
  else if (scan.step === 2) { say('Und jetzt langsam zur anderen Seite.', .5 + Math.min(.35, Math.max(0, -scan.sign * yaw) / 50)); if (-scan.sign * yaw > 17) scan.step = 3; }
  else if (scan.step === 3) { say('Fast fertig. Schauen Sie wieder geradeaus.', .9); if (Math.abs(yaw) < 8) finishScan(); }
  if (el > 14000) finishScan();
}
function finishScan() {
  scan.on = false; scanView.hidden = true;
  if (scan.frames.length >= 12) {
    const fr = scan.frames;
    for (let pass = 0; pass < 2; pass++) {
      model = refineModel(model, fr, cam, 478, pass ? .01 : .03);
      for (const f of fr) f.pose = solvePose(model, RIGID, f.pts, cam, f.pose, 4);
    }
    // real size from the iris, which is close to 11.7 mm wide in almost all adults
    const sizes = [];
    for (const f of fr) if (Math.abs(f.yaw) < 12) {
      const d1 = Math.hypot(f.pts[469][0] - f.pts[471][0], f.pts[469][1] - f.pts[471][1]), d2 = Math.hypot(f.pts[474][0] - f.pts[476][0], f.pts[474][1] - f.pts[476][1]);
      const mm = ((d1 + d2) / 2) * -f.pose.t[2] / cam.f; sizes.push(11.7 / mm);
    }
    const s = sizes.length ? Math.max(.82, Math.min(1.18, median(sizes))) : 1;
    model = model.map(p => v.mul(p, s));
    scanned = true;
  }
  resetFilters(); setOccluders(); fit = computeFit(); applyFit(); renderFitCard();
}

// ---------------------------------------------------------------- frame loop
function adaptLight(ctx) {
  // match the frame's brightness to the room
  const d = ctx.getImageData(W * .25 | 0, H * .2 | 0, W * .5 | 0, H * .5 | 0).data; let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 400) { s += .3 * d[i] + .6 * d[i + 1] + .1 * d[i + 2]; n++; }
  const lum = s / n / 255; renderer.toneMappingExposure = Math.max(.75, Math.min(1.25, .7 + lum * .75));
}

function onResults(res) {
  const img = res.image, w = img.videoWidth || img.width, h = img.videoHeight || img.height, t0 = res.t ?? performance.now(), c0 = performance.now();
  resize(w, h); bgCtx.drawImage(img, 0, 0, w, h); bgTex.needsUpdate = true;
  const lms = res.multiFaceLandmarks && res.multiFaceLandmarks[0];
  if (!lms) { head.visible = false; resetFilters(); found = 0; renderer.render(scene, camera); return; }
  found++;
  const tr = track(lms, w, h, t0);
  if (scan.on) scanStep(tr, t0);
  if (!scan.on) { setHead(tr); head.visible = found > 4; }   // a face just found again is often misread for a few frames
  if (++seen % 30 === 1) { adaptLight(bgCtx); roomEnv(img, w, h); }
  renderer.render(scene, camera);
  window.__tryon.ms = performance.now() - c0; window.__tryon.pose = tr; window.__tryon.rms = tr.raw.rms;
}

let faceMesh = null, running = false, busy = false, stream = null;
async function ensureMesh() {
  if (faceMesh) return;
  faceMesh = new FaceMesh({ locateFile: f => `../lib/face_mesh/${f}` });
  faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: .6, minTrackingConfidence: .6 });
  faceMesh.onResults(onResults);
  await faceMesh.initialize();
}
function schedule() {
  if (!running) return;
  if (videoEl.requestVideoFrameCallback) videoEl.requestVideoFrameCallback(pump); else requestAnimationFrame(pump);
}
async function pump() {
  if (!running) return;
  if (!busy && videoEl.readyState >= 2) { busy = true; try { await faceMesh.send({ image: videoEl }); } catch (e) { console.error(e); } busy = false; }
  schedule();
}
async function start() {
  $('startBtn').disabled = true; $('startBtn').textContent = 'Lädt…'; $('err').textContent = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } } });
    videoEl.srcObject = stream; await videoEl.play(); await ensureMesh();
  } catch (e) {
    console.error(e); $('err').textContent = e && e.name === 'NotAllowedError' ? 'Bitte erlauben Sie den Zugriff auf die Kamera.' : 'Die Kamera konnte nicht gestartet werden.';
    $('startBtn').disabled = false; $('startBtn').textContent = 'Anprobe starten'; return;
  }
  startView.hidden = true; running = true; beginScan(); schedule();
}

$('startBtn').addEventListener('click', start);
$('skipBtn').addEventListener('click', () => { if (scan.on) finishScan(); });
$('rescanBtn').addEventListener('click', () => { model = withIris(REF); resetFilters(); beginScan(); });
$('upBtn').addEventListener('click', () => { nudge = Math.min(5, nudge + .5); applyFit(); renderFitCard(); });
$('downBtn').addEventListener('click', () => { nudge = Math.max(-5, nudge - .5); applyFit(); renderFitCard(); });

buildTris(); setOccluders(); fit = computeFit(); applyFit();
window.__tryon = { onResults, scan, glasses, camera, head, THREE, beginScan, finishScan, get model() { return model; }, get fit() { return fit; }, cam, yawOf, render: () => renderer.render(scene, camera), resize, stats: () => ({ scanned }) };
