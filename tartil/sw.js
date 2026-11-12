// يخزّن ملفات الصفحة ليفتح دون إنترنت، ويضيف ترويسات العزل (COOP/COEP) كي تعمل خيوط WebAssembly المتعددة.
// النموذج يخزَّن من داخل التطبيق (Cache API: tartil-model).
const CACHE = 'tartil-app-v8';
const FILES = ['./', 'index.html', 'app.js', 'detect.js', 'tracker.js', 'live.js', 'worker.js', 'tartil_ref.json.gz', 'manifest.json'];
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => Promise.all(FILES.map((f) => c.add(new Request(f, { cache: 'reload' })).catch(() => {}))))); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== 'tartil-model' && k !== 'tartil-lib').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
function isolate(r) {
  if (!r || r.status === 0) return r;
  const h = new Headers(r.headers);
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  const url = new URL(req.url);
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.indexOf('/npm/onnxruntime-web@') === 0) {
    e.respondWith(caches.open('tartil-lib').then((c) => c.match(url.href).then((h) => h || fetch(url.href, { mode: 'cors' }).then((r) => { if (r.ok) c.put(url.href, r.clone()); return r; }))));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.indexOf('/tartil/') < 0) return;
  e.respondWith(fetch(req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache' }) : new Request(req, { cache: 'no-cache' })).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return isolate(r); })
    .catch(() => caches.match(req).then((r) => isolate(r))));
});
