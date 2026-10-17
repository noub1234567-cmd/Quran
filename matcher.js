/*
 * matcher.js — مطابقة نص التلاوة (ناتج النموذج) مع نص الآية.
 * مستقلة تماماً: تعمل في المتصفح (window.QuranMatcher) وفي Node (require).
 * لا تعتمد على index.html ولا على النموذج.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuranMatcher = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // تشكيل + علامات المصحف + تطويل + رموز اتجاه
  const MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200C-\u200F]/g;

  // تطبيع متساهل: يوحّد الصور الإملائية التي يختلف فيها الرسم العثماني عن الإملائي
  function normalize(t) {
    return String(t == null ? '' : t)
      .replace(MARKS, '')
      .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627') // آ أ إ ٱ -> ا
      .replace(/\u0649/g, '\u064A')                      // ى -> ي
      .replace(/\u0629/g, '\u0647')                      // ة -> ه
      .replace(/\u0624/g, '\u0648')                      // ؤ -> و
      .replace(/\u0626/g, '\u064A')                      // ئ -> ي
      .replace(/\u0621/g, '')                            // ء
      .replace(/[^\u0621-\u064A\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const words = (t) => { const n = normalize(t); return n ? n.split(' ') : []; };

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }

  // تشابه كلمتين من 0 إلى 1
  function sim(a, b) {
    const L = Math.max(a.length, b.length);
    return L ? 1 - levenshtein(a, b) / L : 1;
  }

  const OK = 0.8, CLOSE = 0.5, GAP = 0.7;

  /*
   * يحاذي كلمات المرجع (الآية) مع كلمات النموذج.
   * يرجع: score (0..1)، words (حالة كل كلمة من الآية)، extra (كلمات زائدة نطقها القارئ)
   * الحالات: ok | close | wrong | missing
   */
  function compare(refText, hypText) {
    const R = words(refText), H = words(hypText);
    const n = R.length, m = H.length;
    const S = Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => sim(R[i], H[j])));
    const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) D[i][0] = i * GAP;
    for (let j = 1; j <= m; j++) D[0][j] = j * GAP;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        D[i][j] = Math.min(
          D[i - 1][j - 1] + (1 - S[i - 1][j - 1]),
          D[i - 1][j] + GAP,
          D[i][j - 1] + GAP
        );
      }
    }
    const out = new Array(n), extra = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && Math.abs(D[i][j] - (D[i - 1][j - 1] + (1 - S[i - 1][j - 1]))) < 1e-9) {
        const s = S[i - 1][j - 1];
        out[i - 1] = { ref: R[i - 1], hyp: H[j - 1], sim: s, status: s >= OK ? 'ok' : s >= CLOSE ? 'close' : 'wrong' };
        i--; j--;
      } else if (i > 0 && Math.abs(D[i][j] - (D[i - 1][j] + GAP)) < 1e-9) {
        out[i - 1] = { ref: R[i - 1], hyp: null, sim: 0, status: 'missing' };
        i--;
      } else {
        extra.unshift(H[j - 1]);
        j--;
      }
    }
    let got = 0;
    out.forEach((w) => { if (w.sim >= CLOSE) got += w.sim; });
    const score = n ? got / (n + extra.length * 0.5) : 0;
    return { score, words: out, extra, refCount: n, hypCount: m };
  }

  /*
   * يحدد أي آيات من السورة تُقرأ: يجرب كل بداية وأطوالاً من 1 إلى maxSpan آية.
   * ayahs: مصفوفة نصوص آيات السورة (فهرس 0 = آية 1).
   * يرجع أفضل نتيجة + أفضل 3 بدائل.
   */
  function locate(hypText, ayahs, opts) {
    const maxSpan = (opts && opts.maxSpan) || 3;
    const from = (opts && opts.from) || 1, to = (opts && opts.to) || ayahs.length;
    const res = [];
    for (let a = from; a <= to; a++) {
      let joined = '';
      for (let k = 0; k < maxSpan && a + k <= to; k++) {
        joined += (k ? ' ' : '') + ayahs[a + k - 1];
        const c = compare(joined, hypText);
        res.push({ from: a, to: a + k, score: c.score });
      }
    }
    res.sort((x, y) => y.score - x.score || (x.to - x.from) - (y.to - y.from));
    return { best: res[0] || null, top: res.slice(0, 3) };
  }

  /*
   * يقسّم نص الآية الأصلي (عثماني) إلى كلمات مع إبقاء الشكل الأصلي للعرض.
   * الرموز التي لا تحتوي حروفاً (علامات الوقف المنفصلة) تُتخطى.
   */
  function refTokens(text) {
    const out = [];
    String(text == null ? '' : text).split(/\s+/).forEach((tok) => {
      const n = normalize(tok);
      if (!n) return;
      n.split(' ').forEach((w, i) => out.push({ n: w, orig: i === 0 ? tok : '' }));
    });
    return out;
  }

  // مثل compare لكن كل كلمة تحمل orig = شكلها الأصلي في نص الآية (للعرض)
  function compareDisplay(refText, hypText) {
    const toks = refTokens(refText);
    const c = compare(toks.map((t) => t.n).join(' '), hypText);
    c.words.forEach((w, i) => { w.orig = toks[i] ? toks[i].orig : w.ref; });
    return c;
  }

  return { normalize, words, levenshtein, sim, compare, compareDisplay, refTokens, locate };
});
