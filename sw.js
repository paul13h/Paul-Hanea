// Keeps the whole try-on demo on the device after the first visit, so it runs without internet.
const CACHE = 'leidmann-tryon-v8';
const FILES = [
  './', 'index.html', 'shop.html', 'lib/three.min.js',
  'shop/img/cartier_0.jpg',
  'shop/img/cartier_1.jpg',
  'shop/img/cartier_2.jpg',
  'shop/img/jmm_0.jpg',
  'shop/img/jmm_1.jpg',
  'shop/img/jmm_2.jpg',
  'shop/img/matsuda_0.jpg',
  'shop/img/matsuda_1.jpg',
  'shop/img/matsuda_2.jpg',
  'shop/img/p20_0.jpg',
  'shop/img/p20_1.jpg',
  'shop/img/spitzer_0.jpg',
  'shop/img/spitzer_1.jpg',
  'shop/img/spitzer_2.jpg',
  'shop/img/z17_0.jpg',
  'shop/img/z17_1.jpg',
  'shop/img/z17_2.jpg',

  'lib/face_mesh/face_mesh.js',
  'lib/face_mesh/face_mesh.binarypb',
  'lib/face_mesh/face_mesh_solution_packed_assets.data',
  'lib/face_mesh/face_mesh_solution_packed_assets_loader.js',
  'lib/face_mesh/face_mesh_solution_simd_wasm_bin.data',
  'lib/face_mesh/face_mesh_solution_simd_wasm_bin.js',
  'lib/face_mesh/face_mesh_solution_simd_wasm_bin.wasm',
  'lib/face_mesh/face_mesh_solution_wasm_bin.js',
  'lib/face_mesh/face_mesh_solution_wasm_bin.wasm'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first for the page (so updates show up), cache first for the heavy libraries.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (isPage) {
    e.respondWith(fetch(req, { cache: 'no-store' }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  } else {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    })));
  }
});
