# cmp.py <R> <clip> <json-render> <out> <half> <dx> renders... -- frames...
# rows = frames; columns = original clip then each render; mirrored like the page; crop centred on landmark 168 + dx
import sys, json
from PIL import Image, ImageOps, ImageDraw
a = sys.argv[1:]; R, clip, js, out, h, dx = a[:6]; h = int(h); dx = float(dx)
k = a.index('--'); rends = a[6:k]; fr = [int(x) for x in a[k + 1:]]
rec = {r['i']: r for r in json.load(open(f'{R}/{js}.json'))['rec']}
import os; T = int(os.environ.get("T", 360)); W = Image.new('RGB', (T * (1 + len(rends)), int(T * .6) * len(fr)), (20, 20, 20))
for row, i in enumerate(fr):
    r = rec.get(i, {}); c = (r.get('det') or [[480, 320]])[0]
    for col, d in enumerate([clip] + rends):
        im = ImageOps.mirror(Image.open(f'{R}/{d}/{i:04d}.jpg').convert('RGB'))
        sc = im.width / 960; cx, cy = (960 - c[0] + dx) * sc, c[1] * sc
        t = im.crop((int(cx - h * sc), int(cy - .6 * h * sc), int(cx + h * sc), int(cy + .6 * h * sc))).resize((T, int(T * .6)), Image.LANCZOS)
        if col == 0: ImageDraw.Draw(t).text((6, 4), f"{i} yaw {r.get('yaw', 0):.0f}", fill=(255, 255, 0))
        W.paste(t, (col * T, row * int(T * .6)))
W.save(out)
