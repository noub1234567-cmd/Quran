/*
 * tracker.js — follows a reciter through a passage, segment by segment, and judges each segment.
 * Pure logic (no DOM, no model): works in the browser (window.TartilTracker) and in Node.
 *
 *   const pass = TartilTracker.buildPassage(refData, sura, from, to);
 *   const tr = TartilTracker.create(pass, refData.vocab);
 *   const r = tr.process(logp, T, V);   // -> {status:'ok'|'lost'|'unreliable'|'short', start, end, flags}
 *   tr.wordStates()                     // per word: 'pending' | 'partial' | 'ok' | 'possible' | 'error'
 */
(function (root, factory) {
  const api = factory(root.TartilDetect || (typeof require === 'function' ? require('./detect.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TartilTracker = api;
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  /** Concatenates the reference phones of verses from..to (as the tested Python pipeline does). */
  function buildPassage(refData, sura, from, to) {
    const syms = [], word = [], tags = [], words = [], wordVerse = [], verseStart = [];
    for (let a = from; a <= to; a++) {
      const v = refData.verses[sura + ':' + a];
      if (!v) continue;
      const off = words.length, ps = v.p.split(' ');
      verseStart.push({ aya: a, phone: syms.length, word: off });
      for (let k = 0; k < ps.length; k++) { syms.push(ps[k]); word.push(v.i[k] + off); tags.push(v.t[String(k)] || []); }
      v.w.forEach((w) => { words.push(w); wordVerse.push(a); });
    }
    const wordRange = words.map(() => [Infinity, -1]);
    word.forEach((w, j) => { if (j < wordRange[w][0]) wordRange[w][0] = j; if (j > wordRange[w][1]) wordRange[w][1] = j; });
    return { sura, from, to, syms, word, tags, words, wordVerse, wordRange, verseStart };
  }

  /** Approximate substring search: where in ref[lo,hi) does hyp fit best? (free start and end in ref) */
  function locate(refSyms, lo, hi, hyp) {
    const m = hyp.length, n = hi - lo;
    if (!m || !n) return null;
    const D = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = 1; i <= m; i++) D[i][0] = i;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      const c = hyp[i - 1] === refSyms[lo + j - 1] ? 0 : 1;
      D[i][j] = Math.min(D[i - 1][j - 1] + c, D[i - 1][j] + 1, D[i][j - 1] + 1);
    }
    let bj = 0, bv = Infinity;
    for (let j = 1; j <= n; j++) if (D[m][j] < bv) { bv = D[m][j]; bj = j; }
    let i = m, j = bj;
    while (i > 0 && j > 0) {
      const c = hyp[i - 1] === refSyms[lo + j - 1] ? 0 : 1;
      if (D[i][j] === D[i - 1][j - 1] + c) { i--; j--; }
      else if (D[i][j] === D[i - 1][j] + 1) i--;
      else j--;
    }
    return { start: lo + j, end: lo + bj, cost: bv, rate: bv / m };
  }

  function create(pass, vocab, opts) {
    const o = Object.assign({ maxLocateRate: 0.55, back: 4, minHyp: 4, params: null }, opts || {});
    const inv = {}; for (const s in vocab) inv[vocab[s]] = s;
    const n = pass.syms.length;
    const covered = new Uint8Array(n), sev = new Uint8Array(n);   // sev: 0 ok, 1 possible, 2 confirmed
    const flagAt = new Map();
    let cursor = 0, lost = 0;

    function process(logp, T, V) {
      const hypIds = D.greedyIds(logp, T, V), hyp = hypIds.map((i) => inv[i]);
      if (hyp.length < o.minHyp) return { status: 'short', flags: [] };
      let m = null;
      if (!lost) m = locate(pass.syms, Math.max(0, cursor - o.back), Math.min(n, cursor + hyp.length * 2 + 30), hyp);
      if (!m || m.rate > o.maxLocateRate) m = locate(pass.syms, 0, n, hyp);   // lost: search the whole passage
      if (!m || m.rate > o.maxLocateRate || m.end - m.start < 3) { lost = 1; return { status: 'lost', flags: [] }; }
      lost = 0;
      const { start, end } = m, len = end - start;
      const ref = { syms: pass.syms.slice(start, end), word: pass.word.slice(start, end), tags: pass.tags.slice(start, end), words: pass.words };
      let res;
      try { res = D.analyze(logp, T, V, ref, vocab, o.params); }
      catch (e) { return { status: e.unreliable ? 'unreliable' : 'short', flags: [], start, end }; }
      const flags = [];
      for (const f of res.flags) {
        const g = start + f.idx;
        const edge = (f.idx === 0 && start > 0) || (f.idx === len - 1 && end < n);
        const level = (edge && f.level === 'confirmed') ? 'possible' : f.level;
        const s = level === 'confirmed' ? 2 : 1;
        const nf = Object.assign({}, f, { idx: g, level, tier: level === 'confirmed' ? f.tier : 'B' });
        flags.push(nf);
        const old = flagAt.get(g);
        if (!old || s > sev[g]) { flagAt.set(g, nf); sev[g] = s; }
      }
      for (let j = start; j < end; j++) covered[j] = 1;
      cursor = Math.max(cursor, end);
      return { status: 'ok', start, end, flags, per: res.per };
    }

    function wordStates() {
      return pass.wordRange.map(([a, b]) => {
        let c = 0, sv = 0;
        for (let j = a; j <= b; j++) { c += covered[j]; if (sev[j] > sv) sv = sev[j]; }
        if (!c) return 'pending';
        if (c < b - a + 1) return 'partial';
        return sv === 2 ? 'error' : sv === 1 ? 'possible' : 'ok';
      });
    }
    return {
      process, wordStates, pass,
      get cursor() { return cursor; },
      get done() { return cursor >= n - 2; },
      allFlags() { return Array.from(flagAt.values()).sort((a, b) => a.idx - b.idx); },
      reset() { covered.fill(0); sev.fill(0); flagAt.clear(); cursor = 0; lost = 0; },
    };
  }

  return { buildPassage, locate, create };
});
