// Service Worker — PWA 오프라인 캐시 (v7: js/ 파일 이름 정리 — Phase 2-1 지시서 #28)
const CACHE = 'wf-builder-v7'; // v6~v3 이력: 캐시 무효화·더보기 메뉴 캐시 문제·sync-status 이동
const ASSETS = [
  './index.html',
  './css/main.css',
  './css/mobile.css',
  './js/core-store.js',
  './js/canvas-render.js',
  './js/undo-run-engine.js',
  './js/groups-export-ws.js',
  './js/exec-status.js',
  './js/touch-input.js',
  './js/script-exec-pwa.js',
  './js/llm-trace.js',
  './js/virtual-render-palette.js',
  './js/agents-crud.js',
  './js/node-status-handoff.js',
  './js/approvals-metrics.js',
  './js/sessions-messages.js',
  './js/templates-market.js',
  './js/activity-feed.js',
  './js/tests-more-menu.js',
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
