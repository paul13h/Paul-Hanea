import * as THREE from 'three';
import { studioEnv } from './env.js?v=27';
import { buildTomFord, SPEC as SPEC_TF } from './tomford.js?v=27';
import { REF, RIGID as RIGID_ALL } from './face-ref.js?v=27';
// Points on the outline of the face slide along the silhouette when the head turns, so they are left out of the pose.
const EDGE = new Set([127, 356, 234, 454, 21, 251, 54, 284, 103, 332, 67, 297, 162, 389, 93, 323, 132, 361, 58, 288]);
const RIGID = RIGID_ALL.filter(k => !EDGE.has(k));
import { v, q, solvePose, initialPose, OneEuro, QuatFilter, refineModel, median, noseProfile, seatOnNose } from './solver.js?v=27';

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
  const t = HDR ? hdrEnv() : new THREE.CanvasTexture(envC); t.mapping = THREE.EquirectangularReflectionMapping; if (!HDR) t.colorSpace = THREE.SRGBColorSpace;
  const rt = pmrem.fromEquirectangular(t); if (!HDR) t.dispose();
  if (envRT) envRT.dispose(); envRT = rt; scene.environment = rt.texture;
}
// v28 (polish): the camera image tops out at white, but the lamps and windows it shows are many times brighter than the walls.
// Glossy acetate looks glossy because it mirrors exactly those: dark everywhere, small bright highlights. With the clipped
// image as the room, the frame mirrored a dull grey everywhere instead. The brightest parts are now expanded (x up to 1 + HDR
// at white, from luminance HDR_KNEE up) into a half-float image, on the GPU. ?hdr=0: the old 8-bit room.
const HDR = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float')) ? +(QS.get('hdr') ?? 10) : 0;
const HDR_KNEE = +(QS.get('hk') ?? .7);
let hdrPass = null;
function hdrEnv() {   // expands the canvas image into a half-float target on the GPU (no per-pixel work in JavaScript)
  if (!hdrPass) {
    const tex = new THREE.CanvasTexture(envC); tex.colorSpace = THREE.SRGBColorSpace;
    const rt = new THREE.WebGLRenderTarget(256, 128, { type: THREE.HalfFloatType, depthBuffer: false });
    const mat = new THREE.ShaderMaterial({ uniforms: { t: { value: tex }, hk: { value: HDR_KNEE }, hdr: { value: HDR } }, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: `uniform sampler2D t; uniform float hk, hdr; varying vec2 vUv;
        void main() { vec3 c = texture2D(t, vUv).rgb; float l = dot(c, vec3(.2126, .7152, .0722)), k = max(0., (l - hk) / (1. - hk));
          gl_FragColor = vec4(c * (1. + hdr * k * k), 1.); }` });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false; const sc = new THREE.Scene(); sc.add(q);
    hdrPass = { tex, rt, sc, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }
  hdrPass.tex.needsUpdate = true;
  const prev = renderer.getRenderTarget(); renderer.setRenderTarget(hdrPass.rt); renderer.render(hdrPass.sc, hdrPass.cam); renderer.setRenderTarget(prev);
  return hdrPass.rt.texture;
}
const bg = document.createElement('canvas'), bgCtx = bg.getContext('2d', { alpha: false });
const bgTex = new THREE.CanvasTexture(bg); bgTex.colorSpace = THREE.SRGBColorSpace; scene.background = bgTex;
const FOV = +QS.get('fov') || 46;                                   // typical laptop or phone front camera, vertical
const camera = new THREE.PerspectiveCamera(FOV, 4 / 3, 20, 3000);
const cam = { f: 1, cx: 0, cy: 0 };
const head = new THREE.Group(); head.matrixAutoUpdate = false; scene.add(head);
const IS_TF = true, SPEC = SPEC_TF;
const glasses = buildTomFord(); head.add(glasses.root); head.visible = false;
if (IS_TF) { document.title = 'Tom Ford FT5902-B – Virtuelle Anprobe'; document.querySelector('header b').textContent = 'Tom Ford FT5902-B'; document.querySelector('aside h2').textContent = 'FT5902-B'; document.querySelector('aside .p').textContent = '54□17-145 · Schwarz'; }
if (QS.has('ghost')) glasses.root.traverse(o => { if (o.isMesh && o.material.colorWrite !== false && o.renderOrder >= 0 && o.renderOrder < 6) { o.material = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: .45, depthWrite: false, vertexColors: [].concat(o.material).some(m => m.vertexColors) }); } });

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

// ---------------------------------------------------------------- camera look (v28, polish track)
// The glasses were drawn straight over the camera image: razor-sharp edges and a deeper black than anything the webcam shows,
// which is what made them look pasted on. Now the frame (front, arms, T's) is drawn into its own multisampled buffer and laid
// over the camera image with (1) the camera's softness (blur measured on the eyes, see measureSoft), (2) the camera's black level: black
// acetate never shows darker than the darkest things in the same picture (hair, pupils; 1st percentile of the image, tinted
// like the image) — `lift` scales it, and (3) a little grain. Shadow and lenses are still drawn directly on the camera image.
// ?post=0: old direct drawing. Off with ghost=1.
const POST_ON = !QS.has('ghost') && QS.get('post') !== '0';
// soft: multiplier on the measured camera blur (?soft=0 sharp); softpx=N fixes it at N px instead of measuring
const SOFT = +(QS.get('soft') ?? 1), SOFT_PX = QS.has('softpx') ? +QS.get('softpx') : null, LIFT = +(QS.get('lift') ?? .85), GRAIN = +(QS.get('grain') ?? 1.5);
const L_RT = 1, L_DIRECT = 2, BOX_ON = QS.get('box') !== '0';
const look = { lift: new THREE.Vector3(), target: new THREE.Vector3(), seed: 0, sig: SOFT_PX ?? 1, sigs: [], skip: 0 };
let post = null;
function makePost() {
  const gl = renderer.getContext(), ok = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
  if (!ok) return null;
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: QS.get('rtf') === '8' ? THREE.UnsignedByteType : THREE.HalfFloatType, samples: +(QS.get('rts') ?? 4), stencilBuffer: true, depthBuffer: true });
  const mat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: rt.texture }, px: { value: new THREE.Vector2(.5, .5) }, sig: { value: 0 }, lift: { value: look.lift }, grain: { value: GRAIN }, seed: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `uniform sampler2D tex; uniform vec2 px; uniform float sig, grain, seed; uniform vec3 lift; varying vec2 vUv;
      void main() {
        vec4 s = vec4(0.); float wsum = 0.;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { float w = exp(-.5 * float(i * i + j * j)); s += w * texture2D(tex, vUv + vec2(i, j) * px * sig); wsum += w; }
        s /= wsum;   // premultiplied colour, so the blur also softens the edge against the camera image
        if (s.a < .003) discard;
        gl_FragColor = vec4(s.rgb / s.a, s.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        float n = fract(sin(dot(gl_FragCoord.xy + seed, vec2(12.9898, 78.233))) * 43758.5453) - .5;
        gl_FragColor.rgb = lift + (1. - lift) * gl_FragColor.rgb + n * grain / 255.;
      }`,
    transparent: true, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const qs = new THREE.Scene(); qs.add(quad);
  // safety net: if this browser cannot make a multisampled float buffer, keep the old direct drawing instead of no glasses
  try { renderer.setRenderTarget(rt); renderer.clear(); const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER); renderer.setRenderTarget(null);
    if (st !== gl.FRAMEBUFFER_COMPLETE) { rt.dispose(); return null; } }
  catch (e) { renderer.setRenderTarget(null); rt.dispose(); return null; }
  return { rt, mat, qs, qc: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
}
// every mesh keeps layer 0 (the old direct drawing); the frame goes on L_RT, shadow and lenses on L_DIRECT, the invisible
// occluders and lens masks on both
function assignLayers() {
  scene.traverse(o => { if (!o.isMesh) return; const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m.colorWrite === false) { o.layers.enable(L_RT); o.layers.enable(L_DIRECT); }
    else if (m.blending === THREE.MultiplyBlending || m.blending === THREE.AdditiveBlending) o.layers.enable(L_DIRECT);
    else o.layers.enable(L_RT); });
}
// How soft the camera image is, measured every 30 frames on the eyes (lashes, iris and lid edges are the sharpest edges in the
// picture): for an edge blurred by a gaussian of sigma s, (local contrast) / (steepest gradient) = s * sqrt(2 pi). The 10th
// percentile over the strongest 3% of edges, corrected for pixel size (checked on synthetic edges: within 0.1 px for s 0.8-2),
// read 0.8-1.1 px on Paul's laptop and iPhone clips (960x640). The frame then gets that blur minus its own (~0.4 px, multisampled).
function measureSoft(ctx, pts) {
  if (SOFT_PX !== null || !SOFT) return;
  if (look.sigs.length >= 5 && ++look.skip % 10) return;   // settled: every 10th time (~10 s)
  const a = pts[33], b = pts[263], x0 = Math.max(0, Math.min(a[0], b[0]) - 30 | 0), x1 = Math.min(W, Math.max(a[0], b[0]) + 30 | 0);
  const y0 = Math.max(0, Math.min(a[1], b[1]) - 40 | 0), y1 = Math.min(H, Math.max(a[1], b[1]) + 30 | 0), w = x1 - x0, h = y1 - y0;
  if (w < 60 || h < 30 || w * h > 400000) return;
  const d = ctx.getImageData(x0, y0, w, h).data, N = w * h, L = new Float32Array(N), mx = new Float32Array(N), mn = new Float32Array(N), C = new Uint8Array(N);
  for (let i = 0; i < N; i++) L[i] = .3 * d[i * 4] + .6 * d[i * 4 + 1] + .1 * d[i * 4 + 2];
  const R = 3;   // local contrast = max - min over 7 x 7 pixels (separable)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let hi = -1, lo = 1e9; const e = Math.min(w - 1, x + R); for (let k = Math.max(0, x - R); k <= e; k++) { const v = L[y * w + k]; if (v > hi) hi = v; if (v < lo) lo = v; } mx[y * w + x] = hi; mn[y * w + x] = lo; }
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let hi = -1, lo = 1e9; const e = Math.min(h - 1, y + R); for (let k = Math.max(0, y - R); k <= e; k++) { const i = k * w + x; if (mx[i] > hi) hi = mx[i]; if (mn[i] < lo) lo = mn[i]; } const c = Math.min(255, hi - lo | 0); C[y * w + x] = c; hist[c]++; }
  let thr = 255; for (let acc = 0; thr > 0 && (acc += hist[thr]) < N * .03; thr--);
  if (thr < 20) return;   // too flat (dark room, eyes closed): keep the last value
  const S = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (C[i] < thr) continue;
    const g = Math.hypot(L[i + 1] - L[i - 1], L[i + w] - L[i - w]) / 2; S.push(C[i] / (g * 2.5066 + 1e-6)); }
  if (S.length < 20) return;
  S.sort((p, q) => p - q); const e = S[Math.floor(S.length * .1)], cam = Math.sqrt(Math.max(0, e * e - .36));
  look.sigs.push(Math.sqrt(Math.max(0, cam * cam - .16))); if (look.sigs.length > 5) look.sigs.shift();
  look.sig = Math.min(3, median(look.sigs));
}
const clearC = new THREE.Color(), BOX = [], bv = new THREE.Vector3();
for (const x of [-78, 78]) for (const y of [-34, 34]) for (const z of [14, -150]) BOX.push([x, y, z]);
function screenBox() {
  glasses.root.updateWorldMatrix(true, false); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of BOX) { bv.set(...p).applyMatrix4(glasses.root.matrixWorld).project(camera); x0 = Math.min(x0, bv.x); x1 = Math.max(x1, bv.x); y0 = Math.min(y0, bv.y); y1 = Math.max(y1, bv.y); }
  const m = 8 + 4 * look.sig, X0 = Math.max(0, Math.floor((x0 + 1) / 2 * W - m)), Y0 = Math.max(0, Math.floor((y0 + 1) / 2 * H - m));
  const X1 = Math.min(W, Math.ceil((x1 + 1) / 2 * W + m)), Y1 = Math.min(H, Math.ceil((y1 + 1) / 2 * H + m));
  return X1 > X0 && Y1 > Y0 ? [X0, Y0, X1 - X0, Y1 - Y0] : null;   // GL pixels, origin bottom left
}
function draw() {
  const box = post && head.visible && screenBox();
  if (!box) { renderer.render(scene, camera); return; }
  look.lift.lerp(look.target, .15);
  const u = post.mat.uniforms; u.sig.value = SOFT * look.sig / .74;   // the 3x3 kernel's spread is .74 x its tap spacing
  u.px.value.set(1 / W, 1 / H); u.seed.value = (look.seed = (look.seed + 1) % 997);
  camera.layers.set(L_DIRECT); renderer.render(scene, camera);
  const bgSave = scene.background, a0 = renderer.getClearAlpha(); renderer.getClearColor(clearC);
  scene.background = null; renderer.setClearColor(0x000000, 0);
  post.rt.scissor.set(...box); post.rt.scissorTest = BOX_ON; renderer.setRenderTarget(post.rt);
  camera.layers.set(L_RT); renderer.render(scene, camera);
  renderer.setRenderTarget(null); scene.background = bgSave; renderer.setClearColor(clearC, a0);
  renderer.setScissor(...box); renderer.setScissorTest(BOX_ON);
  renderer.autoClear = false; renderer.render(post.qs, post.qc); renderer.autoClear = true;
  renderer.setScissorTest(false); camera.layers.set(0);
}

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
    // the nose keeps its full size, so it can hide the far lens when the head turns. NOSE_Z: v17 and before had it 1 mm
    // forward, which cut jagged pieces out of the near lens's rim next to the nose on turns; 2.5 mm back is clean
    const ax = Math.abs(m[0] - model[168][0]);
    const nose = ax < 13 && m[1] < eyeY - 1 && m[1] > tipY - 4;
    // the top of the nose between the eyes is always behind the bridge of the frame: keep it well back,
    // or it pokes through the top bar and leaves an empty notch
    const bridge = ax < 18 && m[1] >= eyeY - 1 && m[1] < eyeY + 24;
    const side = ax > 44 && m[1] > model[1][1];   // near the temples the arms run over the face surface
    // SIDE_K: how much the sides of the face are pulled in. v15 and before pulled them in up to 11% because the arms
    // pointed into the head; with the arms outside the head the full-width cheeks hide them from below, as on the real frame
    const k = nose ? 1 : side ? .985 - Math.min(SIDE_K, (ax - 44) * .006) : .985;
    p.setXYZ(i, c[0] + (m[0] - c[0]) * k, c[1] + (m[1] - c[1]) * k, c[2] + (m[2] - c[2]) * k + (nose ? NOSE_Z : bridge ? -4 : 0)); }
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
  const earR = [sideX + 2.5, (model[356][1] + model[127][1]) / 2 + EAR_Y,   // top of the ear, where the arm rests (above the side landmarks)
    (model[356][2] + model[127][2]) / 2 - 7];
  const hy = seat.y - SPEC.padY + SPEC.hingeY, hz = seatZ - SPEC.padZ + SPEC.hingeZ;
  let tilt = Math.atan2(earR[1] - hy, hz - earR[2]) + 2 * Math.PI / 180;
  tilt = (Math.max(5, Math.min(12, tilt * 57.3)) + TILT_X) / 57.3;
  const open = Math.atan2(earR[0] - SPEC.hingeX, hz - earR[2]);
  // each arm aims at its own side of the head: faces are not symmetric (Paul's is ~5 mm wider on one side), and aiming both at
  // the wider side left a gap between the arm and the head on the other
  const sideOf = ks => Math.max(...ks.map(k => Math.abs(model[k][0] - midX)));
  const openL = Math.atan2(sideOf([234, 127, 162]) + 2.5 - SPEC.hingeX, hz - earR[2]), openR = Math.atan2(sideOf([454, 356, 389]) + 2.5 - SPEC.hingeX, hz - earR[2]);
  // the arms are not glued to the front: they angle down from the hinge to the ear, whatever the tilt of the front
  // they may also rise a little: on Paul's head the top of the ear is higher than the hinge (real arm vs ghost, 3/4 views)
  const armDown = Math.max(ARM_MIN / 57.3, Math.min(14 / 57.3, Math.atan2(hy - earR[1], hz - earR[2])));
  // v19, RIGID_REL (SPEC.armAngle, Tom Ford): the angle between arm and front is fixed, as on a real frame, and the front's tilt
  // follows from where the ears are (TILT_X is then not used). With a free angle (v18) the arm met the front at ~23°, so its
  // silver line could not run straight into the T. Checked on Paul's laptop and iPhone clips with the real frame: the front
  // lands within ~1 mm of v18, the arms reach the top of the ear.
  if (RIGID_REL) tilt = RIGID_REL / 57.3 - armDown;
  // distance along the arm from the hinge to the top of the ear, where the arm goes behind the ear;
  // the side landmarks are in front of the ear, so its top is EAR_BACK mm further back (checked on profile views)
  const armLen = Math.hypot(earR[0] - SPEC.hingeX, earR[1] - hy, hz - earR[2] + EAR_BACK);
  const ipd = v.len(v.sub(model[468], model[473]));
  const faceW = Math.abs(model[234][0] - model[454][0]);
  return { midX, seat, seatZ, tilt, open, openL, openR, armDown, armLen, ipd, faceW, pupilY: pupil[1], rows, contact: seat.contact, earX: earR[0], earY: earR[1], earZ: earR[2] };
}

const basePos = new THREE.Vector3();
// downTilt: extra forward tilt of the front while the head looks down at the camera (set per frame by poseFit, degrees)
let downTilt = 0;
// Places the front and the arms. The front turns about the nose pads; `extra` (degrees) is added to the fitted tilt, and the
// arms are re-aimed from the moved hinge at the same ear point, so their ear ends stay where the fit put them. DOWN_LEN (dl):
// the arm's length to the ear is also re-measured from the moved hinge (the hinge comes up to ~8 mm forward; without this the arm
// faded out that much short of the ear).
let armLenNow = 0;
function placeFit(extra = 0) {
  const r = glasses.root, place = tilt => { r.rotation.set(tilt, 0, 0);
    const pad = new THREE.Vector3(0, SPEC.padY, SPEC.padZ).applyEuler(r.rotation);
    r.position.set(fit.midX - pad.x + OFF[0], fit.seat.y + nudge - pad.y + OFF[1], fit.seatZ - pad.z + OFF[2]);
    const h = new THREE.Vector3(0, SPEC.hingeY, SPEC.hingeZ).applyEuler(r.rotation).add(r.position);
    return [Math.atan2(h.y - fit.earY, h.z - fit.earZ), Math.hypot(fit.earX - SPEC.hingeX, h.y - fit.earY, h.z - fit.earZ + EAR_BACK)]; };
  let armDown = fit.armDown, tilt = fit.tilt, armLen = fit.armLen;
  if (extra) { const [a0, l0] = place(tilt); tilt += extra / 57.3; const [a1, l1] = place(tilt); armDown += a1 - a0; if (DOWN_LEN) armLen += l1 - l0; }
  else place(tilt);
  basePos.copy(r.position); armLenNow = armLen;
  // opening outwards: the left arm (x < 0) turns towards -x, the right towards +x (v14 and before had this reversed:
  // the arms ran into the head and were hidden by the cheek)
  const aL = Math.max(-.05, Math.min(.2, fit.openL ?? fit.open)), aR = Math.max(-.05, Math.min(.2, fit.openR ?? fit.open));
  glasses.temples.L.rotation.set(-(armDown + tilt), aL, 0); glasses.temples.R.rotation.set(-(armDown + tilt), -aR, 0);
}
function applyFit() {
  if (!fit) return;
  placeFit(downTilt);
  if (glasses.setArmEnd) glasses.setArmEnd(armLenNow);
}
// Looking down at the camera, Paul's real front is much flatter than a front that keeps its fitted tilt: on the laptop clip
// of 9 Nov (frames 656-680) its bottom rim matched, but its top bar and hinges were 7-10 mm lower in the picture, while the
// arm ends were on the ears. Looking up and straight it matched. A fixed larger arm angle (rig) fixes looking down but makes
// the front too tall looking up, and turning the whole head further lifts the arm ends off the ears (v21). So only the front
// leans further forward, about the nose pads, by DOWN_GAIN degrees per degree that the camera is above the face's forward
// direction (beyond DOWN_KNEE, at most DOWN_MAX), fading out in turned views, where it has not been checked.
// Tuned 17 Nov on both clips with the real frame (outer height of the front at the lens centre, real / dg=0 / gain 1 max 26 /
// gain 2 max 16 = now): iPhone imix 495 29.5 / 38.5 / 24.5 / 30 mm, imix 603 38.5 / 43.5 / 40 / 38.5; laptop kmix 664 28 / 43 / 31 /
// 31.5. Gain 1 hid the iris behind the top bar on the iPhone (bar's inner edge 9 mm too low); the laptop also needs the tilt at
// mild look-down (kmix 655/656/680/682, el 6-10), which gain 2 gives.
function poseFit(p) {
  if (!fit || !DOWN_GAIN) return;
  const c = v.mul(p.t, -1 / v.len(p.t)), ch = q.rot(q.conj(p.R), c);        // direction to the camera, in head coordinates
  const el = Math.asin(Math.max(-1, Math.min(1, ch[1]))) * 57.3, turn = Math.atan2(Math.abs(ch[0]), ch[2]) * 57.3;
  const d = Math.max(0, Math.min(DOWN_MAX, DOWN_GAIN * (el - DOWN_KNEE))) * Math.max(0, Math.min(1, (DOWN_TURN - turn) / 20));
  if (Math.abs(d - downTilt) > .02) { downTilt = d; placeFit(d); if (glasses.setArmEnd) glasses.setArmEnd(armLenNow); }
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
// v23: the rotation filter reacts faster to quick turns (beta 10, was 3): on Paul's laptop clips the glasses trail the head
// ~45% less on fast moves (p90 5.1 -> 2.8 px at the ear), while at rest they move 0.38 instead of 0.31 px per frame
const ROT_F = (QS.get('rf') ?? '2,10').split(',').map(Number);
const rotF = new QuatFilter(ROT_F[0], ROT_F[1]), zF = new OneEuro(.8, .012), axF = new OneEuro(3, .5), ayF = new OneEuro(3, .5);
const ANCHOR = [168, 6], ANCHOR_PNP = +(QS.get('ap') ?? 0);
// Both checked frame by frame against Paul's real Tom Ford (ghost=1 over his video, looking up, down and to the sides):
// TILT_X: the real front leans forward more than the fitted tilt (seen from below it looks taller, from above flatter).
// PARALLAX: in turned views the real front sits further towards the nose than the tracked bridge point suggests.
const DEBUG_NOOCC = QS.get('occ') === '0';   // test only: draw the arms without anything hiding them
const NOSE_Z = +(QS.get('nz') ?? -2.5), SIDE_K = +(QS.get('sk') ?? 0), ARM_MIN = +(QS.get('amin') ?? -8), EAR_BACK = +(QS.get('eb') ?? 8), EAR_Y = +(QS.get('ey') ?? SPEC.earY ?? 10), RIGID_REL = +(QS.get('rig') ?? SPEC.armAngle ?? 0);
const PARALLAX = +(QS.get('px') ?? 6), TILT_X = +(QS.get('tx') ?? 12);
const DOWN_KNEE = +(QS.get('dk') ?? 2), DOWN_GAIN = +(QS.get('dg') ?? 2), DOWN_MAX = +(QS.get('dm') ?? 16), DOWN_TURN = +(QS.get('dt') ?? 50), DOWN_LEN = +(QS.get('dl') ?? 1);
// OFF (test, ?ox/oy/oz, mm in head coordinates): a constant offset of the frame on the head, e.g. the drift track's fitted
// D = (+3, -2, 0) on the laptop clip (tools/drift/offset3d.mjs)
const OFF = ['ox', 'oy', 'oz'].map(k => +(QS.get(k) ?? 0));
const YAW_KNEE = +(QS.get('yk') ?? 22), YAW_GAIN = +(QS.get('yg') ?? .55);
// test only (off by default): extra look-down pitch below PITCH_KNEE, as v21 tried (pivots at the bridge anchor, so it also lifts the ears)
const PITCH_KNEE = +(QS.get('pk') ?? 3), PITCH_GAIN = +(QS.get('pg') ?? 0);
const resetFilters = () => { rotF.reset(); zF.reset(); axF.reset(); ayF.reset(); pose = null; };

function resize(w, h) {
  if (w === W && h === H) return;
  W = w; H = h; bg.width = w; bg.height = h; bgTex.dispose();
  renderer.setSize(w, h, false); if (post) post.rt.setSize(w, h); canvas.style.aspectRatio = `${w} / ${h}`; stage.style.setProperty('--ar', `${w} / ${h}`);
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
  if (PITCH_GAIN) { const f = q.rot(Rs, [0, 0, 1]), below = PITCH_KNEE - Math.atan2(f[1], Math.hypot(f[0], f[2])) * 57.3;
    if (below > 0) Rs = q.norm(q.mul(Rs, q.fromVec([PITCH_GAIN * below / 57.3, 0, 0]))); }
  // Anchor: tied to the nose bridge and inner eye corners, so the frame cannot slide on the face
  let ax = 0, ay = 0, am = [0, 0, 0];
  for (const i of ANCHOR) { ax += pts[i][0]; ay += pts[i][1]; am = v.add(am, model[i]); }
  const n = ANCHOR.length; ax /= n; ay /= n; am = v.mul(am, 1 / n);
  // ANCHOR_PNP (test, ?ap=0..1): take the bridge point from the whole-face pose instead of the two bridge landmarks alone
  if (ANCHOR_PNP) { const r0 = v.add(q.rot(pose.R, am), pose.t), px = cam.cx + cam.f * r0[0] / -r0[2], py = cam.cy + cam.f * r0[1] / r0[2];
    ax += ANCHOR_PNP * (px - ax); ay += ANCHOR_PNP * (py - ay); }
  ax = axF.filter(ax, dt); ay = ayF.filter(ay, dt);
  const r = q.rot(Rs, am), Z = r[2] + z;
  const X = (ax - cam.cx) * -Z / cam.f, Y = (ay - cam.cy) * Z / cam.f;
  const t = [X - r[0], Y - r[1], z];
  return { R: Rs, t, pts, raw: pose };
}

const qObj = new THREE.Quaternion(), pObj = new THREE.Vector3(), sObj = new THREE.Vector3(1, 1, 1);
function setHead(p) {
  poseFit(p);   // fit: look-down tilt of the front (sets basePos before it is used below)
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
  if (DEBUG_NOOCC) { faceOcc.visible = false; skull.visible = false; glasses.root.traverse(o => { if (o.material && o.material.colorWrite === false && !o.material.stencilWrite) o.visible = false; }); }
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
  // camera black level (v28): 1st percentile of the brightness, tinted a little like the whole picture (4th root of its colour
  // cast: the real frame in Paul's iPhone clip is almost neutral, rgb 57/54/53, in a warm picture, 149/140/128)
  const L = [], mean = [0, 0, 0];
  for (let i = 0; i < d.length; i += 400) { L.push(.3 * d[i] + .6 * d[i + 1] + .1 * d[i + 2]); mean[0] += d[i]; mean[1] += d[i + 1]; mean[2] += d[i + 2]; }
  L.sort((a, b) => a - b); const p1 = L[Math.floor(L.length * .01)] / 255, ml = (.3 * mean[0] + .6 * mean[1] + .1 * mean[2]) || 1;
  const t = mean.map(c => (c / ml) ** .25), k = Math.min(.22, p1 * LIFT);
  look.target.set(k * t[0], k * t[1], k * t[2]);
  if (look.lift.lengthSq() === 0) look.lift.copy(look.target);
}

function onResults(res) {
  if (warming) return;
  const img = (res.image === small ? cap : res.image), w = img.videoWidth || img.width, h = img.videoHeight || img.height, t0 = res.t ?? performance.now(), c0 = performance.now();
  const lms = res.multiFaceLandmarks && res.multiFaceLandmarks[0];
  // The face tracker misses frames in fast turns (on Paul's laptop clips up to 15% of the frames of a quick turn, in runs of
  // 1-8). Before v18 that hid the glasses (blinking); v18-v22 kept them at their last pose over the new camera image, so they
  // were left behind while the face moved on and then caught up. v23: for a short miss the whole picture, camera image and
  // glasses, stays on the last good frame (a tiny stutter instead of glasses trailing the face); a longer one shows the
  // camera without glasses.
  if (perf) { perf.result(!!lms); perf.size = w + '×' + h; }
  if (!lms) {
    if (lostAt === null) lostAt = t0;
    if (head.visible && t0 - lostAt <= FREEZE_MS) { if (perf) perf.frozen(); return; }
    if (t0 - lostAt > LOST_MS) { head.visible = false; resetFilters(); found = 0; }
    else head.visible = false;
    resize(w, h); bgCtx.drawImage(img, 0, 0, w, h); bgTex.needsUpdate = true;
    draw(); if (perf) { perf.hidden(); perf.drawn(performance.now() - c0); } return;
  }
  const m0 = performance.now(); resize(w, h); bgCtx.drawImage(img, 0, 0, w, h); bgTex.needsUpdate = true;
  lostAt = null;
  found++;
  const m1 = performance.now(), tr = track(lms, w, h, t0);
  if (scan.on) scanStep(tr, t0);
  if (!scan.on) { setHead(tr); head.visible = found > 4; }   // a face just found again is often misread for a few frames
  const m2 = performance.now();
  if (++seen % 30 === 1) { adaptLight(bgCtx); if (post) measureSoft(bgCtx, tr.pts); const a = performance.now(); roomEnv(img, w, h); if (perf) { perf.step('light', a - m2); perf.step('env', performance.now() - a); } }
  const m4 = performance.now(); draw();
  if (perf) { perf.step('bg', m1 - m0); perf.step('track', m2 - m1); perf.step('render', performance.now() - m4); }
  if (perf) { if (!head.visible && !scan.on) perf.hidden(); perf.drawn(performance.now() - c0); }
  window.__tryon.ms = performance.now() - c0; window.__tryon.pose = tr; window.__tryon.rms = tr.raw.rms;
}

// ---------------------------------------------------------------- ?stats=1: live performance overlay (open problem 4)
// For screen recordings in Safari. Per second: camera frames that arrived and how many of them never reached FaceMesh (it was
// still busy with the previous one; counted from requestVideoFrameCallback's presentedFrames), FaceMesh results and its time per frame, how often the picture was redrawn and the
// longest gap between redraws, frames held frozen (short miss) or shown without glasses (lost), and the display's own rate
// (if that drops, the main thread is blocked). The bottom line counts everything since the page opened.
// window.__tryon.perf has the same numbers, plus one entry per second in .log.
const SIMD = (() => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; } })();
const perf = QS.has('stats') ? makePerf() : null;
function makePerf() {
  const box = document.createElement('div'), txt = document.createElement('div'), g = document.createElement('canvas');
  box.style.cssText = 'position:fixed;left:8px;top:calc(8px + env(safe-area-inset-top,0px));z-index:9999;pointer-events:none;' +
    'font:11px/1.4 ui-monospace,Menlo,monospace;color:#fff;background:rgba(0,0,0,.72);padding:6px 8px;border-radius:6px;white-space:pre';
  g.width = 240; g.height = 44; g.style.cssText = 'display:block;margin-top:4px;width:240px;height:44px';
  box.append(txt, g); document.body.appendChild(box);
  const gx = g.getContext('2d'), gaps = [];
  const zero = () => ({ cam: 0, camLost: 0, sent: 0, res: 0, face: 0, frozen: 0, hidden: 0, draw: 0, raf: 0, mesh: 0, meshMax: 0, work: 0, gapMax: 0, gap50: 0 });
  const P = { s: zero(), tot: zero(), log: [], lastDraw: 0, lastPresented: null, t: performance.now(), size: '' };
  const add = (k, n = 1) => { P.s[k] += n; P.tot[k] += n; };
  P.camFrame = meta => {   // requestVideoFrameCallback: presentedFrames also counts camera frames that never reached a callback
    add('cam');
    if (meta && meta.presentedFrames != null) { if (P.lastPresented != null) add('camLost', Math.max(0, meta.presentedFrames - P.lastPresented - 1)); P.lastPresented = meta.presentedFrames; }
  };
  P.sent = () => add('sent');
  P.steps = {};   // main-thread ms per step of onResults: bg (video to canvas), track (pose), light, env (every 30th frame), render (incl. texture upload)
  P.step = (k, ms) => { const o = P.steps[k] || (P.steps[k] = { n: 0, sum: 0, max: 0 }); o.n++; o.sum += ms; if (ms > o.max) o.max = ms; };
  P.meshDone = ms => { add('mesh', ms); P.s.meshMax = Math.max(P.s.meshMax, ms); P.tot.meshMax = Math.max(P.tot.meshMax, ms); };
  P.result = face => { add('res'); if (face) add('face'); };
  P.frozen = () => add('frozen'); P.hidden = () => add('hidden');
  P.drawn = workMs => {
    const now = performance.now(), gap = P.lastDraw ? now - P.lastDraw : 0; P.lastDraw = now;
    add('draw'); add('work', workMs);
    if (gap) { gaps.push(gap); if (gaps.length > 120) gaps.shift(); P.s.gapMax = Math.max(P.s.gapMax, gap); P.tot.gapMax = Math.max(P.tot.gapMax, gap); if (gap > 50) add('gap50'); }
  };
  const f1 = x => x.toFixed(1), pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '–';
  function tick(now) {
    add('raf');
    const dt = (now - P.t) / 1000;
    if (dt >= 1) {
      const s = P.s, r = k => s[k] / dt;
      const e = { t: +(now / 1000).toFixed(1), camFps: +f1((s.cam + s.camLost) / dt), meshFps: +f1(r('res')), faceFps: +f1(r('face')), drawFps: +f1(r('draw')), dispFps: +f1(r('raf')),
        meshMs: s.sent ? +f1(s.mesh / s.sent) : 0, meshMax: +f1(s.meshMax), workMs: s.draw ? +f1(s.work / s.draw) : 0, gapMax: Math.round(s.gapMax),
        dropped: s.camLost, frozen: s.frozen, hidden: s.hidden, nCam: s.cam + s.camLost, nRes: s.res, nFace: s.face };
      P.log.push(e); if (P.log.length > 600) P.log.shift();
      const T = P.tot, L10 = P.log.slice(-10), sum = k => L10.reduce((a, x) => a + x[k], 0);
      // not tracked = camera frames FaceMesh never saw (it was busy) plus frames where it saw no face; last 10 s
      const nt = sum('nCam') ? Math.max(0, 100 * (1 - sum('nFace') / sum('nCam'))) : 0;
      P.summary = `FaceMesh ${f1(sum('meshFps') / L10.length)} fps / render ${f1(sum('drawFps') / L10.length)} fps / not tracked ${nt.toFixed(0)}%`;
      txt.textContent = P.summary + '   (last 10 s)\n' +
        `FaceMesh ${f1(e.meshFps)} fps  face ${f1(e.faceFps)}  ${f1(e.meshMs)} ms/frame (max ${f1(e.meshMax)})\n` +
        `render   ${f1(e.drawFps)} fps  longest gap ${e.gapMax} ms  our work ${f1(e.workMs)} ms\n` +
        `camera   ${f1(e.camFps)} fps  ${P.size}  not tracked ${e.dropped}/s\n` +
        `frozen ${s.frozen}/s  no glasses ${s.hidden}/s  display ${f1(e.dispFps)} fps\n` +
        `ours/frame: ${Object.entries(P.steps).filter(([k]) => k !== 'light' && k !== 'env').map(([k, o]) => k + ' ' + f1(o.sum / o.n)).join('  ')} ms\n` +
        `every 30th: ${['light', 'env'].map(k => P.steps[k] ? k + ' ' + f1(P.steps[k].sum / P.steps[k].n) + ' (max ' + Math.round(P.steps[k].max) + ')' : '').join('  ')} ms\n` +
        `wasm SIMD ${SIMD ? 'yes' : 'NO'}  input ${P.input || 'camera'}  ${P.size}\n` +
        `look: ${post ? `blur ${look.sig.toFixed(2)} px  black ${Math.round(look.lift.y * 255)}/255` : 'direct (post off)'}  room ${HDR ? 'HDR' : '8-bit'}\n` +
        `total: ${T.res} results · not tracked ${pct(T.camLost, T.cam + T.camLost)} · frozen ${T.frozen} · no glasses ${T.hidden} · gaps>50ms ${T.gap50} · worst ${Math.round(T.gapMax)} ms`;
      P.s = zero(); P.t = now;
    }
    // redraw intervals, last 120 redraws; lines at 1/60, 1/30 and 1/15 s
    gx.clearRect(0, 0, 240, 44); gx.strokeStyle = 'rgba(255,255,255,.25)'; gx.lineWidth = 1;
    for (const ms of [16.7, 33.3, 66.7]) { const y = 44 - ms / 100 * 44; gx.beginPath(); gx.moveTo(0, y); gx.lineTo(240, y); gx.stroke(); }
    gaps.forEach((ms, i) => { gx.fillStyle = ms > 50 ? '#ff453a' : ms > 34 ? '#ffd60a' : '#30d158'; const hh = Math.min(44, ms / 100 * 44); gx.fillRect(i * 2, 44 - hh, 1.5, hh); });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  return P;
}

let faceMesh = null, running = false, busy = false, stream = null, warming = false;
// ?fm=640: feed FaceMesh a downscaled copy of the camera frame (its models only look at 192-256 px crops, so a 1280 px upload is mostly wasted);
// the picture itself is still drawn from the full-size frame (cap). ?fm=0 (default) sends the video as before.
const FM = +(QS.get('fm') ?? 0);
const cap = document.createElement('canvas'), capX = cap.getContext('2d', { alpha: false });
const small = document.createElement('canvas'), smallX = small.getContext('2d', { alpha: false });
let lostAt = null; const LOST_MS = 300, FREEZE_MS = +(QS.get('fz') ?? 170);
let meshReady = null;
function ensureMesh() { return meshReady || (meshReady = initMesh().catch(e => { meshReady = null; faceMesh = null; throw e; })); }
// Load the 16 MB of FaceMesh files and compile the graph (the first frame took ~4 s) while the start page is still showing, before the camera is asked.
async function initMesh() {
  faceMesh = new FaceMesh({ locateFile: f => `../lib/face_mesh/${f}` });
  faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: .6, minTrackingConfidence: .6 });
  faceMesh.onResults(onResults);
  await faceMesh.initialize();
  try { const c = document.createElement('canvas'); c.width = 320; c.height = 240; c.getContext('2d').fillRect(0, 0, 320, 240); warming = true; await faceMesh.send({ image: c }); } catch (e) {}
  warming = false;
}
function schedule() {
  if (!running) return;
  if (videoEl.requestVideoFrameCallback) videoEl.requestVideoFrameCallback(pump); else requestAnimationFrame(pump);
}
async function pump(now, meta) {
  if (!running) return;
  if (perf && videoEl.requestVideoFrameCallback) perf.camFrame(meta);
  if (!busy && videoEl.readyState >= 2) { busy = true; const s0 = performance.now(); if (perf) perf.sent();
    try {
      let src = videoEl;
      if (FM && videoEl.videoWidth > FM) {
        const vw = videoEl.videoWidth, vh = videoEl.videoHeight, sw = FM, sh = Math.round(FM * vh / vw);
        if (cap.width !== vw || cap.height !== vh) { cap.width = vw; cap.height = vh; }
        if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
        capX.drawImage(videoEl, 0, 0); smallX.drawImage(cap, 0, 0, sw, sh); src = small; if (perf) perf.input = sw + '×' + sh;
      }
      await faceMesh.send({ image: src }); } catch (e) { console.error(e); } busy = false; if (perf) perf.meshDone(performance.now() - s0); }
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
if (POST_ON) { post = makePost(); assignLayers(); }
if (!QS.has('nopre')) ensureMesh().catch(e => console.error(e));   // preload while the start page is shown
window.__tryon = { onResults, scan, glasses, camera, head, THREE, beginScan, finishScan, get model() { return model; }, get fit() { return fit; }, cam, yawOf, render: draw, resize, stats: () => ({ scanned }), perf, look };
if (QS.has("bench")) window.__tryon.bench = () => { const t = f => { const a = performance.now(); for (let i = 0; i < 20; i++) f(); return +((performance.now() - a) / 20).toFixed(2); }; const p = window.__tryon.pose.pts; return { light: t(() => adaptLight(bgCtx)), soft: t(() => { look.sigs.length = 0; measureSoft(bgCtx, p); }), env: t(() => roomEnv(bg, W, H)) }; };
