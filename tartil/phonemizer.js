/*
 * phonemizer.js — المُصوِّت المرجعي (حفص): نص عثماني -> فونيمات مع وسوم التجويد.
 * نقل حرفي لـ tartil/phonemizer.py + arabic.py + muqattaat.py. حتمي وقائم على القواعد.
 * UMD: window.TartilPhonemizer / require().   phonemize(text, {stop, start, cfg}) -> {phones, warnings, words}
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TartilPhonemizer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const C = {"MARKS": ["\u064b", "\u064c", "\u064d", "\u064e", "\u064f", "\u0650", "\u0651", "\u0652", "\u0653", "\u0670", "\u06d6", "\u06d7", "\u06d8", "\u06d9", "\u06da", "\u06db", "\u06dc", "\u06de", "\u06df", "\u06e0", "\u06e1", "\u06e2", "\u06e3", "\u06e4", "\u06e5", "\u06e6", "\u06e7", "\u06e8", "\u06e9", "\u06ea", "\u06eb", "\u06ec", "\u06ed"], "SHORT_VOWELS": {"\u064e": "a", "\u064f": "u", "\u0650": "i"}, "TANWEEN": {"\u064b": "a", "\u064c": "u", "\u064d": "i"}, "SUKUN": ["\u0652", "\u06e1"], "SILENT": ["\u06df", "\u06e0"], "PAUSE": ["\u06d6", "\u06d7", "\u06d8", "\u06d9", "\u06da", "\u06db", "\u06de", "\u06e9"], "CONSONANT": {"\u0621": "'", "\u0623": "'", "\u0625": "'", "\u0624": "'", "\u0626": "'", "\u0628": "b", "\u062a": "t", "\u062b": "th", "\u062c": "j", "\u062d": "H", "\u062e": "kh", "\u062f": "d", "\u0630": "dh", "\u0631": "r", "\u0632": "z", "\u0633": "s", "\u0634": "sh", "\u0635": "S", "\u0636": "D", "\u0637": "T", "\u0638": "Z", "\u0639": "3", "\u063a": "gh", "\u0641": "f", "\u0642": "q", "\u0643": "k", "\u0644": "l", "\u0645": "m", "\u0646": "n", "\u0647": "h", "\u0629": "t", "\u0648": "w", "\u064a": "y", "\u0649": "y", "\u06cc": "y"}, "QALQALA": ["\u0628", "\u062c", "\u062f", "\u0637", "\u0642"], "HEAVY": ["\u062e", "\u0635", "\u0636", "\u0637", "\u0638", "\u063a", "\u0642"], "NAMES": {"\u0627": "\u0623\u064e\u0644\u0650\u0641\u0652", "\u0644": "\u0644\u064e\u0627\u0653\u0645\u0652", "\u0645": "\u0645\u0650\u064a\u0645\u0652", "\u0631": "\u0631\u064e\u0627", "\u0635": "\u0635\u064e\u0627\u0653\u062f\u0652", "\u0643": "\u0643\u064e\u0627\u0653\u0641\u0652", "\u0647": "\u0647\u064e\u0627", "\u064a": "\u064a\u064e\u0627", "\u0639": "\u0639\u064e\u064a\u0652\u0646\u0652", "\u0637": "\u0637\u064e\u0627", "\u0633": "\u0633\u0650\u064a\u0646\u0652", "\u062d": "\u062d\u064e\u0627", "\u0642": "\u0642\u064e\u0627\u0653\u0641\u0652", "\u0646": "\u0646\u064f\u0648\u0646\u0652"}, "VOWELLING": ["\u064b", "\u064c", "\u064d", "\u064e", "\u064f", "\u0650", "\u0651", "\u0652", "\u0670", "\u06e1"], "IZHAR_HALQI": ["\u0621", "\u0623", "\u0624", "\u0625", "\u0626", "\u062d", "\u062e", "\u0639", "\u063a", "\u0647"], "IKHFA": ["\u062a", "\u062b", "\u062c", "\u062f", "\u0630", "\u0632", "\u0633", "\u0634", "\u0635", "\u0636", "\u0637", "\u0638", "\u0641", "\u0642", "\u0643"], "HAMZA_LIKE": ["\u0621", "\u0622", "\u0623", "\u0624", "\u0625", "\u0626"], "YA_SEATS": ["\u0649", "\u064a", "\u06cc"], "NEUTRAL": ["\u06d6", "\u06d7", "\u06d8", "\u06d9", "\u06da", "\u06db", "\u06dc", "\u06de", "\u06e9"], "HIGH_SEEN": "\u06dc", "FATHA": "\u064e", "FATHATAN": "\u064b", "SHADDA": "\u0651", "MADDAH": "\u0653", "DAGGER": "\u0670", "SMALL_WAW": "\u06e5", "SMALL_YA": "\u06e6", "IQLAB": "\u06e2", "ALEF_WASLA": "\u0671", "TATWEEL": "\u0640", "HAMZA_ABOVE": "\u0654", "HAMZA_BELOW": "\u0655", "SEAT_ABOVE": {"\u0627": "\u0623", "\u0648": "\u0624", "\u064a": "\u0626", "\u0649": "\u0626", "\u06cc": "\u0626"}, "SEAT_BELOW": {"\u0627": "\u0625"}};
  const S = (a) => new Set(a);
  const MARKS = S(C.MARKS), SUKUN = S(C.SUKUN), SILENT = S(C.SILENT), PAUSE = S(C.PAUSE);
  const QALQALA = S(C.QALQALA), HEAVY = S(C.HEAVY), IZHAR_HALQI = S(C.IZHAR_HALQI), IKHFA = S(C.IKHFA);
  const HAMZA_LIKE = S(C.HAMZA_LIKE), YA_SEATS = S(C.YA_SEATS), NEUTRAL = S(C.NEUTRAL), VOWELLING = S(C.VOWELLING);
  const SHORT = C.SHORT_VOWELS, TANWEEN = C.TANWEEN, CONSONANT = C.CONSONANT, NAMES = C.NAMES;
  const { FATHATAN, SHADDA, MADDAH, DAGGER, SMALL_WAW, SMALL_YA, IQLAB, ALEF_WASLA, TATWEEL, HAMZA_ABOVE, HAMZA_BELOW, FATHA } = C;
  const NOON = 'ن', MEEM = 'م', LAM = 'ل', RA = 'ر', WAW = 'و', YA = 'ي', ALEF = 'ا';
  const HA = 'ه', TA_MARBUTA = 'ة', BA = 'ب', ALEF_MAKSURA = 'ى', FARSI_YA = 'ی', ALEF_MADDA = 'آ';
  const IMALA = '۪';
  const RUN = new Set([...MARKS, HAMZA_ABOVE, HAMZA_BELOW]);

  const DEFAULT_CFG = { asli: 2, muttasil: 4, munfasil: 4, lazim: 6, arid: 4, leen: 4, silah: 2, silah_before_hamza: 4 };

  // ---------------- graphemes (arabic.py)
  class Grapheme {
    constructor(base, marks, idx) { this.base = base; this.marks = marks || []; this.idx = idx || 0; this.isolated = false; }
    has(...ms) { return ms.some((m) => this.marks.includes(m)); }
    get shadda() { return this.marks.includes(SHADDA); }
    get vowel() { for (const m of this.marks) if (m in SHORT) return SHORT[m]; return null; }
    get tanween() { for (const m of this.marks) if (m in TANWEEN) return TANWEEN[m]; return null; }
    get sukun() { return this.marks.some((m) => SUKUN.has(m)); }
    get silent() { return this.marks.some((m) => SILENT.has(m)); }
  }

  function parseWord(word) {
    const out = [];
    const w = Array.from(word);
    let i = 0; const n = w.length;
    while (i < n) {
      const ch = w[i]; i++;
      if (ch === TATWEEL) {
        let j = i;
        while (j < n && RUN.has(w[j])) j++;
        const run = w.slice(i, j);
        if (run.includes(HAMZA_ABOVE) || run.includes(HAMZA_BELOW)) {
          const g = new Grapheme('ء', [], out.length);
          g.marks = run.filter((m) => m !== HAMZA_ABOVE && m !== HAMZA_BELOW);
          out.push(g); i = j;
        }
        continue;
      }
      if (ch === HAMZA_ABOVE || ch === HAMZA_BELOW) {
        if (out.length) {
          const table = ch === HAMZA_ABOVE ? C.SEAT_ABOVE : C.SEAT_BELOW;
          const last = out[out.length - 1];
          if (last.base in table) last.base = table[last.base];
        }
        continue;
      }
      if (ch === ALEF_MADDA) {
        if (out.length) out.push(new Grapheme(ALEF, [MADDAH], out.length));
        else { out.push(new Grapheme('ء', [FATHA], 0)); out.push(new Grapheme(ALEF, [MADDAH], 1)); }
        continue;
      }
      if (MARKS.has(ch)) { if (out.length) out[out.length - 1].marks.push(ch); continue; }
      if (/\s/.test(ch)) continue;
      out.push(new Grapheme(ch, [], out.length));
    }
    return out;
  }

  function splitWords(text) {
    return text.split(/\s+/).filter((w) => w && Array.from(w).some((c) => !MARKS.has(c)));
  }

  function expandMuqattaat(gs) {
    if (!(gs.length >= 1 && gs.length <= 5)) return null;
    for (const g of gs) {
      if (!(g.base in NAMES) || g.marks.some((m) => VOWELLING.has(m))) return null;
    }
    return gs.map((g) => NAMES[g.base]);
  }

  const clean = (G) => G.marks.every((m) => NEUTRAL.has(m));

  // ---------------- engine (phonemizer.py)
  class Run {
    constructor(cfg, words, stop, start) {
      this.cfg = cfg; this.stop = stop; this.start = start;
      this.toks = [];
      words.forEach((w, wi) => w.forEach((g, gi) => this.toks.push({ w: wi, g: gi, G: g, wlen: w.length })));
      this.n = this.toks.length;
      this.out = []; this.warn = [];
      this.prev_short = null;
      this.force = new Map();
      this.skip = new Array(this.n).fill(false);
      this.tan_alef = new Array(this.n).fill(false);
      this.prepass();
    }
    prepass() {
      const T = this.toks;
      T.forEach((t, k) => {
        const G = t.G, b = G.base;
        if (G.silent) this.skip[k] = true;
        else if (b === ALEF_WASLA && !(this.start && t.w === 0 && t.g === 0)) this.skip[k] = true;
        else if (b === LAM && t.g > 0 && T[k - 1].G.base === ALEF_WASLA && clean(G) && k + 1 < this.n && T[k + 1].G.shadda) this.skip[k] = true;
        else if ((b === ALEF || b === ALEF_MAKSURA || b === FARSI_YA) && clean(G) && t.g > 0 && T[k - 1].G.has(FATHATAN)) {
          this.skip[k] = true; this.tan_alef[k] = true;
        }
      });
      let last = -1;
      for (let k = 0; k < this.n; k++) if (!this.skip[k]) last = k;
      this.last_k = last;
    }
    effNext(k) { for (let j = k + 1; j < this.n; j++) if (!this.skip[j]) return j; return null; }
    waslElided(k) {
      const nxt = this.effNext(k);
      if (nxt === null || (this.stop && k === this.last_k)) return false;
      const nt = this.toks[nxt];
      if (nt.w === this.toks[k].w) return false;
      const first = nxt - nt.g;
      return this.skip[first] && this.toks[first].G.base === ALEF_WASLA;
    }
    atStop(k) { return this.stop && k === this.last_k; }
    emit(sym, k, dur = 1, tags = []) {
      const t = this.toks[k];
      this.out.push({ sym, word: t.w, g: t.g, dur, tags: Array.from(tags) });
    }
    vowel(v, k, tags = []) { this.emit(v, k, 1, tags); this.prev_short = v; }
    lengthenPrev(k, info) {
      const [counts, tags] = info;
      const p = this.out[this.out.length - 1];
      if (p && (p.sym === 'a' || p.sym === 'u' || p.sym === 'i')) {
        p.sym = p.tags.includes('imala') ? 'ee' : p.sym + p.sym;
        p.dur = counts; p.tags = p.tags.concat(tags);
      } else this.warn.push(`madd without preceding vowel at w${this.toks[k].w}g${this.toks[k].g}`);
    }
    maddInfo(k) {
      const t = this.toks[k], c = this.cfg;
      const nxt = this.effNext(k);
      if (nxt === null || (this.stop && k === this.last_k)) return [c.asli, ['madd_asli']];
      const nt = this.toks[nxt];
      const same = nt.w === t.w;
      if (HAMZA_LIKE.has(nt.G.base)) return same ? [c.muttasil, ['madd_muttasil']] : [c.munfasil, ['madd_munfasil']];
      if (same && (nt.G.shadda || nt.G.sukun || this.force.has(nxt))) return [c.lazim, ['madd_lazim']];
      const stoppedVowelled = nt.G.tanween === 'a' && nt.G.base !== TA_MARBUTA;
      if (this.stop && nxt === this.last_k && same && !stoppedVowelled) return [c.arid, ['madd_arid_lilsukun']];
      return [c.asli, ['madd_asli']];
    }
    run() {
      for (let k = 0; k < this.n; k++) if (!this.skip[k]) this.token(k);
      return { phones: this.out, warnings: this.warn, words: [] };
    }
    token(k) {
      const t = this.toks[k], G = t.G, b = G.base;
      if (b === ALEF_WASLA) return this.startWasl(k);
      if (b === ALEF_MADDA) { this.emit("'", k); this.vowel('a', k); return this.lengthenPrev(k, this.maddInfo(k)); }
      if (this.force.has(k) && (b === WAW || YA_SEATS.has(b))) return this.consonant(k);
      if (b === ALEF) {
        if (this.prev_short === 'a') {
          if (this.waslElided(k)) return;
          return this.lengthenPrev(k, this.maddInfo(k));
        }
        this.warn.push(`stray alef at w${t.w}g${t.g}`);
        return;
      }
      if (b === WAW) return this.weak(k, 'u', 'w');
      if (YA_SEATS.has(b)) return this.weak(k, 'i', 'y');
      if (b in CONSONANT) return this.consonant(k);
      this.warn.push(`unknown char U+${b.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} at w${t.w}g${t.g}`);
    }
    startWasl(k) {
      const T = this.toks, t = T[k];
      const n1 = k + 1 < this.n && T[k + 1].w === t.w ? T[k + 1] : null;
      const n2 = k + 2 < this.n && T[k + 2].w === t.w ? T[k + 2] : null;
      let v;
      if (n1 && n1.G.base === LAM) v = 'a';
      else v = n2 && n2.G.vowel === 'u' ? 'u' : 'i';
      this.emit("'", k, 1, ['hamzat_wasl']);
      this.vowel(v, k);
    }
    weak(k, maddVowel, cons) {
      const t = this.toks[k], G = t.G, b = G.base;
      const dagger = G.has(DAGGER);
      const plain = !(G.vowel || G.tanween || G.shadda || G.sukun);
      if ((b === ALEF_MAKSURA || b === FARSI_YA) && plain) {
        if (dagger || this.prev_short === 'a' || this.prev_short === 'i') {
          if (this.waslElided(k)) return;
          return this.lengthenPrev(k, this.maddInfo(k));
        }
      }
      if (dagger && this.prev_short === 'a' && plain) return this.lengthenPrev(k, this.maddInfo(k));
      if (G.vowel || G.tanween || G.shadda || dagger) return this.consonant(k);
      if (this.prev_short === maddVowel) {
        if (this.waslElided(k)) return;
        return this.lengthenPrev(k, this.maddInfo(k));
      }
      const nx0 = this.effNext(k);
      if (clean(G) && this.prev_short === 'a' && nx0 !== null && this.toks[nx0].w === t.w
          && this.toks[nx0].G.shadda && this.toks[nx0].G.base === b) {
        this.force.set(nx0, 'idgham_mithlayn');
        return;
      }
      if (this.prev_short === 'a' && (G.sukun || clean(G))) {
        const tags = ['leen']; let dur = 1;
        if (!G.sukun) tags.push('implicit_sukun');
        const nx = this.effNext(k);
        const nsak = nx !== null && this.toks[nx].w === t.w && (this.toks[nx].G.sukun || this.toks[nx].G.shadda);
        const nt = nx !== null ? this.toks[nx] : null;
        const vowelledStop = !!(nt && nt.G.tanween === 'a' && nt.G.base !== TA_MARBUTA);
        if (this.atStop(k) || (nx === this.last_k && this.stop && !vowelledStop) || nsak) { tags.push('madd_leen'); dur = this.cfg.leen; }
        this.emit(cons, k, dur, tags);
        return;
      }
      this.warn.push(`unmarked ${cons} at w${t.w}g${t.g}`);
      this.emit(cons, k, 1, ['unmarked']);
    }
    consonant(k) {
      const t = this.toks[k], G = t.G, b = G.base;
      let v = G.vowel; const tan = G.tanween;
      const dagger = G.has(DAGGER);
      if (dagger && !v && !tan) v = 'a';
      const imala = G.has(IMALA);
      if (imala && !v && !tan) v = 'a';
      const stopHere = this.atStop(k);
      const ftag = this.force.has(k) ? this.force.get(k) : null;
      const gem = G.shadda || ftag !== null;
      const sakin = !v && !tan;
      const nxt = this.effNext(k);

      if (sakin && !gem) {
        if (b === NOON) return this.noon(k, false);
        if (b === MEEM) return this.meem(k);
        if (clean(G) && nxt !== null && this.toks[nxt].G.shadda && b !== WAW && b !== YA) {
          const same = this.toks[nxt].G.base === b;
          this.force.set(nxt, same ? 'idgham_mithlayn' : 'idgham_mutaqaribayn');
          return;
        }
      }
      let sym = CONSONANT[b];
      const tags = [];
      if (b === TA_MARBUTA && stopHere) sym = 'h';
      else if (b === RA) {
        sym = (this.raHeavy(k, v, tan, stopHere) && !imala) ? 'R' : 'r';
        tags.push(sym === 'R' ? 'tafkhim' : 'tarqiq');
      } else if (b === LAM && G.shadda && this.isJalala(k)) {
        const heavy = this.prev_short === 'a' || this.prev_short === 'u';
        sym = heavy ? 'L' : 'l';
        tags.push('lafz_jalala_' + (heavy ? 'tafkhim' : 'tarqiq'));
      }
      if (ftag) tags.push(ftag);
      if (gem) sym += ':';
      const dur = gem ? 2 : 1;
      if (ftag === 'idgham_ghunna' || ftag === 'idgham_shafawi') tags.push('ghunna');
      if (QALQALA.has(b) && ((sakin && !gem) || (stopHere && !dagger)) && !(stopHere && tan === 'a')) tags.push('qalqala');
      this.emit(sym, k, dur, tags);

      if (tan) {
        if (stopHere) {
          if (tan === 'a' && b !== TA_MARBUTA) {
            this.emit('aa', k, this.cfg.asli, ['tanween_waqf', 'madd_asli']);
            this.prev_short = 'a';
          }
          const last = this.out[this.out.length - 1]; last.tags = last.tags.concat(['waqf']);
          return;
        }
        this.vowel(tan, k, ['tanween']);
        return this.noon(k, true);
      }
      if (v) {
        if (stopHere && !dagger) {
          const last = this.out[this.out.length - 1]; last.tags = last.tags.concat(['waqf']);
        } else {
          this.vowel(v, k);
          if (imala) { const last = this.out[this.out.length - 1]; last.tags = last.tags.concat(['imala']); }
        }
        if (dagger) this.lengthenPrev(k, this.maddInfo(k));
        if (b === HA && (G.has(SMALL_WAW) || G.has(SMALL_YA)) && !stopHere) {
          const nt = nxt !== null ? this.toks[nxt] : null;
          if (nt && HAMZA_LIKE.has(nt.G.base) && nt.w !== t.w) this.lengthenPrev(k, [this.cfg.silah_before_hamza, ['madd_silah_kubra']]);
          else this.lengthenPrev(k, [this.cfg.silah, ['madd_silah_sughra']]);
        }
      }
    }
    noon(k, tanween) {
      const t = this.toks[k], G = t.G;
      if (tanween && this.atStop(k)) return;
      const nxt = this.effNext(k);
      if (nxt === null || G.isolated) return this.emit('n', k, 1, ['izhar']);
      const nt = this.toks[nxt], L = nt.G.base, same = nt.w === t.w;
      if (nt.g > 0 && this.toks[nxt - 1].G.base === ALEF_WASLA && this.toks[nxt - 1].w === nt.w && !same) {
        this.emit('n', k, 1, ['izhar', 'iltiqa']);
        return this.vowel('i', k, ['iltiqa']);
      }
      if (IZHAR_HALQI.has(L)) return this.emit('n', k, 1, ['izhar_halqi']);
      if (L === WAW || L === YA) {
        if (same) return this.emit('n', k, 1, ['izhar_mutlaq']);
        this.force.set(nxt, 'idgham_ghunna'); return;
      }
      if (L === NOON || L === MEEM) { this.force.set(nxt, 'idgham_ghunna'); return; }
      if (L === LAM || L === RA) { this.force.set(nxt, 'idgham_bila_ghunna'); return; }
      if (L === BA || G.has(IQLAB)) return this.emit('m', k, 2, ['iqlab', 'ghunna']);
      if (IKHFA.has(L)) {
        const tg = ['ikhfa', 'ghunna'].concat(HEAVY.has(L) ? ['ikhfa_mufakhkham'] : []);
        return this.emit('N', k, 2, tg);
      }
      this.warn.push(`noon before unexpected U+${L.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
      this.emit('n', k, 1, ['izhar']);
    }
    meem(k) {
      const nxt = this.effNext(k);
      if (nxt === null || this.toks[k].G.isolated) return this.emit('m', k, 1, ['izhar_shafawi']);
      const L = this.toks[nxt].G.base;
      if (L === MEEM) { this.force.set(nxt, 'idgham_shafawi'); return; }
      if (L === BA) return this.emit('m', k, 2, ['ikhfa_shafawi', 'ghunna']);
      this.emit('m', k, 1, ['izhar_shafawi']);
    }
    raHeavy(k, v, tan, stopHere) {
      if (v === 'a' || v === 'u' || tan === 'a' || tan === 'u') return true;
      if (v === 'i' || tan === 'i') return false;
      const T = this.toks, t = T[k];
      const prev = k > 0 && T[k - 1].w === t.w ? T[k - 1] : null;
      if (stopHere && prev && YA_SEATS.has(prev.G.base) && prev.G.sukun) return false;
      if (this.prev_short === 'i') {
        const nt = k + 1 < this.n && T[k + 1].w === t.w ? T[k + 1] : null;
        return !!(nt && HEAVY.has(nt.G.base) && ['a', 'u', 'i'].includes(nt.G.vowel));
      }
      return true;
    }
    isJalala(k) {
      const T = this.toks, t = T[k];
      const n1 = k + 1 < this.n && T[k + 1].w === t.w ? T[k + 1] : null;
      if (!n1 || n1.G.base !== HA) return false;
      if (t.g === 0 || T[k - 1].G.base !== LAM) return false;
      const rest = t.wlen - (t.g + 2);
      if (rest === 0) return true;
      return rest === 1 && T[k + 2].G.base === MEEM;
    }
  }

  function phonemize(text, opts) {
    opts = opts || {};
    const stop = opts.stop !== false, start = opts.start !== false;
    const cfg = Object.assign({}, DEFAULT_CFG, opts.cfg || {});
    const words = [];
    for (const raw of splitWords(text)) {
      const g = parseWord(raw);
      if (!g.length) continue;
      const names = expandMuqattaat(g);
      if (names) {
        for (const nm of names) { const ng = parseWord(nm); ng[ng.length - 1].isolated = true; words.push(ng); }
      } else words.push(g);
    }
    const res = new Run(cfg, words, stop, start).run();
    res.words = words.map((w) => w.map((x) => x.base + x.marks.join('')).join(''));
    return res;
  }

  const symbols = (res) => res.phones.map((p) => p.sym);
  return { phonemize, symbols, parseWord, splitWords, DEFAULT_CFG, MARKS };
});
