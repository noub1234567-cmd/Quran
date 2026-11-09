/* worker.js — runs the ONNX phoneme model off the main thread.
 *   {type:'init', ortBase, bytes}  -> {type:'ready'} | {type:'error', message}
 *   {type:'run', id, samples}      -> {type:'result', id, logp, T, V, ms} | {type:'fail', id, message}
 * samples: Float32Array, 16 kHz mono. The clip is normalised (zero mean, unit variance) exactly as in training. */
'use strict';
var session = null;
self.onmessage = async function (ev) {
  var m = ev.data || {};
  if (m.type === 'init') {
    try {
      var gpu = m.ep === 'webgpu';
      if (gpu && !self.navigator.gpu) throw new Error('WebGPU غير متاح');
      if (!self.ort) importScripts(m.ortBase + (gpu ? 'ort.webgpu.min.js' : 'ort.min.js'));
      self.ort.env.wasm.wasmPaths = m.ortBase;
      self.ort.env.wasm.numThreads = (!gpu && self.crossOriginIsolated) ? Math.max(1, m.threads || 1) : 1;
      session = await self.ort.InferenceSession.create(new Uint8Array(m.bytes), { executionProviders: gpu ? ['webgpu'] : ['wasm'], graphOptimizationLevel: 'all' });
      self.postMessage({ type: 'ready', ep: m.ep, threads: self.ort.env.wasm.numThreads, isolated: !!self.crossOriginIsolated });
    } catch (e) { self.postMessage({ type: 'error', message: String((e && e.message) || e) }); }
    return;
  }
  if (m.type === 'run') {
    try {
      if (!session) throw new Error('model not loaded');
      var t0 = performance.now(), x = m.samples, n = x.length, mean = 0, v = 0, i;
      for (i = 0; i < n; i++) mean += x[i];
      mean /= n;
      for (i = 0; i < n; i++) { var d = x[i] - mean; v += d * d; }
      var inv = 1 / Math.sqrt(v / n + 1e-7), y = new Float32Array(n);
      for (i = 0; i < n; i++) y[i] = (x[i] - mean) * inv;
      var out = await session.run({ audio: new self.ort.Tensor('float32', y, [1, n]) });
      var lp = out[session.outputNames[0]];
      var data = new Float32Array(lp.data);
      self.postMessage({ type: 'result', id: m.id, logp: data, T: lp.dims[1], V: lp.dims[2], ms: performance.now() - t0 }, [data.buffer]);
    } catch (e) { self.postMessage({ type: 'fail', id: m.id, message: String((e && e.message) || e) }); }
  }
};
