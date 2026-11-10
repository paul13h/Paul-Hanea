import subprocess,time,sys,json,os
from playwright.sync_api import sync_playwright
S,clip=sys.argv[1],sys.argv[2]; frames=sorted(os.listdir(f'{S}/{clip}'))
srv=subprocess.Popen([sys.executable,'-m','http.server',sys.argv[3] if len(sys.argv)>3 else '8800'],cwd='/home/claude/paul-hanea',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(); pg.route('**/__f/*',lambda r:r.fulfill(path=f'{S}/{clip}/'+frames[int(r.request.url.rsplit('/',1)[1])]))
    pg.goto('http://localhost:'+(sys.argv[3] if len(sys.argv)>3 else '8800')+'/v2/tf.html'); pg.evaluate('window.W=960;window.H=640'); pg.wait_for_function('window.__tryon')
    pg.evaluate('''async()=>{window.cv=document.createElement('canvas');cv.width=W;cv.height=H;
     window.fm=new FaceMesh({locateFile:f=>`../lib/face_mesh/${f}`});fm.setOptions({maxNumFaces:1,refineLandmarks:true,minDetectionConfidence:.6,minTrackingConfidence:.6});
     fm.onResults(r=>{window.__L=r.multiFaceLandmarks&&r.multiFaceLandmarks[0];});await fm.initialize();}''')
    out=[]
    for i in range(len(frames)):
      out.append(pg.evaluate('''async(i)=>{const img=new Image();img.src='/__f/'+i;await img.decode();cv.getContext('2d').drawImage(img,0,0,W,H);await fm.send({image:cv});
        return __L?__L.map(l=>[+(l.x*W).toFixed(2),+(l.y*H).toFixed(2)]):null}''',i))
    json.dump(out,open(f'{S}/L_{clip}.json','w')); b.close()
finally: srv.terminate()
