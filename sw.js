// Service Worker — PWA 오프라인 캐시 (index.html + 폰트)
const CACHE = 'wf-builder-v2';
const ASSETS = [
  './index.html',
  './fonts/Isamanru-Light.woff',
  './fonts/Isamanru-Medium.woff',
  './fonts/Isamanru-Bold.woff'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // API 요청은 캐시하지 않음 (신선도 유지)
  if (e.request.url.includes('/api/') || e.request.url.includes('/ws')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(m => m || caches.match('./index.html')))
  );
});
