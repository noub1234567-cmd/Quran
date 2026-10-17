/*
 * mel.js — استخراج ميزات log-mel بنفس طريقة NeMo (AudioToMelSpectrogramPreprocessor).
 * مستقل: يعمل في المتصفح (window.QuranMel) وفي Node (require).
 *
 * الإعدادات من preprocessor.json: 16kHz، نافذة 25ms، خطوة 10ms، n_fft=512،
 * 80 نطاق mel، hann، normalize=per_feature، dither=1e-5 (يُستخدم في التدريب فقط، فلا نطبقه).
 *
 * compute(samples: Float32Array في [-1,1]) → { data: Float32Array [80*T] (صف لكل نطاق)، mels: 80, frames: T, seqLen }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuranMel = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const DEFAULTS = {
    sampleRate: 16000, nFft: 512, winLength: 400, hop: 160, nMels: 80,
    preemph: 0.97, fMin: 0, fMax: null, logGuard: Math.pow(2, -24),
    padMode: 'constant',   // constant | reflect  (يُحدَّد بالمقارنة مع NeMo)
    normEps: 1e-5,
    seqLenMode: 'floor',   // floor: seq_len = floor(n/hop) ، full: كل الإطارات
  };

  // ---------- مقياس mel (slaney، كما في librosa) ----------
  const F_SP = 200 / 3, MIN_LOG_HZ = 1000, MIN_LOG_MEL = MIN_LOG_HZ / F_SP, LOGSTEP = Math.log(6.4) / 27;
  const hzToMel = (f) => (f >= MIN_LOG_HZ ? MIN_LOG_MEL + Math.log(f / MIN_LOG_HZ) / LOGSTEP : f / F_SP);
  const melToHz = (m) => (m >= MIN_LOG_MEL ? MIN_LOG_HZ * Math.exp(LOGSTEP * (m - MIN_LOG_MEL)) : F_SP * m);

  function melFilterbank(sr, nFft, nMels, fMin, fMax) {
    const nBins = nFft / 2 + 1;
    const fftFreqs = new Float64Array(nBins);
    for (let i = 0; i < nBins; i++) fftFreqs[i] = (i * sr) / nFft;
    const lo = hzToMel(fMin), hi = hzToMel(fMax);
    const melF = new Float64Array(nMels + 2);
    for (let i = 0; i < nMels + 2; i++) melF[i] = melToHz(lo + ((hi - lo) * i) / (nMels + 1));
    const W = [];
    for (let m = 0; m < nMels; m++) {
      const row = new Float64Array(nBins);
      const fdLow = melF[m + 1] - melF[m], fdHigh = melF[m + 2] - melF[m + 1];
      const enorm = 2 / (melF[m + 2] - melF[m]);
      for (let k = 0; k < nBins; k++) {
        const lower = (fftFreqs[k] - melF[m]) / fdLow;
        const upper = (melF[m + 2] - fftFreqs[k]) / fdHigh;
        row[k] = Math.max(0, Math.min(lower, upper)) * enorm;
      }
      W.push(row);
    }
    return W;
  }

  // ---------- FFT (radix-2) ----------
  function makeFFT(n) {
    const levels = Math.log2(n);
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < levels; b++) r |= ((i >>> b) & 1) << (levels - 1 - b);
      rev[i] = r;
    }
    return function (re, im) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
      }
      for (let size = 2; size <= n; size *= 2) {
        const half = size / 2, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l = j + half;
            const tr = re[l] * cos[k] + im[l] * sin[k];
            const ti = -re[l] * sin[k] + im[l] * cos[k];
            re[l] = re[j] - tr; im[l] = im[j] - ti;
            re[j] += tr; im[j] += ti;
          }
        }
      }
    };
  }

  function hannSymmetric(n) { // torch.hann_window(n, periodic=False)
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    return w;
  }

  function padIndex(i, n, mode) {
    if (i >= 0 && i < n) return i;
    if (mode === 'reflect') {
      if (i < 0) return -i;
      return 2 * (n - 1) - i;
    }
    return -1; // constant → 0
  }

  function create(opts) {
    const c = Object.assign({}, DEFAULTS, opts || {});
    const fMax = c.fMax == null ? c.sampleRate / 2 : c.fMax;
    const fb = melFilterbank(c.sampleRate, c.nFft, c.nMels, c.fMin, fMax);
    const fft = makeFFT(c.nFft);
    const win = hannSymmetric(c.winLength);
    const winOff = (c.nFft - c.winLength) >> 1; // torch يوسّط النافذة داخل n_fft
    const nBins = c.nFft / 2 + 1;

    function compute(samples) {
      const n = samples.length;
      // 1) pre-emphasis
      const x = new Float64Array(n);
      if (n) x[0] = samples[0];
      for (let i = 1; i < n; i++) x[i] = samples[i] - c.preemph * samples[i - 1];

      // 2) STFT مع center=True
      const pad = c.nFft >> 1;
      const frames = Math.floor(n / c.hop) + 1;
      const re = new Float64Array(c.nFft), im = new Float64Array(c.nFft);
      const power = new Float64Array(nBins);
      const logmel = new Float64Array(c.nMels * frames);
      for (let t = 0; t < frames; t++) {
        re.fill(0); im.fill(0);
        const start = t * c.hop - pad;
        for (let k = 0; k < c.winLength; k++) {
          const idx = padIndex(start + winOff + k, n, c.padMode);
          re[winOff + k] = idx < 0 ? 0 : x[idx] * win[k];
        }
        fft(re, im);
        for (let k = 0; k < nBins; k++) power[k] = re[k] * re[k] + im[k] * im[k];
        // 3) mel + log
        for (let m = 0; m < c.nMels; m++) {
          const row = fb[m];
          let s = 0;
          for (let k = 0; k < nBins; k++) s += row[k] * power[k];
          logmel[m * frames + t] = Math.log(s + c.logGuard);
        }
      }

      // 4) تطبيع per_feature على الإطارات الصالحة
      const seqLen = c.seqLenMode === 'full' ? frames : Math.min(frames, Math.floor(n / c.hop));
      const out = new Float32Array(c.nMels * frames);
      for (let m = 0; m < c.nMels; m++) {
        let mean = 0;
        for (let t = 0; t < seqLen; t++) mean += logmel[m * frames + t];
        mean /= seqLen;
        let v = 0;
        for (let t = 0; t < seqLen; t++) { const d = logmel[m * frames + t] - mean; v += d * d; }
        const std = Math.sqrt(v / Math.max(1, seqLen - 1));
        for (let t = 0; t < seqLen; t++) out[m * frames + t] = (logmel[m * frames + t] - mean) / (std + c.normEps);
        // الإطارات بعد seqLen تبقى 0 (pad_value)
      }
      return { data: out, mels: c.nMels, frames, seqLen };
    }

    return { compute, config: c };
  }

  return { create, melFilterbank, hzToMel, melToHz, DEFAULTS };
});
