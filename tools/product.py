# Renders v2/product.html views to PNGs:  python3 tools/product.py <outdir> <port> [extra query]
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
out, port = sys.argv[1], sys.argv[2]; extra = sys.argv[3] if len(sys.argv) > 3 else ''
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', port], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']); pg = b.new_page(viewport={'width': 1400, 'height': 900})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        for v in ('front', 'q', 'side', 'top', 'hinge', 'back'):
            pg.goto(f'http://localhost:{port}/v2/product.html?view={v}&{extra}'); pg.wait_for_function('window.done', timeout=30000)
            pg.locator('canvas').screenshot(path=f'{out}/{v}.png')
        print('errors', errs[:3]); b.close()
finally: srv.terminate()
