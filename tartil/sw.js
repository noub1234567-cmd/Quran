// يخزّن ملفات الصفحة ليفتح دون إنترنت؛ النموذج يخزَّن من داخل التطبيق (Cache API: tartil-model)
const CACHE = 'tartil-app-v1';
const FILES = ['./', 'index.html', 'app.js', 'detect.js', 'tracker.js', 'live.js', 'worker.js', 'tartil_ref.json.gz', 'manifest.json'];
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES).catch(() => {}))); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== 'tartil-model' && k !== 'tartil-lib').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.indexOf('/npm/onnxruntime-web@') === 0) {
    e.respondWith(caches.open('tartil-lib').then((c) => c.match(url.href).then((h) => h || fetch(url.href, { mode: 'cors' }).then((r) => { if (r.ok) c.put(url.href, r.clone()); return r; }))));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.indexOf('/tartil/') < 0) return;
  e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r; }).catch(() => caches.match(req)));
});
