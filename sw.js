const CACHE_NAME = 'omniclaude-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(['./', './index.html', './icon.png', './manifest.json'])
    )
  );
  self.skipWaiting();
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});