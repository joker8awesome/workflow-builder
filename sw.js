// Service Worker — PWA 오프라인 캐시 (v3: 더보기 메뉴 캐시 문제 해결 — 네트워크 우선 강화)
const CACHE = 'wf-builder-v4'; // v4: sync-status 이동 반영 — 구버전 캐시 강제 무효화
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
  if (e.request.url.includes('/api/') || e.request.url.includes('/ws')) return;
  // 네트워크 우선 — 성공 시 캐시 갱신, 실패 시에만 캐시 폴백
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
