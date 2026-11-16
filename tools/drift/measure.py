# measure.py <data> <clip> <run> [f0] : per frame the 2D shift (px, subpixel) that lays the red ghost front on the real dark frame.
# Score = dark fraction under the ghost mask minus dark fraction in a ring around it (so hair/brows don't attract), search +-S px (FFT).
# Whole front, plus left and right half separately. -> <run>_drift.json
import sys, json, os, numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation
from scipy.signal import fftconvolve
D, clip, g = sys.argv[1:4]; f0 = int(sys.argv[4]) if len(sys.argv) > 4 else 394
S = int(os.environ.get('S', 26)); FR = float(os.environ.get('FR', '.55'))
rec = {r['i']: r for r in json.load(open(f'{D}/{g}.json'))['rec']}
BAD = set(json.load(open(f'{D}/bad.json'))) if os.path.exists(f'{D}/bad.json') else set()
def best(M, Dk):
    n = M.sum()
    if n < 150: return None
    ring = binary_dilation(M, iterations=4) & ~binary_dilation(M, iterations=1)
    K = M / n - ring / max(1, ring.sum())
    c = fftconvolve(Dk.astype(float), K[::-1, ::-1].astype(float), mode='same')
    cy, cx = Dk.shape[0] // 2, Dk.shape[1] // 2   # 'same': index (cy+dy, cx+dx) <-> shift
    # correlation centre for odd/even sizes
    oy, ox = (K.shape[0] - 1) // 2, (K.shape[1] - 1) // 2
    win = c[oy - S:oy + S + 1, ox - S:ox + S + 1]
    j = np.unravel_index(np.argmax(win), win.shape); dy, dx = j[0] - S, j[1] - S; sc = win[j]
    def sub(a, b, c_): d = a - 2 * b + c_; return 0 if d >= 0 else .5 * (a - c_) / d
    sy = sub(win[j[0] - 1, j[1]], sc, win[j[0] + 1, j[1]]) if 0 < j[0] < 2 * S else 0
    sx = sub(win[j[0], j[1] - 1], sc, win[j[0], j[1] + 1]) if 0 < j[1] < 2 * S else 0
    return [round(float(dx + sx), 2), round(float(dy + sy), 2), round(float(sc), 3), int(abs(dx) == S or abs(dy) == S)]
out = {}
for i in sorted(rec):
    r = rec[i]; p = f'{D}/{g}/{i:04d}.jpg'
    if i in BAD or i < f0 or not r.get('lens') or not os.path.exists(p): continue
    a = np.asarray(Image.open(p).convert('RGB')).astype(int); b = np.asarray(Image.open(f'{D}/{clip}/{i:04d}.jpg').convert('RGB')).astype(int)
    if a.shape != b.shape: continue
    red = (a[..., 0] - np.maximum(a[..., 1], a[..., 2]) > 45) & (b[..., 0] - np.maximum(b[..., 1], b[..., 2]) < 35)
    (lx, ly), (rx, ry) = r['lens']; sep = np.hypot(rx - lx, ry - ly); cy = (ly + ry) / 2; cxm = (lx + rx) / 2
    x0, x1 = int(min(lx, rx) - FR * sep), int(max(lx, rx) + FR * sep); y0, y1 = int(cy - .55 * sep), int(cy + .55 * sep)
    P = S + 8; X0, X1, Y0, Y1 = max(0, x0 - P), min(a.shape[1], x1 + P), max(0, y0 - P), min(a.shape[0], y1 + P)
    M = np.zeros(red.shape, bool); M[max(0, y0):y1, max(0, x0):x1] = red[max(0, y0):y1, max(0, x0):x1]
    mx, mn = b.max(2), b.min(2); Dk = (mx < 58) & (mx - mn < 28)
    Mc, Dc = M[Y0:Y1, X0:X1], Dk[Y0:Y1, X0:X1]
    if Mc.shape[0] < 2 * S + 3 or Mc.shape[1] < 2 * S + 3: continue
    xs = np.arange(X0, X1)[None, :] + 0 * Mc
    w = best(Mc, Dc)
    if not w: continue
    x, y, z, ww = r['R']; fx, fy, fz = 2 * (x * z + ww * y), 2 * (y * z - ww * x), 1 - 2 * (x * x + y * y)
    o = {'all': w, 'L': best(Mc & (xs < cxm), Dc), 'R': best(Mc & (xs >= cxm), Dc), 'sep': round(sep, 1),
         'yaw': float(np.degrees(np.arctan2(fx, fz))), 'pitch': float(np.degrees(np.arctan2(fy, np.hypot(fx, fz)))),
         'pxmm': float((320 / np.tan(np.radians(float(os.environ.get('FOV', 46)) / 2))) / -r['t'][2])}
    out[i] = o
json.dump(out, open(f'{D}/{g}_drift.json', 'w'))
print('frames', len(out), 'clipped', sum(v['all'][3] for v in out.values()), 'median score', np.median([v['all'][2] for v in out.values()]))
