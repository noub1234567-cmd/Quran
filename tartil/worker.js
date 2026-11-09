/* worker.js — runs the ONNX phoneme model off the main thread.
 *   {type:'init', ortBase, bytes, provider:'wasm'|'webgpu', threads} -> {type:'ready', warmMs, threads} | {type:'error', message}
 *   {type:'run', id, samples}  -> {type:'result', id, logp, T, V, ms} | {type:'fail', id, message}
 * samples: Float32Array, 16 kHz mono. The clip is normalised (zero mean, unit variance) exactly as in training. */
'use strict';
var session = null;
async function infer(x) {
  var n = x.length, mean = 0, v = 0, i;
  for (i = 0; i < n; i++) mean += x[i];
  mean /= n;
  for (i = 0; i < n; i++) { var d = x[i] - mean; v += d * d; }
  var inv = 1 / Math.sqrt(v / n + 1e-7), y = new Float32Array(n);
  for (i = 0; i < n; i++) y[i] = (x[i] - mean) * inv;
  var out = await session.run({ audio: new self.ort.Tensor('float32', y, [1, n]) });
  var lp = out[session.outputNames[0]];
  return { data: new Float32Array(lp.data), T: lp.dims[1], V: lp.dims[2] };
}
self.onmessage = async function (ev) {
  var m = ev.data || {};
  if (m.type === 'init') {
    try {
      var gpu = m.provider === 'webgpu';
      importScripts(m.ortBase + (gpu ? 'ort.webgpu.min.js' : 'ort.min.js'));
      self.ort.env.wasm.wasmPaths = m.ortBase;
      self.ort.env.wasm.numThreads = gpu ? 1 : (m.threads || 1);
      session = await self.ort.InferenceSession.create(new Uint8Array(m.bytes), { executionProviders: [gpu ? 'webgpu' : 'wasm'], graphOptimizationLevel: 'all' });
      // warm-up: first run compiles kernels/shaders; the second run measures the real speed on 3 s of audio
      var noise = new Float32Array(48000); for (var k = 0; k < noise.length; k++) noise[k] = (Math.random() - 0.5) * 0.2;
      await infer(noise);
      var t0 = performance.now(); await infer(noise);
      self.postMessage({ type: 'ready', warmMs: performance.now() - t0, threads: gpu ? 1 : self.ort.env.wasm.numThreads });
    } catch (e) { self.postMessage({ type: 'error', message: String((e && e.message) || e) }); }
    return;
  }
  if (m.type === 'run') {
    try {
      if (!session) throw new Error('model not loaded');
      var t1 = performance.now(), r = await infer(m.samples);
      self.postMessage({ type: 'result', id: m.id, logp: r.data, T: r.T, V: r.V, ms: performance.now() - t1 }, [r.data.buffer]);
    } catch (e) { self.postMessage({ type: 'fail', id: m.id, message: String((e && e.message) || e) }); }
  }
};
