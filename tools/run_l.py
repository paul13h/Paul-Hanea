import subprocess,time,sys,json,base64,os
from playwright.sync_api import sync_playwright
S,clip,out=sys.argv[1],sys.argv[2],sys.argv[3]; scan=len(sys.argv)>4 and sys.argv[4]=='scan'
os.makedirs(f'{S}/{out}',exist_ok=True)
frames=sorted(os.listdir(f'{S}/{clip}'))
srv=subprocess.Popen([sys.executable,'-m','http.server',sys.argv[6]],cwd='/home/claude/paul-hanea',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
INIT='''async (scan) => {
  document.getElementById('startView').hidden = true;
  window.cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  window.fm = new FaceMesh({ locateFile: f => `../lib/face_mesh/${f}` });
  fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: .6, minTrackingConfidence: .6 });
  fm.onResults(r => { window.__res = r; window.__tryon.onResults({ image: cv, multiFaceLandmarks: r.multiFaceLandmarks, t: window.__t }); });
  await fm.initialize();
  if (scan) window.__tryon.beginScan();
  return true; }'''
STEP='''async (i) => {
  const img = new Image(); img.src = '/__f/' + i; await img.decode();
  cv.getContext('2d').drawImage(img, 0, 0, W, H); window.__t = 1000 + i * 1000 / 30;
  await fm.send({ image: cv });
  const T = window.__tryon, L = __res.multiFaceLandmarks && __res.multiFaceLandmarks[0];
  const o = { i, face: !!L, scanning: T.scan.on };
  if (L && T.pose) {
    const P = T.pose, cam = T.cam, m = T.model, S = window.__S;
    const proj = (R, t, p) => { const r = S.v.add(S.q.rot(R, p), t); return [cam.cx + cam.f * r[0] / -r[2], cam.cy + cam.f * r[1] / r[2]]; };
    o.det = [168, 133, 362, 1].map(k => P.pts[k]);
    o.shown = [168, 133, 362, 1].map(k => proj(P.R, P.t, m[k]));
    o.wing = proj(P.R, P.t, [70, 20, -14]); o.wingRaw = proj(P.raw.R, P.raw.t, [70, 20, -14]);
    o.yaw = T.yawOf(P.R); o.yawRaw = T.yawOf(P.raw.R); o.rms = P.raw.rms; o.z = P.t[2];
  }
  o.jpg = document.getElementById('view').toDataURL('image/jpeg', .85);
  return o; }'''
try:
  with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg=b.new_page(viewport={'width':1100,'height':1100})
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.route('**/__f/*',lambda r:r.fulfill(path=f'{S}/{clip}/'+frames[int(r.request.url.rsplit('/',1)[1])]))
    pg.goto('http://localhost:'+sys.argv[6]+'/v2/tf.html?capture=1&'+sys.argv[5]+''); pg.evaluate('window.W=960;window.H=640'); pg.wait_for_function('window.__tryon',timeout=30000)
    pg.evaluate("import('/v2/solver.js').then(m=>window.__S=m)"); time.sleep(.5)
    pg.evaluate(INIT,scan)
    rec=[]; t0=time.time()
    for i in range(len(frames)):
      o=pg.evaluate(STEP,i)
      open(f'{S}/{out}/{i:04d}.jpg','wb').write(base64.b64decode(o.pop('jpg').split(',')[1])); rec.append(o)
    fit=pg.evaluate("(()=>{const f=window.__tryon.fit;return {ipd:f.ipd,faceW:f.faceW,tilt:f.tilt*57.3,contact:f.contact,seat:f.seat}})()")
    json.dump({'rec':rec,'fit':fit,'scanned':pg.evaluate('window.__tryon.stats().scanned')},open(f'{S}/{out}.json','w'))
    print('frames',len(rec),'sec',round(time.time()-t0),'errors',errs[:3],'fit',fit)
    b.close()
finally: srv.terminate()
