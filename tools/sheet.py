# sheet.py <data-dir> <imix-run> <fl-run> <out.jpg> [title]
# Contact sheet: per ground-truth frame, real clip crop | ghost render crop (both mirrored like the page).
# Front crops centre on landmark 168 (nose bridge); arm crops shift towards the near ear (from nose-vs-bridge offset)
# and use a larger half-width. Data (frames, runs) lives outside the repo.
import sys, json
from PIL import Image, ImageOps, ImageDraw
D, runI, runF, out = sys.argv[1:5]; title = sys.argv[5] if len(sys.argv) > 5 else ''
GROUPS = [  # (clip, run, [(frame, kind)])
 ('imix', runI, [(466,'up'),(471,'up'),(476,'up'),(495,'down'),(498,'down'),(502,'down'),(452,'straight'),(742,'straight'),(642,'3/4'),(712,'3/4'),
                 (342,'arm turned'),(420,'arm turned'),(472,'arm up'),(496,'arm down')]),
 ('fl', runF, [(500,'arm profile'),(515,'arm profile'),(545,'arm profile')])]
T = 360; H = int(T * .6)
cells = []
for clip, run, lst in GROUPS:
    rec = {r['i']: r for r in json.load(open(f'{D}/{run}.json'))['rec']}
    for i, kind in lst:
        r = rec.get(i, {}); det = r.get('det'); arm = kind.startswith('arm')
        c = det[0] if det else [480, 320]
        h = 230 if arm else 120; dx = 0.0
        if arm and det: dx = (det[4][0] - det[0][0]) * 2.2   # det[4] = nose tip; sign: see module docstring
        dx = max(-.6 * h, min(.6 * h, dx))
        if arm: h = 230
        row = []
        for d in (clip, run):
            im = ImageOps.mirror(Image.open(f'{D}/{d}/{i:04d}.jpg').convert('RGB'))
            sc = im.width / 960; cx = (960 - c[0] + dx) * sc; cy = (c[1] + (25 if arm else 0)) * sc
            t = im.crop((int(cx - h * sc), int(cy - .6 * h * sc), int(cx + h * sc), int(cy + .6 * h * sc))).resize((T, H), Image.LANCZOS)
            row.append(t)
        ImageDraw.Draw(row[0]).text((6, 4), f"{clip} {i}  {kind}  yaw {r.get('yaw', float('nan')):.0f}", fill=(255, 255, 0))
        ImageDraw.Draw(row[1]).text((6, 4), 'ghost', fill=(255, 255, 0))
        cells.append(row)
per = 2; rows = (len(cells) + per - 1) // per
S = Image.new('RGB', (4 * T, rows * H + 18), (20, 20, 20))
ImageDraw.Draw(S).text((6, 3), title, fill=(255, 255, 255))
for n, row in enumerate(cells):
    x = (n % per) * 2 * T; y = 18 + (n // per) * H
    S.paste(row[0], (x, y)); S.paste(row[1], (x + T, y))
S.save(out, quality=88)
