# ruler.py <data> <clip> <out.png> run1 [run2 ...] -- frames : per frame row: real | ghost(run1) | ghost(run2)...; left lens column,
# not mirrored; lines every 5 mm from the lens-centre line of run1 (yellow = 0, cyan = +-20 mm).
import sys, json, numpy as np
from PIL import Image, ImageDraw
a = sys.argv[1:]; D, clip, out = a[:3]; k = a.index('--'); runs = a[3:k]; fr = [int(x) for x in a[k + 1:]]
recs = [{r['i']: r for r in json.load(open(f'{D}/{r}.json'))['rec']} for r in runs]
cw, ch = 300, 360; Wd = Image.new('RGB', (cw * (1 + len(runs)), ch * len(fr)), (0, 0, 0))
skipped = []
for row, i in enumerate(fr):
    r = recs[0].get(i)
    if not r or not r.get('lens'): skipped.append(i); continue
    (lx, ly), (rx, ry) = r['lens']; sep = np.hypot(rx - lx, ry - ly); px = sep / 71
    cx, cy = (lx + rx) / 2 - .5 * sep, (ly + ry) / 2     # left lens x, mean lens height
    box = (int(cx - 22 * px), int(cy - 32 * px), int(cx + 22 * px), int(cy + 32 * px))
    for col, d in enumerate([clip] + runs):
        try: im = Image.open(f'{D}/{d}/{i:04d}.jpg').convert('RGB').crop(box).resize((cw, ch), Image.LANCZOS)
        except Exception: skipped.append(i); continue
        g = ImageDraw.Draw(im); s = ch / (64 * px)
        for mmv in range(-30, 31, 5):
            y = (32 * px + mmv * px) * s; g.line([(0, y), (cw, y)], fill=(255, 255, 0) if mmv == 0 else (0, 255, 255) if abs(mmv) == 20 else (90, 90, 90), width=1)
            g.text((2, y - 11), f'{mmv:+d}', fill=(255, 255, 0))
        g.text((150, 3), f'{i} {"real" if col == 0 else runs[col - 1].split("/")[1]}', fill=(255, 0, 255))
        Wd.paste(im, (col * cw, row * ch))
Wd.save(out)
if skipped: print('ruler.py: skipped frames (missing/unreadable):', sorted(set(skipped)))
