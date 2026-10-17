/*
 * asr-worker.js — يشغّل النموذج في خيط منفصل كي لا تتجمّد الشاشة أثناء التحليل.
 * الرسائل:
 *   {type:'init', ortBase, tokensText, bytes}   → {type:'ready'} أو {type:'error', message}
 *   {type:'run', id, samples}                    → {type:'result', id, text, confidence, ms} أو {type:'fail', id, message}
 */
'use strict';
var Q = self.location.search || '';
var session = null, tokens = null, mel = null;

try { importScripts('mel.js' + Q, 'ctc.js' + Q); } catch (e) { self.__initError = 'تعذّر تحميل ملفات التصحيح داخل الخيط: ' + e; }

self.onmessage = async function (ev) {
  var m = ev.data || {};
  if (m.type === 'init') {
    try {
      if (self.__initError) throw new Error(self.__initError);
      if (!self.ort) importScripts(m.ortBase + 'ort.min.js');
      self.ort.env.wasm.wasmPaths = m.ortBase;
      self.ort.env.wasm.numThreads = 1;
      tokens = self.QuranCTC.parseTokens(m.tokensText);
      session = await self.ort.InferenceSession.create(new Uint8Array(m.bytes), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      mel = self.QuranMel.create();
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', message: String((e && e.message) || e) });
    }
    return;
  }
  if (m.type === 'run') {
    try {
      if (!session) throw new Error('النموذج غير محمَّل');
      var t0 = performance.now();
      var f = mel.compute(m.samples);
      var feeds = {};
      feeds[session.inputNames[0]] = new self.ort.Tensor('float32', f.data, [1, f.mels, f.frames]);
      feeds[session.inputNames[1]] = new self.ort.Tensor('int64', BigInt64Array.from([BigInt(f.seqLen)]), [1]);
      var out = await session.run(feeds);
      var lp = out[session.outputNames[0]];
      var r = self.QuranCTC.greedy(lp.data, lp.dims[1], lp.dims[2], tokens);
      self.postMessage({ type: 'result', id: m.id, text: r.text, confidence: r.confidence, ms: performance.now() - t0 });
    } catch (e) {
      self.postMessage({ type: 'fail', id: m.id, message: String((e && e.message) || e) });
    }
  }
};
