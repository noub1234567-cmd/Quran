/*
 * detect.js — port of tartil/detect.py (forced alignment + per-phone verdicts).
 * Works in the browser (window.TartilDetect) and Node (require).
 *
 * logp: Float32Array flat [T*V], V = vocab size + 1, blank = 0.
 * ref:  { syms:[...], word:[...], tags:[[...],...], words:[...] }
 * vocab: { symbol: id }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TartilDetect = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BLANK = 0;
  const f32 = Math.fround;
  const NEG = f32(-1e30);

  const SOFT_TAGS = new Set(['iltiqa', 'idgham_mutaqaribayn', 'madd_silah_kubra', 'madd_silah_sughra',
    'waqf', 'tanween_waqf', 'hamzat_wasl', 'lafz_jalala_tarqiq']);
  const DEFAULTS = { refLow: 0.02, compHigh: 0.80, delLow: 0.003, minConfMargin: 0.30, frameSec: 0.02, maxPer: 0.45 };
  const DUR_PAIRS = new Set(['aa|a', 'a|aa', 'uu|u', 'u|uu', 'ii|i', 'i|ii']);

  function durationPair(refSym, heard) {
    if (heard == null) return false;
    if (refSym.endsWith(':') && heard === refSym.slice(0, -1)) return true;
    if (heard.endsWith(':') && refSym === heard.slice(0, -1)) return true;
    return DUR_PAIRS.has(refSym + '|' + heard);
  }

  /** Viterbi forced alignment. Returns [[first,last],...] per label. Throws if audio too short. */
  function ctcAlign(logp, T, V, ids) {
    const L = ids.length, S = 2 * L + 1;
    const ext = new Int32Array(S);
    for (let k = 0; k < L; k++) ext[2 * k + 1] = ids[k];
    const skipOk = new Uint8Array(S);
    for (let s = 2; s < S; s++) skipOk[s] = (ext[s] !== 0 && ext[s] !== ext[s - 2]) ? 1 : 0;
    const dp = new Float32Array(T * S).fill(NEG);
    const bp = new Int8Array(T * S);
    dp[0] = logp[0];
    if (S > 1) dp[1] = logp[ext[1]];
    for (let t = 1; t < T; t++) {
      const o = t * S, p = (t - 1) * S, lo = t * V;
      for (let s = 0; s < S; s++) {
        let best = dp[p + s], k = 0;                        // stay (first max wins, like numpy argmax)
        if (s >= 1) { const b = dp[p + s - 1]; if (b > best) { best = b; k = 1; } }
        if (s >= 2 && skipOk[s]) { const c = dp[p + s - 2]; if (c > best) { best = c; k = 2; } }
        dp[o + s] = f32(best + logp[lo + ext[s]]);
        bp[o + s] = k;
      }
    }
    let s = (S < 2 || dp[(T - 1) * S + S - 1] >= dp[(T - 1) * S + S - 2]) ? S - 1 : S - 2;
    if (dp[(T - 1) * S + s] <= NEG / 2) throw new Error('audio too short for this reference (fewer frames than phones)');
    const spans = Array.from({ length: L }, () => [null, null]);
    for (let t = T - 1; t >= 0; t--) {
      if (s % 2 === 1) {
        const j = (s - 1) >> 1;
        if (spans[j][1] === null) spans[j][1] = t;          // going backwards: first seen = last frame
        spans[j][0] = t;
      }
      s -= bp[t * S + s];
    }
    return spans;
  }

  function greedyIds(logp, T, V) {
    const out = []; let prev = -1;
    for (let t = 0; t < T; t++) {
      let best = 0, bv = -Infinity; const o = t * V;
      for (let v = 0; v < V; v++) { const x = logp[o + v]; if (x > bv) { bv = x; best = v; } }
      if (best !== prev && best !== BLANK) out.push(best);
      prev = best;
    }
    return out;
  }

  /** Levenshtein alignment, same tie-breaking as metrics.align. ops: [op, i, j] */
  function alignOps(ref, hyp) {
    const n = ref.length, m = hyp.length;
    const d = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = 0; i <= n; i++) d[i][0] = i;
    for (let j = 0; j <= m; j++) d[0][j] = j;
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
      const c = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j - 1] + c, d[i - 1][j] + 1, d[i][j - 1] + 1);
    }
    const ops = []; let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
        ops.push([ref[i - 1] === hyp[j - 1] ? 'ok' : 'sub', i - 1, j - 1]); i--; j--;
      } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { ops.push(['del', i - 1, null]); i--; }
      else { ops.push(['ins', null, j - 1]); j--; }
    }
    return ops.reverse();
  }

  /** Returns {flags, per, spans}. Throws {unreliable:true} when the audio does not match the reference. */
  function analyze(logp, T, V, ref, vocab, params, spansIn) {
    const p = Object.assign({}, DEFAULTS, params || {});
    const inv = {}; for (const s in vocab) inv[vocab[s]] = s;
    const ids = ref.syms.map((s) => vocab[s]);
    const L = ids.length;
    const spans = spansIn || ctcAlign(logp, T, V, ids);
    const hyp = greedyIds(logp, T, V).map((i) => inv[i]);
    const ops = alignOps(ref.syms, hyp);
    const mism = new Set(); let nerr = 0;
    for (const [op, i] of ops) { if ((op === 'sub' || op === 'del') && i !== null) mism.add(i); if (op !== 'ok') nerr++; }
    const per = L ? nerr / L : 0;
    if (L && per > p.maxPer) { const e = new Error('unreliable'); e.unreliable = true; e.per = per; throw e; }
    const P = new Float32Array(T * V); for (let k = 0; k < P.length; k++) P[k] = f32(Math.exp(logp[k]));
    const flags = [];
    for (let j = 0; j < L; j++) {
      const [s0, e0] = spans[j];
      let lo = j === 0 ? 0 : (spans[j - 1][1] + s0) >> 1;
      let hi = j === L - 1 ? T - 1 : (e0 + spans[j + 1][0]) >> 1;
      lo = Math.min(lo, s0); hi = Math.max(hi, e0);
      let refScore = 0; const other = new Float32Array(V);
      for (let t = lo; t <= hi; t++) {
        const o = t * V;
        if (P[o + ids[j]] > refScore) refScore = P[o + ids[j]];
        for (let v = 0; v < V; v++) if (P[o + v] > other[v]) other[v] = P[o + v];
      }
      other[BLANK] = 0; other[ids[j]] = 0;
      let comp = 0, compScore = other[0];
      for (let v = 1; v < V; v++) if (other[v] > compScore) { compScore = other[v]; comp = v; }
      let kind = null;
      if (refScore < p.refLow && compScore >= p.compHigh && compScore - refScore >= p.minConfMargin) kind = 'sub';
      else if (refScore < p.delLow) kind = 'del';
      if (!kind) continue;
      const tags = ref.tags[j] || [];
      let soft = tags.some((t) => SOFT_TAGS.has(t));
      const heard = kind === 'sub' ? inv[comp] : null;
      soft = soft || durationPair(ref.syms[j], heard);
      let level = (mism.has(j) && !soft) ? 'confirmed' : 'possible';
      if (kind === 'del' && level === 'confirmed' && refScore >= p.delLow / 2) level = 'possible';
      const w = ref.word[j];
      const short = ['a', 'i', 'u'];
      const tier = (level === 'confirmed' && kind === 'sub' && short.includes(ref.syms[j]) && short.includes(heard) && ref.syms[j] !== heard) ? 'A' : 'B';
      flags.push({ idx: j, word: w, wordText: (ref.words && ref.words[w]) || '', ref: ref.syms[j], heard, kind, level, tier, tags: Array.from(tags),
        refScore, heardScore: kind === 'sub' ? compScore : 0, timeSec: s0 * p.frameSec });
    }
    return { flags, per, spans };
  }

  return { BLANK, SOFT_TAGS, DEFAULTS, durationPair, ctcAlign, greedyIds, alignOps, analyze };
});
