# side.py <data> <clip> <out.jpg> <run1> [run2 ...] -- frames...
# Per frame one row: real crop | for each run: real crop with that run's ghost outline (red edge, unshifted) drawn on it.
# Crops are centred on run1's projected lens centres, 2x zoom, mirrored like the page.
import sys, json, numpy as np
from PIL import Image, ImageDraw
D, clip, outp = sys.argv[1:4]; k = sys.argv.index('--'); runs = sys.argv[4:k]; fr = [int(x) for x in sys.argv[k + 1:]]
recs = [{r['i']: r for r in json.load(open(f'{D}/{g}.json'))['rec']} for g in runs]
rows = []
for i in fr:
    b = np.asarray(Image.open(f'{D}/{clip}/{i:04d}.jpg').convert('RGB')).astype(int)
    (lx, ly), (rx, ry) = recs[0][i]['lens']; cx, cy = int((lx + rx) / 2), int((ly + ry) / 2)
    box = (cx - 120, cy - 60, cx + 120, cy + 60)
    tiles = [b]
    for g in runs:
        a = np.asarray(Image.open(f'{D}/{g}/{i:04d}.jpg').convert('RGB')).astype(int)
        red = (a[..., 0] - np.maximum(a[..., 1], a[..., 2]) > 45) & (b[..., 0] - np.maximum(b[..., 1], b[..., 2]) < 35)
        edge = red & ~(np.roll(red, 1, 0) & np.roll(red, -1, 0) & np.roll(red, 1, 1) & np.roll(red, -1, 1))
        c = b.copy(); c[edge] = [255, 40, 40]; tiles.append(c)
    ims = []
    for t in tiles:
        im = Image.fromarray(t.astype(np.uint8)).crop(box).resize((480, 240), Image.LANCZOS).transpose(Image.FLIP_LEFT_RIGHT)
        ImageDraw.Draw(im).text((4, 4), str(i), fill=(0, 255, 0)); ims.append(np.asarray(im))
    rows.append(np.hstack(ims))
Image.fromarray(np.vstack(rows)).save(outp, quality=85)
print(outp)
