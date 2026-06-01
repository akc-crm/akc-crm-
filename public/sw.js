// AKC CRM Service Worker - Optimized Caching Strategy v2
const CACHE_STATIC = 'akc-crm-static-v2';
const CACHE_DATA = 'akc-crm-data-v2';

const APP_SHELL = ['/', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => cache.addAll(APP_SHELL)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_STATIC && k !== CACHE_DATA).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;

  // Supabase & Kiot: luon network, khong cache
  if (url.hostname.includes('supabase.co') || url.hostname.includes('kiotapi.com') || url.hostname.includes('kiotviet.vn')) return;

  // Static assets (JS/CSS/fonts co hash) - Cache-first: load tuc thi tu cache
  if (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.woff2') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(
      caches.open(CACHE_STATIC).then(cache =>
        cache.match(req).then(cached => {
          if (cached) return cached;
          return fetch(req).then(res => {
            if (res.ok) cache.put(req, res.clone()).catch(() => null);
            return res;
          });
        })
      )
    );
    return;
  }

  // API routes - Network-first, fallback cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) caches.open(CACHE_DATA).then(c => c.put(req, res.clone())).catch(() => null);
          return res;
        })
        .catch(() => caches.match(req).then(c => c || new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } })))
    );
    return;
  }

  // HTML navigation - Network-first, fallback index
  event.respondWith(
    fetch(req)
      .then(res => {
        caches.open(CACHE_STATIC).then(c => c.put(req, res.clone())).catch(() => null);
        return res;
      })
      .catch(() => caches.match(req).then(c => c || caches.match('/')))
  );
});
