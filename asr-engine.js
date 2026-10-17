/*
 * asr-engine.js — محرك التعرّف على التلاوة داخل المتصفح (mel.js وctc.js وonnxruntime-web).
 * يعمل في خيط منفصل (asr-worker.js) كي لا تتجمّد الشاشة، وإن تعذّر ذلك يعمل في الخيط الرئيسي.
 *
 *   QuranASR.isReady()              هل النموذج محمَّل
 *   QuranASR.hasCachedModel()       هل ملف النموذج محفوظ في هاتفك
 *   QuranASR.load(onProgress)       يحمّل النموذج (من الذاكرة المحلية، وإلا من الإنترنت مرة واحدة)
 *   QuranASR.transcribe(blob)       تسجيل كامل → { text, confidence, seconds, ms }
 *   QuranASR.transcribeSamples(f32) عينات 16kHz أحادية → { text, confidence, seconds, ms }
 *   QuranASR.backend                'worker' | 'main' | 'none'
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
    useWorker: true,
    workerUrl: 'asr-worker.js?v=7',
    workerInitTimeoutMs: 90000,
  };

  let session = null, tokens = null, loading = null, mel = null;
  let worker = null, backend = 'none', seq = 0, chain = Promise.resolve();
  const pending = new Map();

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

  async function dropCachedModel() {
    const cache = await openCache();
    if (cache) { try { await cache.delete(modelUrl()); } catch (e) {} }
  }

  async function hasCachedModel() {
    const cache = await openCache();
    if (!cache) return false;
    return !!(await cache.match(modelUrl()));
  }

  function isReady() { return backend !== 'none'; }

  // ---------- الخيط المنفصل ----------
  function startWorker(tokensText, bytes) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker(config.workerUrl); } catch (e) { reject(e); return; }
      const timer = setTimeout(() => { try { w.terminate(); } catch (e) {} reject(new Error('انتهت مهلة تجهيز الخيط')); }, config.workerInitTimeoutMs);
      w.onerror = (ev) => { clearTimeout(timer); try { w.terminate(); } catch (e) {} reject(new Error('خطأ في الخيط: ' + (ev && ev.message || ''))); };
      w.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.type === 'ready') {
          clearTimeout(timer);
          w.onerror = null;
          w.onmessage = onWorkerMessage;
          worker = w;
          resolve();
        } else if (m.type === 'error') {
          clearTimeout(timer);
          try { w.terminate(); } catch (e) {}
          reject(new Error(m.message));
        }
      };
      // نقل دون نسخ عندما تغطي المصفوفة كامل الذاكرة (الحالة المعتادة) لتوفير 120MB على الهاتف
      const buf = (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      w.postMessage({ type: 'init', ortBase: config.ortBase, tokensText: tokensText, bytes: buf }, [buf]);
    });
  }

  function onWorkerMessage(ev) {
    const m = ev.data || {};
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.type === 'result') p.resolve(m);
    else p.reject(new Error(m.message || 'فشل التحليل'));
  }

  function runInWorker(samples) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      const copy = new Float32Array(samples); // نسخة كي لا نفصل مصفوفة المستدعي
      worker.postMessage({ type: 'run', id: id, samples: copy }, [copy.buffer]);
    });
  }

  // ---------- الخيط الرئيسي (احتياطي) ----------
  async function loadMain(tokensText, bytes) {
    if (!root.ort) await loadScript(config.ortBase + 'ort.min.js');
    root.ort.env.wasm.wasmPaths = config.ortBase;
    root.ort.env.wasm.numThreads = root.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    tokens = root.QuranCTC.parseTokens(tokensText);
    try {
      session = await root.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    } catch (e) {
      await dropCachedModel(); // قد يكون الملف المحفوظ تالفاً: يُنزَّل من جديد في المحاولة القادمة
      throw e;
    }
    if (!mel) mel = root.QuranMel.create();
    backend = 'main';
  }

  async function runMain(samples) {
    const t0 = performance.now();
    const m = mel.compute(samples);
    const feeds = {};
    feeds[session.inputNames[0]] = new root.ort.Tensor('float32', m.data, [1, m.mels, m.frames]);
    feeds[session.inputNames[1]] = new root.ort.Tensor('int64', BigInt64Array.from([BigInt(m.seqLen)]), [1]);
    const out = await session.run(feeds);
    const lp = out[session.outputNames[0]];
    const r = root.QuranCTC.greedy(lp.data, lp.dims[1], lp.dims[2], tokens);
    return { text: r.text, confidence: r.confidence, ms: performance.now() - t0 };
  }

  async function load(onProgress) {
    if (backend !== 'none') return;
    if (loading) return loading;
    loading = (async () => {
      if (!root.QuranMel || !root.QuranCTC) throw new Error('ملفات التصحيح لم تُحمَّل');
      const tokensText = new TextDecoder().decode(await cachedBytes(tokensUrl()));
      let bytes = await cachedBytes(modelUrl(), onProgress);
      if (config.useWorker && typeof Worker !== 'undefined') {
        try {
          await startWorker(tokensText, bytes);
          backend = 'worker';
          return;
        } catch (e) {
          if (root.console) console.warn('الخيط المنفصل غير متاح، سيعمل التصحيح في الخيط الرئيسي:', e);
          bytes = await cachedBytes(modelUrl(), onProgress); // الذاكرة نُقلت إلى الخيط؛ نقرؤها من التخزين المحلي
        }
      }
      await loadMain(tokensText, bytes);
    })();
    try { await loading; } finally { loading = null; }
  }

  // ---------- الصوت ----------
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

  // يُنفَّذ الطلبات واحداً بعد الآخر (النموذج يحلّل مقطعاً واحداً في الوقت نفسه)
  function transcribeSamples(samples) {
    if (backend === 'none') return Promise.reject(new Error('النموذج غير محمَّل'));
    if (samples.length < config.minSamples) return Promise.reject(new Error('التسجيل قصير جداً'));
    if (samples.length > config.maxSeconds * 16000) return Promise.reject(new Error('التسجيل أطول من ' + config.maxSeconds + ' ثانية'));
    const job = chain.then(async () => {
      const r = backend === 'worker' ? await runInWorker(samples) : await runMain(samples);
      return { text: r.text, confidence: r.confidence, seconds: samples.length / 16000, ms: r.ms };
    });
    chain = job.catch(() => {});
    return job;
  }

  async function transcribe(blob) {
    if (backend === 'none') throw new Error('النموذج غير محمَّل');
    const samples = await toMono16k(await blob.arrayBuffer());
    return transcribeSamples(samples);
  }

  return {
    config, isReady, hasCachedModel, load, transcribe, transcribeSamples,
    get backend() { return backend; },
  };
});
