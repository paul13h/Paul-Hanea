# viz.py <data> <run> <out.jpg> frames... : real | ghost | ghost mask shifted by the measured shift drawn on real (green) -> check measure.py by eye
import sys, json, numpy as np
from PIL import Image
D, g, outp = sys.argv[1:4]; fr = [int(x) for x in sys.argv[4:]]
rec = {r['i']: r for r in json.load(open(f'{D}/{g}.json'))['rec']}; dr = json.load(open(f'{D}/{g}_drift.json'))
rows = []
for i in fr:
    a = np.asarray(Image.open(f'{D}/{g}/{i:04d}.jpg').convert('RGB')).astype(int); b = np.asarray(Image.open(f'{D}/kmix/{i:04d}.jpg').convert('RGB')).astype(int)
    red = (a[..., 0] - np.maximum(a[..., 1], a[..., 2]) > 45) & (b[..., 0] - np.maximum(b[..., 1], b[..., 2]) < 35)
    d = dr[str(i)]['all']; dx, dy = int(round(d[0])), int(round(d[1]))
    sh = np.roll(np.roll(red, dy, 0), dx, 1); edge = sh & ~(np.roll(sh, 1, 0) & np.roll(sh, -1, 0) & np.roll(sh, 1, 1) & np.roll(sh, -1, 1))
    c = b.copy(); c[edge] = [0, 255, 0]
    (lx, ly), (rx, ry) = rec[i]['lens']; cx, cy = int((lx + rx) / 2), int((ly + ry) / 2); box = (max(0, cx - 150), max(0, cy - 90), max(0, cx - 150) + 300, max(0, cy - 90) + 180)
    rows.append(np.hstack([np.asarray(Image.fromarray(x.astype(np.uint8)).crop(box).resize((600, 360), Image.LANCZOS)) for x in (b, a, c)]))
    print(i, d)
Image.fromarray(np.vstack(rows)).save(outp, quality=88)
