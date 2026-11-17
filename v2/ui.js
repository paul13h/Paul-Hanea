// Page UI around the try-on: start screen and camera permission, loading, scan guidance, hints when the face is lost / too far /
// too close / too dark / turned away, errors with retry, photo and before/after. Reads the try-on only through window.__tryon
// and never changes tracking, fit or rendering (the before/after toggle only hides the glasses).
const $ = id => document.getElementById(id);
const T = () => window.__tryon;
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const SAFARI = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const SPIN = '<span class="spin" aria-hidden="true"></span>';

// ---------------------------------------------------------------- copy
const SCAN_STEPS = ['Bitte schauen Sie gerade in die Kamera.', 'Drehen Sie den Kopf langsam zu einer Seite.', 'Und jetzt langsam zur anderen Seite.', 'Fast fertig. Schauen Sie wieder geradeaus.'];
const HINTS = {
  lost: 'Kein Gesicht erkannt. Bitte schauen Sie in die Kamera.',
  lostDark: 'Zu dunkel, um Ihr Gesicht zu erkennen. Bitte sorgen Sie für mehr Licht.',
  far: 'Bitte kommen Sie etwas näher.',
  close: 'Bitte gehen Sie etwas weiter zurück.',
  edge: 'Bitte rücken Sie in die Bildmitte.',
  turned: 'Bitte drehen Sie den Kopf wieder etwas zur Kamera.',
  dark: 'Etwas mehr Licht verbessert die Anprobe.',
};
function cameraHelp() {
  if (IOS) return 'Tippen Sie in der Adressleiste auf „aA“ › Website-Einstellungen › Kamera › Erlauben. Laden Sie die Seite danach neu.';
  if (SAFARI) return 'In Safari: Menü Safari › Einstellungen für diese Website › Kamera › Erlauben. Laden Sie die Seite danach neu.';
  return 'Klicken Sie auf das Kamera- oder Schloss-Symbol in der Adressleiste und erlauben Sie die Kamera.';
}
function errorCopy(step, e) {
  const n = e && e.name;
  if (step === 'unsupported') return window.isSecureContext === false
    ? ['Kamera nicht verfügbar', 'Die Kamera kann nur über eine sichere Verbindung (https) genutzt werden.', '', false]
    : ['Kamera nicht verfügbar', 'Dieser Browser erlaubt keinen Kamerazugriff.', IOS ? 'Bitte öffnen Sie die Seite direkt in Safari.' : 'Bitte öffnen Sie die Seite in einer aktuellen Version von Safari, Chrome oder Firefox.', false];
  if (step === 'mesh') return ['Gesichtserkennung nicht verfügbar', 'Die Gesichtserkennung konnte nicht geladen werden.', 'Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.', true];
  if (step === 'ended') return ['Die Kamera wurde getrennt', 'Das Kamerabild ist nicht mehr verfügbar.', 'Bitte prüfen Sie die Kamera und versuchen Sie es erneut.', true];
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return ['Kein Zugriff auf die Kamera', 'Für die Anprobe benötigt diese Seite Ihre Kamera.', cameraHelp(), true];
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return ['Keine Kamera gefunden', 'Es wurde keine Kamera gefunden.', 'Bitte schließen Sie eine Kamera an oder prüfen Sie, ob sie aktiviert ist.', true];
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return ['Die Kamera ist belegt', 'Eine andere Anwendung verwendet gerade die Kamera, etwa FaceTime, Zoom oder Teams.', 'Bitte schließen Sie diese Anwendung und versuchen Sie es erneut.', true];
  return ['Die Kamera konnte nicht gestartet werden', 'Beim Starten der Kamera ist ein Fehler aufgetreten.', 'Bitte versuchen Sie es erneut oder laden Sie die Seite neu.', true];
}

// ---------------------------------------------------------------- state
let startFn, stream = null, running = false, lastPose = null, lastPoseAt = 0, wasScanning = false, glassesOff = false;
let hintKey = null, cand = null, candAt = 0, dark = false, lum = 1, toastTimer = 0;

export function initUI({ start, preload }) {
  startFn = start;
  window.__uiReady = true;
  if (window.__fatalShown) return;          // browser cannot run the try-on: tf.html already shows why
  $('startBtn').addEventListener('click', () => begin());
  $('retryBtn').addEventListener('click', () => begin(running ? { scan: false } : undefined));
  $('reloadBtn').addEventListener('click', () => location.reload());
  $('shotBtn').addEventListener('click', takePhoto);
  $('cmpBtn').addEventListener('click', () => setGlassesOff(!glassesOff));
  $('closeShotBtn').addEventListener('click', closePhoto);
  $('saveBtn').addEventListener('click', savePhoto);
  $('rescanBtn').addEventListener('click', () => setGlassesOff(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('shotView').hidden) closePhoto(); });
  // the scan bar's width is set by app.js; mirror it for screen readers
  new MutationObserver(() => $('scanProg').setAttribute('aria-valuenow', parseInt($('scanBar').style.width) || 0)).observe($('scanBar'), { attributes: true, attributeFilter: ['style'] });
  if (preload) {
    const st = $('preStatus'); st.innerHTML = SPIN + 'Anprobe wird vorbereitet…';
    preload.then(() => { st.textContent = 'Bereit.'; setTimeout(() => { if (st.textContent === 'Bereit.') st.textContent = ''; }, 2500); }, () => { st.textContent = ''; });
  }
  requestAnimationFrame(loop);
}

function busy(text) { const b = $('startBtn'); b.disabled = !!text; b.setAttribute('aria-busy', text ? 'true' : 'false'); b.innerHTML = text ? SPIN + text : 'Anprobe starten'; }

async function begin(opts) {
  $('errView').hidden = true;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }   // a camera that was disconnected
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return showError('unsupported');
  if (!running) { $('startView').hidden = false; busy('Kamera wird angefragt…'); $('preStatus').textContent = 'Bitte erlauben Sie den Zugriff auf die Kamera, wenn Ihr Browser danach fragt.'; }
  // once the camera is allowed, the rest of the wait is FaceMesh
  const t = setInterval(() => { const v = $('video'); if (v.srcObject && !running) { busy('Gesichtserkennung wird geladen…'); $('preStatus').textContent = ''; clearInterval(t); } }, 150);
  try { stream = await startFn(opts); }
  catch (x) { clearInterval(t); busy(''); $('preStatus').textContent = ''; return showError(x && x.step || 'camera', x && x.error || x); }
  clearInterval(t); busy(''); $('preStatus').textContent = '';
  running = true; lastPoseAt = performance.now(); lastPose = T().pose;
  for (const tr of stream.getVideoTracks()) tr.addEventListener('ended', () => { if (stream && stream.getVideoTracks().includes(tr)) showError('ended'); });
}

function showError(step, e) {
  const [title, text, help, retry] = errorCopy(step, e);
  $('errTitle').textContent = title; $('errText').textContent = text; $('errHelp').textContent = help;
  $('err').textContent = title;
  $('retryBtn').hidden = !retry; $('reloadBtn').hidden = false;
  $('startView').hidden = true; $('tools').hidden = true; $('guide').hidden = true; setHint(null);
  $('errView').hidden = false; $('stage').scrollIntoView({ block: 'nearest' }); (retry ? $('retryBtn') : $('reloadBtn')).focus();
}

// ---------------------------------------------------------------- live hints
function setHint(key) {
  if (key === hintKey) return; hintKey = key;
  if (key) { $('hintText').textContent = HINTS[key]; $('toast').classList.add('off'); }   // both sit at the top
  $('hint').classList.toggle('off', !key);
}
function toast(text, ms = 3800) {
  if (hintKey) return;
  $('toastText').textContent = text; $('toast').classList.remove('off');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.add('off'), ms);
}

// brightness of the camera picture, a few times per second, from a tiny copy
const lc = document.createElement('canvas'); lc.width = 32; lc.height = 18; const lx = lc.getContext('2d', { willReadFrequently: true });
let lumAt = 0;
function measureLight(now) {
  const v = $('video'); if (now - lumAt < 600 || v.readyState < 2) return; lumAt = now;
  try { lx.drawImage(v, 0, 0, 32, 18); const d = lx.getImageData(0, 0, 32, 18).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += .3 * d[i] + .59 * d[i + 1] + .11 * d[i + 2]; lum = s / (d.length / 4) / 255; } catch (e) { lum = 1; }
  dark = dark ? lum < .2 : lum < .14;        // hysteresis
}

function faceState(now) {
  const t = T(), p = t.pose, v = $('video');
  if (p !== lastPose) { lastPose = p; lastPoseAt = now; }
  const stale = now - lastPoseAt;
  if (!p || stale > 450) return dark ? 'lostDark' : 'lost';
  const vw = v.videoWidth || 1280, vh = v.videoHeight || 720, pts = p.pts;
  const fw = Math.hypot(pts[234][0] - pts[454][0], pts[234][1] - pts[454][1]) / Math.max(vw, vh);
  if (fw > .42) return 'close';
  if (fw < .1) return 'far';
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const k of [10, 152, 234, 454]) { x0 = Math.min(x0, pts[k][0]); x1 = Math.max(x1, pts[k][0]); y0 = Math.min(y0, pts[k][1]); y1 = Math.max(y1, pts[k][1]); }
  const m = .01 * vw;
  if (x0 < m || y0 < m || x1 > vw - m || y1 > vh - m) return 'edge';
  if (Math.abs(t.yawOf(p.raw.R)) > (t.scan.on ? 52 : 48)) return 'turned';
  return dark ? 'dark' : null;
}

function loop(now) {
  requestAnimationFrame(loop);
  if (!running || !$('errView').hidden) return;
  const t = T(); if (!t) return;
  measureLight(now);
  const scanning = t.scan.on;
  // scan just ended: say how it went
  $('fitEmpty').hidden = !$('fitCard').hidden;
  if (wasScanning && !scanning) {
    toast(t.stats().scanned ? 'Scan abgeschlossen. Die Brille ist an Ihr Gesicht angepasst.' : 'Standardgröße. Für eine genaue Passform „Neu scannen“ wählen.');
  }
  if (scanning && !wasScanning) { $('toast').classList.add('off'); setGlassesOff(false); }
  wasScanning = scanning;
  if (scanning) {
    const st = Math.min(3, t.scan.step);
    $('scanSteps').querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i <= st));
  }
  $('tools').hidden = scanning || !$('shotView').hidden;
  // hints change only after they held for a moment, so they do not flicker
  const k = faceState(now);
  if (k !== cand) { cand = k; candAt = now; }
  const hold = k === null ? 350 : k === 'lost' || k === 'lostDark' ? 700 : 900;
  if (now - candAt > hold) setHint(cand);
  const g = $('guide'); g.hidden = !scanning; g.classList.toggle('ok', scanning && hintKey === null);
}

// ---------------------------------------------------------------- before / after
function setGlassesOff(off) {
  glassesOff = off; const t = T(); if (t && t.glasses) t.glasses.root.visible = !off;
  const b = $('cmpBtn'); b.setAttribute('aria-pressed', off ? 'true' : 'false'); b.querySelector('span').textContent = off ? 'Mit Brille' : 'Ohne Brille';
}

// ---------------------------------------------------------------- photo
let shotBlob = null, shotURL = null;
function takePhoto() {
  const t = T(), src = $('view');
  // the canvas keeps no copy of its last frame (preserveDrawingBuffer off): draw once more and copy it straight away
  t.render();
  const w = src.width, h = src.height, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.translate(w, 0); x.scale(-1, 1); x.drawImage(src, 0, 0); x.setTransform(1, 0, 0, 1, 0, 0);
  // a quiet caption, bottom left
  const fs = Math.round(h * .026), pad = Math.round(h * .03);
  const grd = x.createLinearGradient(0, h - fs * 4, 0, h); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,.35)');
  x.fillStyle = grd; x.fillRect(0, h - fs * 4, w, fs * 4);
  x.fillStyle = 'rgba(255,255,255,.92)'; x.font = `${fs}px "Bodoni 72", Didot, Georgia, serif`; x.textBaseline = 'alphabetic';
  x.fillText(document.querySelector('header b').textContent, pad, h - pad);
  if (!REDUCED.matches) { const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
  c.toBlob(b => {
    shotBlob = b; if (shotURL) URL.revokeObjectURL(shotURL); shotURL = URL.createObjectURL(b);
    $('shotImg').src = shotURL; $('shotView').hidden = false; $('tools').hidden = true; $('saveBtn').focus();
  }, 'image/jpeg', .92);
}
function closePhoto() { $('shotView').hidden = true; $('shotBtn').focus(); }
async function savePhoto() {
  if (!shotBlob) return;
  const name = 'Anprobe ' + document.querySelector('header b').textContent + '.jpg';
  const file = new File([shotBlob], name, { type: 'image/jpeg' });
  // phones: the share sheet (save to Photos, AirDrop, Messages); computers: a download
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = shotURL; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  toast('Foto gesichert.', 2400);
}
