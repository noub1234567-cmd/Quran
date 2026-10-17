/*
 * ctc.js — فك ترميز مخرجات النموذج (logprobs) إلى نص. greedy CTC.
 * مستقل: window.QuranCTC في المتصفح، require في Node.
 *
 * مخرج النموذج: logprobs بشكل [1, T, 1025] — الرموز 0..1023 والصمت (blank) هو 1024.
 * tokens.txt: سطر لكل رمز (بدون سطر للصمت).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuranCTC = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  function parseTokens(text) {
    // لا نستخدم trim: بعض القطع قد تكون مسافة فقط (▁)
    return String(text).replace(/\r/g, '').split('\n');
  }

  /*
   * logprobs: Float32Array مسطّح [T * V]، T إطار، V = tokens.length + 1
   * length: عدد الإطارات الصالحة (اختياري)
   * يرجع { text, confidence (متوسط أفضل احتمال للرموز المنطوقة 0..1)، ids }
   */
  function greedy(logprobs, T, V, tokens, length) {
    const blank = V - 1;
    const n = length == null ? T : Math.min(T, length);
    const ids = [];
    let prev = -1, confSum = 0, confN = 0;
    for (let t = 0; t < n; t++) {
      let best = 0, bv = -Infinity;
      const o = t * V;
      for (let v = 0; v < V; v++) { const x = logprobs[o + v]; if (x > bv) { bv = x; best = v; } }
      if (best !== prev && best !== blank) { ids.push(best); confSum += Math.exp(bv); confN++; }
      prev = best;
    }
    const text = ids.map((i) => tokens[i] || '').join('').replace(/▁/g, ' ').replace(/\s+/g, ' ').trim();
    return { text, ids, confidence: confN ? confSum / confN : 0 };
  }

  return { parseTokens, greedy };
});
