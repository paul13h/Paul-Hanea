# env START (first real-frame index: 394 kmix, 262 imix), END, OUTJSON
# bottom.py <data> <clip> run... : bottom outer edge of each lens rim, real vs ghost, mm (ghost - real, + = ghost lower), vs pitch
import sys, json, os, numpy as np
from PIL import Image
D, clip, runs = sys.argv[1], sys.argv[2], sys.argv[3:]
def pitch(R):
    x, y, z, w = R; return np.degrees(np.arctan2(2*(y*z - w*x), np.hypot(2*(x*z + w*y), 1 - 2*(x*x + y*y))))
def edge_real(col, y0, px=1):   # lower edge of the LOWEST dark band >= 2 mm thick that ends inside the window (the bottom rim;
    # skips the iris/lashes above it and a dark shirt running off the bottom)
    c = np.convolve(col, np.ones(3) / 3, 'same'); ref = np.percentile(c, 90); dark = c < .62 * ref; bands = []; k = y0
    while k < len(c):
        if dark[k]:
            j = k
            while j < len(c) and dark[j]: j += 1
            bands.append((k, j)); k = j
        else: k += 1
    bands = [(a, b) for a, b in bands if b < len(c) - 1 and b - a >= 2 * px]
    if not bands: return None
    a, b = bands[-1]; lo = c[a:b].min(); k = a + int(np.argmin(c[a:b]))
    while k < len(c) - 1 and c[k] < (lo + ref) / 2: k += 1
    return k
def edge_red(m, y0):
    idx = np.nonzero(m[y0:])[0]
    if not len(idx): return None
    k = idx[0] + y0
    while k < len(m) - 1 and m[k]: k += 1
    return k
res = {}
for run in runs:
    rec = {r['i']: r for r in json.load(open(f'{D}/{run}.json'))['rec']}; rows = []
    for i in sorted(rec):
        r = rec[i]; p = f'{D}/{run}/{i:04d}.jpg'
        if i < int(os.environ.get('START', 262)) or i > int(os.environ.get('END', 10**6)) or not r.get('lens') or not os.path.exists(p) or abs(r['yaw']) > 12: continue
        a = np.asarray(Image.open(p).convert('RGB')).astype(int); b = np.asarray(Image.open(f'{D}/{clip}/{i:04d}.jpg').convert('RGB')).astype(int)
        (lx, ly), (rx, ry) = r['lens']; sep = np.hypot(rx - lx, ry - ly); px = sep / 71; d = []
        for cx, cy in ((lx, ly), (rx, ry)):
            x0, x1, ya, yb = int(cx - 6), int(cx + 6), int(cy + 0.5 * px), int(cy + 30 * px)
            if yb >= a.shape[0]: continue
            A, B = a[ya:yb, x0:x1], b[ya:yb, x0:x1]
            red = ((A[..., 0] - np.maximum(A[..., 1], A[..., 2]) > 45) & (B[..., 0] - np.maximum(B[..., 1], B[..., 2]) < 35)).mean(1) > .5
            lum = (.3 * B[..., 0] + .6 * B[..., 1] + .1 * B[..., 2]).mean(1)
            eg, er = edge_red(red, 0), edge_real(lum, 0, px)
            if eg is not None and er is not None: d.append((eg - er) / px)
        if len(d) == 2 and abs(d[0] - d[1]) < 4: rows.append((i, pitch(r['R']), np.mean(d)))
    res[run] = {i: (p, v) for i, p, v in rows}
    allv = [v for _, p, v in rows]
    if allv: print(f'{run}: ALL n {len(allv)} median {np.median(allv):+.1f} mm')
    print(f'{run}: {len(rows)} frames, bottom edge ghost-real mm (+ = ghost lower)')
    for lo, hi in [(-30, -8), (-8, 0), (0, 8), (8, 16), (16, 30), (30, 60)]:
        s = [v for _, p, v in rows if lo <= p < hi]
        if s: print(f'   pitch {lo:+3d}..{hi:+3d}: n {len(s):3d}  median {np.median(s):+.1f}  IQR {np.percentile(s, 25):+.1f}..{np.percentile(s, 75):+.1f}')
json.dump({k: {str(i): v for i, v in d.items()} for k, d in res.items()}, open(os.environ.get('OUTJSON', f'{D}/bottom_last.json'), 'w'))
