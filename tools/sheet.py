# sheet.py <data-dir> <out.jpg> <title> <run-name> [run-name2]
# Contact sheet: per ground-truth frame, real clip crop | ghost render of run-name [| ghost of run-name2], mirrored like the page.
# Runs are directories runs/NAME/{imix,fl,kmix}(.json). Front crops centre on the lens midpoint; arm crops shift towards the
# near ear (nose-tip vs bridge offset) with a larger half-width. Data (frames, runs) lives outside the repo.
import sys, json
from PIL import Image, ImageOps, ImageDraw
D, out, title = sys.argv[1:4]; names = sys.argv[4:]
GROUPS = [  # (clip, [(frame, kind)])
 ('imix', [(466,'up'),(471,'up'),(476,'up'),(495,'down'),(498,'down'),(502,'down'),(452,'straight'),(742,'straight'),(642,'3/4'),(712,'3/4'),
           (342,'arm turned'),(420,'arm turned'),(472,'arm up'),(496,'arm down')]),
 ('fl', [(500,'arm profile'),(515,'arm profile'),(545,'arm profile')]),
 ('kmix', [(403,'straight'),(428,'straight'),(464,'turned L -35'),(486,'arm -48'),(495,'arm -48'),(576,'turned R +29'),(584,'turned R +31'),
           (592,'arm +55'),(664,'down'),(668,'down'),(672,'down -14'),(712,'up'),(720,'up +35'),(784,'arm -43'),(840,'turn R +31')])]
T = 360; H = int(T * .6); N = 1 + len(names)
cells = []
for clip, lst in GROUPS:
    recs = [{r['i']: r for r in json.load(open(f'{D}/runs/{n}/{clip}.json'))['rec']} for n in names]
    for i, kind in lst:
        r = recs[0].get(i, {}); det = r.get('det'); arm = kind.startswith('arm')
        c = det[0] if det else [480, 320]
        h = 230 if arm else 120; dx = 0.0
        lens = r.get('lens')
        if not arm and lens:   # front: centre on the lens midpoint, half-width 1.25 x lens separation (hinges in view)
            c = [(lens[0][0] + lens[1][0]) / 2, (lens[0][1] + lens[1][1]) / 2]
            h = 1.25 * ((lens[0][0] - lens[1][0]) ** 2 + (lens[0][1] - lens[1][1]) ** 2) ** .5
        if arm and det:
            big = abs(r.get('yaw', 0)) > 70
            dx = (det[4][0] - det[0][0]) * (3.6 if big else 2.2)   # det[4] = nose tip
            dx = max(-.6 * h, min(.6 * h, dx)) if not big else max(-.95 * h, min(.95 * h, dx))
        row = []
        for d in [clip] + [f'runs/{n}/{clip}' for n in names]:
            try: im = ImageOps.mirror(Image.open(f'{D}/{d}/{i:04d}.jpg').convert('RGB'))
            except FileNotFoundError: row.append(Image.new('RGB', (T, H))); continue
            sc = im.width / 960; cx = (960 - c[0] + dx) * sc; cy = (c[1] + (25 if arm else 0)) * sc
            hw, hh = h * sc, .6 * h * sc
            cx = min(max(cx, hw), im.width - hw); cy = min(max(cy, hh), im.height - hh)   # clamp the box inside the image
            row.append(im.crop((int(cx - hw), int(cy - hh), int(cx + hw), int(cy + hh))).resize((T, H), Image.LANCZOS))
        ImageDraw.Draw(row[0]).text((6, 4), f"{clip} {i}  {kind}  yaw {r.get('yaw', float('nan')):.0f}", fill=(255, 255, 0))
        for k, n in enumerate(names): ImageDraw.Draw(row[k + 1]).text((6, 4), ('ghost ' + n) if len(names) > 1 else 'ghost', fill=(255, 255, 0))
        cells.append(row)
per = 2; rows = (len(cells) + per - 1) // per
S = Image.new('RGB', (per * N * T, rows * H + 18), (20, 20, 20))
ImageDraw.Draw(S).text((6, 3), title, fill=(255, 255, 255))
for n, row in enumerate(cells):
    x = (n % per) * N * T; y = 18 + (n // per) * H
    for k, t in enumerate(row): S.paste(t, (x + k * T, y))
S.save(out, quality=88)
