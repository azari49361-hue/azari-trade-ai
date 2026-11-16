/**
 * Service worker سبک برای نصب اپ روی گوشی (PWA).
 *
 * قواعد:
 *  - هیچ درخواست /api هرگز کش نمی‌شود؛ قیمت‌ها باید همیشه تازه باشند.
 *  - فایل‌های ساخته‌شده (assets) کش می‌شوند تا اپ بدون شبکه هم باز شود.
 *  - ناوبری‌ها network-first هستند تا نسخهٔ جدید بلافاصله دیده شود؛
 *    اگر شبکه نبود، پوستهٔ کش‌شده برمی‌گردد.
 */
const CACHE = 'azari-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return;
  // در حالت dev فایل‌های سورس نباید کش شوند
  if (url.pathname.startsWith('/src/') || url.pathname.includes('/@vite') || url.pathname.includes('/@react-refresh')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
            }
            return res;
          })
          .catch(() => cached)
    )
  );
});
