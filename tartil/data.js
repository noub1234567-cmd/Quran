/*
 * data.js — بيانات السور، وقراءة نص تنزيل (sura|aya|text)، وحذف البسملة من أول الآية (corpus.py).
 */
(function (root, factory) {
  const api = factory(root.TartilPhonemizer || (typeof require === 'function' ? require('./phonemizer.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TartilData = api;
})(typeof self !== 'undefined' ? self : this, function (PH) {
  'use strict';
  const COUNTS = [7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6];
  const NAMES = 'الفاتحة،البقرة،آل عمران،النساء،المائدة،الأنعام،الأعراف،الأنفال،التوبة،يونس،هود،يوسف،الرعد،إبراهيم،الحجر،النحل،الإسراء،الكهف،مريم،طه،الأنبياء،الحج،المؤمنون،النور،الفرقان،الشعراء،النمل،القصص،العنكبوت،الروم،لقمان،السجدة،الأحزاب،سبأ،فاطر،يس،الصافات،ص،الزمر،غافر،فصلت،الشورى،الزخرف،الدخان،الجاثية،الأحقاف،محمد،الفتح،الحجرات،ق،الذاريات،الطور،النجم،القمر،الرحمن،الواقعة،الحديد،المجادلة،الحشر،الممتحنة،الصف،الجمعة،المنافقون،التغابن،الطلاق،التحريم،الملك،القلم،الحاقة،المعارج،نوح،الجن،المزمل،المدثر،القيامة،الإنسان،المرسلات،النبأ،النازعات،عبس،التكوير،الانفطار،المطففين،الانشقاق،البروج،الطارق،الأعلى،الغاشية،الفجر،البلد،الشمس،الليل،الضحى،الشرح،التين،العلق،القدر،البينة،الزلزلة،العاديات،القارعة،التكاثر،العصر،الهمزة،الفيل،قريش،الماعون،الكوثر،الكافرون،النصر،المسد،الإخلاص،الفلق،الناس'.split('،');
  const DROP = new Set(['ٔ', 'ٕ', 'ٱ', 'ا', 'ٰ', 'ـ']);
  const BASMALA = ['بسم', 'الله', 'الرحمن', 'الرحيم'];
  const letters = (w) => Array.from(w).filter((c) => !PH.MARKS.has(c) && !DROP.has(c)).join('');

  function stripBasmala(sura, aya, text) {
    if (aya !== 1 || sura === 1 || sura === 9) return text;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length > 4 && words.slice(0, 4).every((w, i) => letters(w) === letters(BASMALA[i]))) return words.slice(4).join(' ');
    return text;
  }

  /* نص تنزيل -> { "s:a": text } */
  function parseCorpus(raw) {
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('|'), j = line.indexOf('|', i + 1);
      const s = +line.slice(0, i), a = +line.slice(i + 1, j), t = line.slice(j + 1).trim();
      out[s + ':' + a] = stripBasmala(s, a, t);
    }
    return out;
  }
  return { COUNTS, NAMES, stripBasmala, parseCorpus };
});
