const CACHE_NAME = 'akari-crm-shell-v7';
const APP_SHELL = [
  './index.html?runtime=v7',
  './assets/crm.css?v=7',
  './assets/runtime-guard.css?v=7',
  './assets/runtime-guard.js?v=7',
  './assets/crm.js?v=7',
  './assets/interaction-fix.js?v=7',
  './assets/favicon.svg',
  './manifest.webmanifest?v=7',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of APP_SHELL) {
        try {
          await cache.add(asset);
        } catch (error) {
          console.warn('AKARI CRM shell asset was not pre-cached', asset, error);
        }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const exact = await caches.match(request);
        if (exact) return exact;
        return caches.match('./index.html?runtime=v7');
      })
  );
});
