# align.py <R> <clip> <ghost render> [from] : per frame, the 2D shift (px at 960 wide) that best lays the virtual front (red
# ghost) on the real frame (dark pixels) -> <ghost>_shift.json. Its frame-to-frame changes = the glasses swimming on the face.
import sys, json, numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, shift as nshift
R, clip, g = sys.argv[1:4]; f0 = int(sys.argv[4]) if len(sys.argv) > 4 else 394
rec = {r['i']: r for r in json.load(open(f'{R}/{g}.json'))['rec']}
out = {}
import os; FR = float(os.environ.get("FR", ".55"))
for i in sorted(rec):
    if i < f0 or not rec[i].get('lens') or not os.path.exists(f'{R}/{g}/{i:04d}.jpg'): continue
    a = np.asarray(Image.open(f'{R}/{g}/{i:04d}.jpg').convert('RGB')).astype(int)
    b = np.asarray(Image.open(f'{R}/{clip}/{i:04d}.jpg').convert('RGB')).astype(int)
    if a.shape != b.shape: continue
    red = (a[..., 0] - np.maximum(a[..., 1], a[..., 2]) > 45) & (b[..., 0] - np.maximum(b[..., 1], b[..., 2]) < 35)
    (lx, ly), (rx, ry) = rec[i]['lens']; sep = np.hypot(rx - lx, ry - ly); cy = (ly + ry) / 2
    x0, x1 = int(min(lx, rx) - FR * sep), int(max(lx, rx) + FR * sep); y0, y1 = int(cy - .55 * sep), int(cy + .55 * sep)
    M = np.zeros(red.shape, bool); M[max(0, y0):y1, max(0, x0):x1] = red[max(0, y0):y1, max(0, x0):x1]
    if M.sum() < 200: continue
    mx, mn = b.max(2), b.min(2); D = (mx < 58) & (mx - mn < 28)
    best = None; S = 12
    ys, xs = np.nonzero(M)
    for dy in range(-S, S + 1):
        for dx in range(-S, S + 1):
            yy, xx = ys + dy, xs + dx; ok = (yy >= 0) & (yy < D.shape[0]) & (xx >= 0) & (xx < D.shape[1])
            sc = D[yy[ok], xx[ok]].sum() / len(ys)
            if best is None or sc > best[0]: best = (sc, dx, dy)
    out[i] = {'dx': best[1], 'dy': best[2], 'score': round(best[0], 3), 'sep': round(sep, 1), 'yaw': rec[i].get('yaw')}
json.dump(out, open(f'{R}/{g}_shift.json', 'w'))
v = list(out.values()); import statistics as st
print('frames', len(v), 'median score', st.median(x['score'] for x in v))
