import json,sys,numpy as np
d=json.load(open(sys.argv[1])); R=d['rec']; print('scanned',d['scanned'])
ok=[r for r in R if 'det' in r and not r['scanning']]
print('frames with face',sum(r['face'] for r in R),'of',len(R),'after scan',len(ok), 'scan ended at', next((r['i'] for r in R if not r['scanning']),None))
det=np.array([r['det'] for r in ok]); sh=np.array([r['shown'] for r in ok])
e=np.linalg.norm(det-sh,axis=2)
eyew=np.linalg.norm(det[:,1]-det[:,2],axis=1)
print('slide at bridge px: median %.2f p95 %.2f max %.2f (eye corner distance median %.0f px)'%(np.median(e[:,0]),np.percentile(e[:,0],95),e[:,0].max(),np.median(eyew)))
print('error at inner eye corners px p95 %.2f, nose tip p95 %.2f'%(np.percentile(e[:,1:3],95),np.percentile(e[:,3],95)))
rel=e[:,0]/eyew*100; print('slide as %% of eye-corner distance p95 %.1f max %.1f'%(np.percentile(rel,95),rel.max()))
w=np.array([r['wing'] for r in ok]); wr=np.array([r['wingRaw'] for r in ok])
yaw=np.array([r['yaw'] for r in ok]); yr=np.array([r['yawRaw'] for r in ok])
sp=np.abs(np.diff(yr))*30
still=np.where(np.convolve(sp<15,np.ones(10)/10,'same')>.99)[0]
def hf(x):  # frame-to-frame jitter after removing slow motion
  s=np.array([np.convolve(x[:,k],np.ones(9)/9,'same') for k in (0,1)]).T; return np.linalg.norm((x-s)[4:-4],axis=1)
idx=still[(still>5)&(still<len(ok)-5)]
print('still frames',len(idx),'hinge jitter px shown %.2f raw %.2f'%(np.median(hf(w)[np.clip(idx-4,0,len(w)-9)]),np.median(hf(wr)[np.clip(idx-4,0,len(w)-9)])))
best=min(range(0,10),key=lambda l:np.sum((yaw[l:]-yr[:len(yr)-l])**2)); print('yaw lag frames',best,'(%d ms)'%(best*33))
print('max yaw raw %.0f'%np.abs(yr).max(),'rms p95 %.1f'%np.percentile([r['rms'] for r in ok],95))
