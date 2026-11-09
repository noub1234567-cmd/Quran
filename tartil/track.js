/*
 * track.js — تتبّع القراءة: يربط ما سُمع في مقطع صوتي بموضعه في المقطع المرجعي، ويحوّل علامات الكاشف إلى حالات للكلمات.
 */
(function (root, factory) {
  const api = factory(root.TartilPhonemizer, root.TartilDetect);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TartilTrack = api;
})(typeof self !== 'undefined' ? self : this, function (PH, DET) {
  'use strict';
  if (!PH && typeof require === 'function') { PH = require('./phonemizer.js'); DET = require('./detect.js'); }

  /* المرجع لمقطع من الآيات: كل آية تُصوَّت وحدها (وقف في آخرها) ثم تُوصَل، كما في التدريب. */
  function buildPassage(corpus, sura, a0, a1, cfg) {
    const phones = [], words = [], wordVerse = [], wordNo = [];
    for (let a = a0; a <= a1; a++) {
      const text = corpus[sura + ':' + a];
      if (!text) throw new Error('الآية ' + sura + ':' + a + ' غير موجودة في النص');
      const r = PH.phonemize(text, { cfg });
      const off = words.length;
      for (const p of r.phones) phones.push({ sym: p.sym, word: p.word + off, g: p.g, dur: p.dur, tags: p.tags });
      r.words.forEach((w, i) => { words.push(w); wordVerse.push(a); wordNo.push(i + 1); });
    }
    return { phones, words, wordVerse, wordNo, syms: phones.map((p) => p.sym) };
  }

  /* محاذاة شبه عامة: hyp (ما سُمع) مقابل ref[lo,hi) ببداية ونهاية حرّتين في المرجع. */
  function locate(hyp, refSyms, lo, hi) {
    lo = Math.max(0, lo); hi = Math.min(refSyms.length, hi);
    const n = hyp.length, m = hi - lo;
    if (n === 0 || m <= 0) return null;
    const W = m + 1;
    const D = new Int32Array((n + 1) * W), B = new Uint8Array((n + 1) * W);
    for (let i = 1; i <= n; i++) { D[i * W] = i; B[i * W] = 2; }
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
      const sub = D[(i - 1) * W + j - 1] + (hyp[i - 1] === refSyms[lo + j - 1] ? 0 : 1);
      const ins = D[(i - 1) * W + j] + 1;      // صوت زائد في القراءة
      const del = D[i * W + j - 1] + 1;        // فونيم مرجعي لم يُسمع
      let best = sub, b = 0;
      if (ins < best) { best = ins; b = 2; }
      if (del < best) { best = del; b = 1; }
      D[i * W + j] = best; B[i * W + j] = b;
    }
    let bj = 1, bc = Infinity;
    for (let j = 1; j <= m; j++) { const c = D[n * W + j]; if (c < bc) { bc = c; bj = j; } }
    let i = n, j = bj, firstMatch = -1;
    while (i > 0 && j > 0) {
      const b = B[i * W + j];
      if (b === 0) { if (hyp[i - 1] === refSyms[lo + j - 1]) firstMatch = j - 1; i--; j--; }
      else if (b === 2) i--;
      else j--;
    }
    // نبدأ من أول مطابقة فعلية (نتجاهل الحذف في البداية)
    let start = firstMatch >= 0 ? firstMatch : Math.max(0, j);
    return { a: lo + start, b: lo + bj, cost: bc, n };
  }

  /* يحلّل مقطعاً صوتياً: logp مسطّح [T*V] */
  function processSegment(state, logp, T, V, vocab, opts) {
    opts = opts || {};
    const inv = state.inv || (state.inv = Object.fromEntries(Object.entries(vocab).map(([s, i]) => [i, s])));
    const hyp = DET.greedySymbols(logp, T, V, inv);
    const out = { hyp, status: 'skip', flags: [], a: -1, b: -1 };
    if (hyp.length < 4) return out;
    const ref = state.passage;
    const L = ref.syms.length;
    let loc = null;
    const tryWin = (lo, hi) => {
      const r = locate(hyp, ref.syms, lo, hi);
      return r && r.cost <= Math.max(2, 0.45 * hyp.length) ? r : null;
    };
    if (state.ptr > 0) loc = tryWin(state.ptr - 25, state.ptr + hyp.length * 2 + 60);
    if (!loc) loc = tryWin(0, L);
    if (!loc) { out.status = 'nomatch'; return out; }
    const a = loc.a, b = loc.b;
    if (b - a < 3) { out.status = 'nomatch'; return out; }
    const slice = { phones: ref.phones.slice(a, b), words: ref.words };
    let flags;
    try { flags = DET.analyze(logp, T, V, slice, vocab, opts.params); }
    catch (e) { out.status = e instanceof DET.Unreliable ? 'unreliable' : 'short'; return out; }
    // العلامات المؤكدة قرب طرفي المقطع قد تكون بسبب القطع: تُخفَّض إلى "محتمل"
    const edge = 2;
    for (const f of flags) {
      f.gidx = a + f.idx;
      const ph = ref.phones[f.gidx];
      f.verse = ref.wordVerse[f.word]; f.wordNo = ref.wordNo[f.word];
      f.edge = f.idx < edge || f.idx >= (b - a) - edge;
      if (f.edge && f.level === 'confirmed') { f.level = 'possible'; f.tier = 'B'; }
    }
    // حالة كل كلمة في المقطع (الأحدث تغلب)
    const wFirst = ref.phones[a].word, wLast = ref.phones[b - 1].word;
    const wordState = {};
    for (let w = wFirst; w <= wLast; w++) {
      const full = !(w === wFirst && ref.phones[a].g > 0 && a > 0 && ref.phones[a - 1].word === w)
                && !(w === wLast && b < L && ref.phones[b].word === w);
      wordState[w] = full ? 'ok' : 'part';
    }
    for (const f of flags) {
      const cur = wordState[f.word];
      if (f.level === 'confirmed') wordState[f.word] = 'bad';
      else if (cur !== 'bad') wordState[f.word] = 'maybe';
    }
    state.ptr = b;
    out.status = 'ok'; out.flags = flags; out.a = a; out.b = b; out.wordState = wordState; out.cost = loc.cost;
    return out;
  }

  return { buildPassage, locate, processSegment };
});
