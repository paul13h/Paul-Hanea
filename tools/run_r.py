# Like run_l.py, but replays FaceMesh landmarks saved by dump_l.py instead of running FaceMesh again.
# Much faster, and every version sees exactly the same landmarks, so differences come from the try-on code only.
#   python3 tools/run_r.py <dir> <clip> <out> [scan|noscan] "<query>" <port> [every]
# Writes <dir>/<out>/NNNN.jpg for every `every`-th frame (default 1) and <dir>/<out>.json.
import subprocess,time,sys,json,base64,os
from playwright.sync_api import sync_playwright
S,clip,out=sys.argv[1],sys.argv[2],sys.argv[3]; scan=sys.argv[4]=='scan'; every=int(sys.argv[7]) if len(sys.argv)>7 else 1
os.makedirs(f'{S}/{out}',exist_ok=True)
frames=sorted(os.listdir(f'{S}/{clip}')); L=json.load(open(f'{S}/L_{clip}.json'))
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv=subprocess.Popen([sys.executable,'-m','http.server',sys.argv[6]],cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
INIT='''async (scan) => {
  document.getElementById('startView').hidden = true;
  window.cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  if (scan) window.__tryon.beginScan();
  return true; }'''
STEP='''async ([i, L, shot]) => {
  const img = new Image(); img.src = '/__f/' + i; await img.decode();
  cv.getContext('2d').drawImage(img, 0, 0, W, H);
  const lm = L ? L.map(p => ({ x: p[0] / W, y: p[1] / H, z: 0 })) : null;
  window.__tryon.onResults({ image: cv, multiFaceLandmarks: lm ? [lm] : [], t: 1000 + i * 1000 / 30 });
  const T = window.__tryon, P = T.pose, o = { i, face: !!lm, scanning: T.scan.on };
  if (lm && P) {
    const cam = T.cam, m = T.model, S = window.__S;
    const proj = (R, t, p) => { const r = S.v.add(S.q.rot(R, p), t); return [cam.cx + cam.f * r[0] / -r[2], cam.cy + cam.f * r[1] / r[2]]; };
    o.det = [168, 6, 133, 362, 1, 4, 152, 10].map(k => P.pts[k]);
    o.shown = [168, 6, 133, 362, 1, 4, 152, 10].map(k => proj(P.R, P.t, m[k]));
    o.R = P.R; o.t = P.t; o.rawR = P.raw.R; o.rawT = P.raw.t;
    o.pupils = [P.pts[468], P.pts[473]];
    if (T.glasses) { T.head.updateMatrixWorld(true); o.lens = [-35.5, 35.5].map(x => { const p = T.glasses.root.localToWorld(new T.THREE.Vector3(x, 0, -2)).project(T.camera); return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H]; }); }
    o.yaw = T.yawOf(P.R); o.yawRaw = T.yawOf(P.raw.R); o.rms = P.raw.rms; o.vis = T.headVisible;
  }
  if (shot) o.jpg = document.getElementById('view').toDataURL('image/jpeg', .85);
  return o; }'''
try:
  with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg=b.new_page(viewport={'width':1100,'height':1100})
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.route('**/__f/*',lambda r:r.fulfill(path=f'{S}/{clip}/'+frames[int(r.request.url.rsplit('/',1)[1])]))
    pg.goto('http://localhost:'+sys.argv[6]+'/v2/index.html?capture=1&'+sys.argv[5]); pg.evaluate('window.W=960;window.H=640'); pg.wait_for_function('window.__tryon',timeout=30000)
    pg.evaluate("import('/v2/solver.js').then(m=>window.__S=m)"); time.sleep(.5)
    pg.evaluate(INIT,scan)
    rec=[]; t0=time.time()
    for i in range(len(frames)):
      o=pg.evaluate(STEP,[i,L[i],i%every==0])
      if 'jpg' in o: open(f'{S}/{out}/{i:04d}.jpg','wb').write(base64.b64decode(o.pop('jpg').split(',')[1]))
      rec.append(o)
    fit=pg.evaluate("(()=>{const f=window.__tryon.fit;return {ipd:f.ipd,faceW:f.faceW,tilt:f.tilt*57.3,contact:f.contact,seat:f.seat}})()")
    json.dump({'rec':rec,'fit':fit,'scanned':pg.evaluate('window.__tryon.stats().scanned')},open(f'{S}/{out}.json','w'))
    print('frames',len(rec),'sec',round(time.time()-t0),'errors',errs[:3],'fit',fit)
    b.close()
finally: srv.terminate()
