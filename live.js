/*
 * live.js — تحليل التلاوة أثناء القراءة (شبه حي).
 * يلتقط الصوت من الميكروفون، يقطعه عند الوقفات القصيرة إلى مقاطع، ويحلل كل مقطع فور اكتماله.
 *
 *   QuranLive.start(stream, { transcribe(samples16k)->Promise<{text,ms}>, ready()->Promise, onUpdate(u) })
 *       -> Promise<controller>    controller.stop() -> Promise<{text,texts,segments,ms,seconds,errors}>
 *   QuranLive.createSegmenter(opts)   مقطِّع نقي (للاختبار)
 *   QuranLive.createResampler(inRate,outRate)
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QuranLive = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const SR = 16000;

  // ---------- إعادة أخذ العينات إلى 16kHz (متوسط نافذة) ----------
  function createResampler(inRate, outRate) {
    if (inRate === outRate) return { push: (c) => c };
    const ratio = inRate / outRate;
    let pos = 0, tail = new Float32Array(0);
    return {
      push(chunk) {
        const x = new Float32Array(tail.length + chunk.length);
        x.set(tail); x.set(chunk, tail.length);
        const out = [];
        while (pos + ratio <= x.length) {
          const a = Math.floor(pos), b = Math.max(a + 1, Math.floor(pos + ratio));
          let s = 0;
          for (let i = a; i < b; i++) s += x[i];
          out.push(s / (b - a));
          pos += ratio;
        }
        const keep = Math.floor(pos);
        tail = x.slice(keep);
        pos -= keep;
        return Float32Array.from(out);
      },
    };
  }

  // ---------- المقطِّع: يقطع عند الوقفات ----------
  function createSegmenter(o) {
    o = Object.assign({
      frame: 320,          // 20ms
      pauseMs: 450,        // وقفة تُنهي المقطع
      minSegMs: 1200,      // لا نقطع قبل هذا الطول
      maxSegMs: 10000,     // قطع إجباري عند أضعف نقطة
      minVoicedMs: 350,    // أقل كلام لاعتبار المقطع
      keepMs: 150,         // صمت يُحتفظ به حول الكلام
      thrMin: 0.010,
      floorMul: 3.5,
    }, o || {});
    const F = o.frame, FMS = 1000 * F / SR;
    let buf = new Float32Array(SR * 30), n = 0;
    const en = [], sil = [];
    let frames = 0, segStart = 0, floor = 0.003;
    const fw = [];
    const out = [];
    const keepS = Math.round(o.keepMs * SR / 1000);

    function ensure(extra) {
      if (n + extra <= buf.length) return;
      let cap = buf.length;
      while (cap < n + extra) cap *= 2;
      const nb = new Float32Array(cap); nb.set(buf.subarray(0, n)); buf = nb;
    }
    function frameRms(f) {
      let s = 0; const a = f * F;
      for (let i = a; i < a + F; i++) s += buf[i] * buf[i];
      return Math.sqrt(s / F);
    }
    const firstFrame = () => Math.ceil(segStart / F);
    function countVoiced(from, to) { let c = 0; for (let f = from; f < to; f++) if (!sil[f]) c++; return c; }
    function trailSilence() { let c = 0; for (let f = frames - 1; f >= firstFrame() && sil[f]; f--) c++; return c; }
    function emit(end, forced) {
      if (end <= segStart) return;
      out.push({ samples: buf.slice(segStart, end), start: segStart / SR, end: end / SR, forced: !!forced });
    }

    function step() {
      const f = frames;
      const r = frameRms(f);
      // مستوى الضجيج = أصغر طاقة خلال آخر ~3 ثوانٍ، فلا يرتفع أثناء الكلام المتصل
      fw.push(r); if (fw.length > 150) fw.shift();
      let mn = Infinity; for (let k = 0; k < fw.length; k++) if (fw[k] < mn) mn = fw[k];
      floor = Math.max(0.001, mn);
      const thr = Math.min(Math.max(o.thrMin, floor * o.floorMul), 0.04);
      en.push(r); sil.push(r < thr);
      frames++;
      const f0 = firstFrame();
      const segMs = (frames - f0) * FMS;
      const voiced = countVoiced(f0, frames);
      const sRun = trailSilence();
      if (voiced === 0) {
        // لا كلام بعد: نُبقي ذيلاً قصيراً من الصمت فقط
        if (segMs > 600) segStart = Math.max(segStart, frames * F - keepS);
        return;
      }
      if (voiced * FMS >= o.minVoicedMs && sRun * FMS >= o.pauseMs && segMs >= o.minSegMs) {
        const end = frames * F - Math.max(0, sRun * F - keepS);
        emit(end, false);
        segStart = frames * F - keepS;
        return;
      }
      if (segMs >= o.maxSegMs) {
        const lo = Math.max(f0 + 2, frames - Math.round(5000 / FMS)), hi = frames - Math.round(300 / FMS);
        let best = hi - 1, bv = Infinity;
        // أهدأ موضع (متوسط 3 إطارات) كي لا نقطع داخل كلمة عند انخفاض لحظي
        for (let k = lo; k < hi; k++) { const v = (en[k - 1] + en[k] + en[k + 1]) / 3; if (v < bv) { bv = v; best = k; } }
        const end = (best + 1) * F;
        emit(end, true);
        segStart = end;
      }
    }

    return {
      push(chunk) {
        ensure(chunk.length);
        buf.set(chunk, n); n += chunk.length;
        while ((frames + 1) * F <= n) step();
        return out.splice(0, out.length);
      },
      flush() {
        const f0 = firstFrame();
        const voiced = countVoiced(f0, frames);
        if (voiced * FMS >= Math.min(o.minVoicedMs, 250) && n - segStart > 0) emit(n, false);
        segStart = n;
        return out.splice(0, out.length);
      },
      get seconds() { return n / SR; },
    };
  }

  // ---------- التقاط الصوت وتحليله ----------
  const WORKLET = `class P extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.n=0;}
process(i){const c=i[0]&&i[0][0];if(c){for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===2048){this.port.postMessage(this.b.slice(0));this.n=0;}}}return true;}}
registerProcessor('quran-pcm',P);`;

  async function start(stream, opts) {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC || !root.AudioWorkletNode) throw new Error('المتصفح لا يدعم البث الحي');
    let ctx;
    try { ctx = new AC({ sampleRate: SR }); } catch (e) { ctx = new AC(); }
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
    const src = ctx.createMediaStreamSource(stream);
    const node = new root.AudioWorkletNode(ctx, 'quran-pcm', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const mute = ctx.createGain(); mute.gain.value = 0;
    src.connect(node); node.connect(mute); mute.connect(ctx.destination);

    const seg = createSegmenter(opts.segmenter);
    const rs = createResampler(ctx.sampleRate, SR);
    const queue = [], texts = [];
    let idx = 0, running = false, stopped = false, totalMs = 0, errors = 0, failed = false, drainRes = null, processing = false;

    const update = () => { if (opts.onUpdate) { try { opts.onUpdate({ texts: texts.filter(Boolean), processing, pending: queue.length, seconds: seg.seconds }); } catch (e) {} } };
    function enqueue(list) { list.forEach((s) => { queue.push({ i: idx++, samples: s.samples }); }); if (list.length) pump(); }

    async function pump() {
      if (running) return;
      running = true;
      try {
        if (opts.ready) { try { await opts.ready(); } catch (e) { failed = true; queue.length = 0; } }
        while (queue.length && !failed) {
          const job = queue.shift();
          processing = true; update();
          try {
            const r = await opts.transcribe(job.samples);
            totalMs += r.ms || 0;
            texts[job.i] = (r.text || '').trim();
          } catch (e) { errors++; texts[job.i] = ''; }
          processing = false; update();
        }
      } finally {
        running = false;
        if (stopped && !queue.length && drainRes) drainRes();
      }
    }

    node.port.onmessage = (ev) => {
      if (stopped) return;
      const pcm = rs.push(ev.data);
      if (pcm.length) enqueue(seg.push(pcm));
    };

    return {
      stop() {
        if (stopped) return Promise.resolve(null);
        stopped = true;
        try { src.disconnect(); node.disconnect(); mute.disconnect(); } catch (e) {}
        try { ctx.close(); } catch (e) {}
        enqueue(seg.flush());
        const seconds = seg.seconds;
        return new Promise((resolve) => {
          const done = () => {
            const list = texts.filter(Boolean);
            resolve({ ok: !failed, text: list.join(' '), texts: list, segments: idx, ms: totalMs, seconds, errors });
          };
          if (!running && !queue.length) done(); else drainRes = done;
        });
      },
    };
  }

  return { SR, createResampler, createSegmenter, start };
});
