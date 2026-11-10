// The offline cache is retired: it ignored the ?v= in file names and kept serving old try-on code.
// This version deletes every cache, unregisters itself and reloads open pages so they load fresh from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
