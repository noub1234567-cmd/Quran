/*
 * asr-engine.js — محرك التعرّف على التلاوة داخل المتصفح (يعتمد على mel.js وctc.js وonnxruntime-web).
 *
 *   QuranASR.isReady()            هل النموذج محمَّل في الذاكرة
 *   QuranASR.hasCachedModel()     هل ملف النموذج محفوظ في هاتفك (لا يحتاج تحميلاً)
 *   QuranASR.load(onProgress)     يحمّل النموذج (من الذاكرة المحلية إن وُجد، وإلا من الإنترنت مرة واحدة)
 *   QuranASR.transcribe(blob)     يرجع { text, confidence, seconds, ms }
 *
 * الإعدادات في QuranASR.config (رابط النموذج وغيره).
 */
(function (root, factory) {
  root.QuranASR = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const config = {
    base: 'https://huggingface.co/noubou/quran-asr-onnx/resolve/main/',
    model: 'model.mmpc.onnx',
    tokens: 'tokens.txt',
    ortBase: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/',
    cacheName: 'asr-model',
    maxSeconds: 180,
    minSamples: 1600, // 0.1 ثانية
  };

  let session = null, tokens = null, loading = null, busy = false, mel = null;

  const modelUrl = () => config.base + config.model;
  const tokensUrl = () => config.base + config.tokens;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('تعذّر تحميل مكتبة التشغيل (تحقق من الإنترنت)'));
      document.head.appendChild(s);
    });
  }

  async function openCache() {
    try { return await caches.open(config.cacheName); } catch (e) { return null; }
  }

  async function fetchBytes(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('تعذّر تنزيل الملف (HTTP ' + res.status + ')');
    const total = +res.headers.get('content-length') || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      chunks.push(r.value);
      got += r.value.length;
      if (onProgress) onProgress(got, total);
    }
    if (total && got !== total) throw new Error('انقطع التنزيل قبل أن يكتمل، أعد المحاولة');
    const buf = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    return buf;
  }

  async function cachedBytes(url, onProgress) {
    const cache = await openCache();
    if (cache) {
      const hit = await cache.match(url);
      if (hit) return new Uint8Array(await hit.arrayBuffer());
    }
    const buf = await fetchBytes(url, onProgress);
    if (cache) { try { await cache.put(url, new Response(buf)); } catch (e) { /* التخزين ممتلئ: نكمل بدون حفظ */ } }
    return buf;
  }

  async function hasCachedModel() {
    const cache = await openCache();
    if (!cache) return false;
    return !!(await cache.match(modelUrl()));
  }

  function isReady() { return !!session; }

  async function load(onProgress) {
    if (session) return;
    if (loading) return loading;
    loading = (async () => {
      if (!root.QuranMel || !root.QuranCTC) throw new Error('ملفات التصحيح لم تُحمَّل');
      if (!root.ort) await loadScript(config.ortBase + 'ort.min.js');
      root.ort.env.wasm.wasmPaths = config.ortBase;
      root.ort.env.wasm.numThreads = root.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      const tk = await cachedBytes(tokensUrl());
      tokens = root.QuranCTC.parseTokens(new TextDecoder().decode(tk));
      const bytes = await cachedBytes(modelUrl(), onProgress);
      try {
        session = await root.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      } catch (e) {
        // قد يكون الملف المحفوظ تالفاً: نحذفه ليُنزَّل من جديد في المحاولة القادمة
        const cache = await openCache();
        if (cache) { try { await cache.delete(modelUrl()); } catch (e2) {} }
        throw e;
      }
      if (!mel) mel = root.QuranMel.create();
    })();
    try { await loading; } finally { loading = null; }
  }

  async function toMono16k(arrayBuffer) {
    const AC = root.AudioContext || root.webkitAudioContext;
    const ctx = new AC();
    let buf;
    try { buf = await ctx.decodeAudioData(arrayBuffer.slice(0)); }
    finally { try { ctx.close(); } catch (e) {} }
    const len = Math.max(1, Math.ceil(buf.duration * 16000));
    const off = new OfflineAudioContext(1, len, 16000);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return rendered.getChannelData(0);
  }

  async function transcribe(blob) {
    if (!session) throw new Error('النموذج غير محمَّل');
    if (busy) throw new Error('جارٍ تصحيح تسجيل آخر، انتظر لحظة');
    busy = true;
    try {
      const samples = await toMono16k(await blob.arrayBuffer());
      if (samples.length < config.minSamples) throw new Error('التسجيل قصير جداً');
      if (samples.length > config.maxSeconds * 16000) throw new Error('التسجيل أطول من ' + config.maxSeconds + ' ثانية');
      const t0 = performance.now();
      const m = mel.compute(samples);
      const feeds = {};
      feeds[session.inputNames[0]] = new root.ort.Tensor('float32', m.data, [1, m.mels, m.frames]);
      feeds[session.inputNames[1]] = new root.ort.Tensor('int64', BigInt64Array.from([BigInt(m.seqLen)]), [1]);
      const out = await session.run(feeds);
      const lp = out[session.outputNames[0]];
      const r = root.QuranCTC.greedy(lp.data, lp.dims[1], lp.dims[2], tokens);
      return { text: r.text, confidence: r.confidence, seconds: samples.length / 16000, ms: performance.now() - t0 };
    } finally {
      busy = false;
    }
  }

  return { config, isReady, hasCachedModel, load, transcribe };
});
