// يخزّن صفحات التطبيق ليفتح دون إنترنت (الصوت يُخزَّن من داخل التطبيق بزر «تحميل»)
const CACHE = 'quran-app-v8';
const KEEP = [CACHE, 'ayah-audio', 'qtext', 'fonts-v1', 'asr-model', 'asr-lib', 'phoneme-model'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.add(self.registration.scope).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k) && !k.startsWith('recite-quran-pwa-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open('fonts-v1').then((c) =>
        c.match(req).then((hit) => hit || fetch(req).then((res) => { c.put(req, res.clone()); return res; }))
      )
    );
    return;
  }
  // مكتبة onnxruntime-web: تُخزَّن مرة واحدة ليعمل التصحيح دون إنترنت
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.indexOf('/npm/onnxruntime-web@') === 0) {
    event.respondWith(
      caches.open('asr-lib').then((c) =>
        c.match(url.href).then((hit) => hit || fetch(url.href, { mode: 'cors' }).then((res) => { if (res.ok) c.put(url.href, res.clone()); return res; }))
      )
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  // تطبيق التسميع له عاملة خدمة مستقلة: لا نلمس ملفاته كي لا تتلوّث ذاكرته بنسخ قديمة
  if (url.pathname.indexOf('/recite/') !== -1) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match(self.registration.scope)))
  );
});
