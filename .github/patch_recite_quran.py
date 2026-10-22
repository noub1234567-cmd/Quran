#!/usr/bin/env python3
"""Adds qalqalah + lam-of-definiteness grading to a vendored recite_quran 1.0.5."""
import os
import sys

# ---- switches (true / false) -------------------------------------------------
QALQALAH = 'true'      # flag a missing qalqalah burst on a pronounced letter
LAM_SHAMSI = 'true'    # flag an extra lam pronounced before a sun letter
LAM_QAMARI = 'false'   # flag a swallowed lam before a moon letter (log-only when false)
# ------------------------------------------------------------------------------

root = sys.argv[1]
pkg = os.path.join(root, 'packages', 'recite_quran')


def read(rel):
    with open(os.path.join(pkg, rel), encoding='utf-8') as f:
        return f.read()


def write(rel, text):
    with open(os.path.join(pkg, rel), 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def replace_once(text, anchor, new, where):
    n = text.count(anchor)
    if n != 1:
        raise SystemExit('ERROR: anchor found %d times (expected 1) in %s: %r' % (n, where, anchor))
    return text.replace(anchor, new, 1)


RULES_ADD = r'''

// ═══ PATCH: PRESENCE-GRADED RULES (no acoustic duration) ═══

const AcousticThreshold _noDurationThreshold = AcousticThreshold(
  minSeconds: 0.0,
  targetSeconds: 0.0,
  maxSeconds: 1000.0,
);

class QalqalahRule extends TajweedRule {
  const QalqalahRule()
      : super(
          name: const LangName(ar: "القلقلة", en: "Qalqalah"),
          goldenLen: 0,
        );

  @override
  AcousticThreshold getThreshold(RecitationSpeed speed) => _noDurationThreshold;
}

class LamShamsiyyaRule extends TajweedRule {
  const LamShamsiyyaRule()
      : super(
          name: const LangName(ar: "اللام الشمسية", en: "Lam Shamsiyya"),
          goldenLen: 0,
        );

  @override
  AcousticThreshold getThreshold(RecitationSpeed speed) => _noDurationThreshold;
}

class LamQamariyyaRule extends TajweedRule {
  const LamQamariyyaRule()
      : super(
          name: const LangName(ar: "اللام القمرية", en: "Lam Qamariyya"),
          goldenLen: 0,
        );

  @override
  AcousticThreshold getThreshold(RecitationSpeed speed) => _noDurationThreshold;
}
'''

rules = read('lib/tracking/tajweed/tajweed_rules.dart')
if 'class QalqalahRule' in rules:
    raise SystemExit('ERROR: package already patched')
write('lib/tracking/tajweed/tajweed_rules.dart', rules.rstrip('\n') + '\n' + RULES_ADD)

LAM_HELPER = r'''/// [PATCH] Lam of definiteness: 0 = none, 1 = shamsiyya, 2 = qamariyya.
  static final RegExp _lamArticleRegex =
      RegExp('^[\u0648\u0641\u0628\u0643\u0644]?\u0671\u0644(.)');

  static int _lamKindOf(String word) {
    final StringBuffer sb = StringBuffer();
    for (final int r in word.runes) {
      if ((r >= 0x064B && r <= 0x065F) ||
          r == 0x0670 ||
          (r >= 0x06D6 && r <= 0x06ED) ||
          r == 0x0640) {
        continue;
      }
      sb.writeCharCode(r);
    }
    final RegExpMatch? m = _lamArticleRegex.firstMatch(sb.toString());
    if (m == null) return 0;
    final String next = m.group(1)!;
    if (next == '\u0644') return 0;
    const String sun =
        '\u062A\u062B\u062F\u0630\u0631\u0632\u0633\u0634\u0635\u0636\u0637\u0638\u0646';
    return sun.contains(next) ? 1 : 2;
  }

  '''

LAM_INJECT = r'''final String ph = (w < phonemeWords.length) ? phonemeWords[w] : '';

      // [PATCH] lam of definiteness classification from the plain Uthmani word
      if (w < textWords.length) {
        final int lamKind = _lamKindOf(textWords[w]);
        if (lamKind == 1) {
          wordRules[w].add(
            const WordTajweedRule(
              ruleId: 21,
              nameAr: 'اللام الشمسية',
              nameEn: 'Lam Shamsiyya',
              goldenLen: 0,
            ),
          );
        } else if (lamKind == 2) {
          wordRules[w].add(
            const WordTajweedRule(
              ruleId: 22,
              nameAr: 'اللام القمرية',
              nameEn: 'Lam Qamariyya',
              goldenLen: 0,
            ),
          );
        }
      }'''

qd = read('lib/data/quran_data.dart')
qd = replace_once(qd, 'static final RegExp _hizbSajdahRegex', LAM_HELPER + 'static final RegExp _hizbSajdahRegex', 'quran_data.dart')
qd = replace_once(qd, "final String ph = (w < phonemeWords.length) ? phonemeWords[w] : '';", LAM_INJECT, 'quran_data.dart')
write('lib/data/quran_data.dart', qd)

ee_path = 'lib/tracking/tajweed/error_explainer.dart'
ee = read(ee_path)

FLAGS = (
    "import 'tajweed_rules.dart';\n\n"
    "// [PATCH] switches for the extra Tajweed checks\n"
    "const bool kExtraQalqalahCheck = %s;\n"
    "const bool kExtraLamShamsiCheck = %s;\n"
    "const bool kExtraLamQamariCheck = %s;\n" % (QALQALAH, LAM_SHAMSI, LAM_QAMARI)
)
ee = replace_once(ee, "import 'tajweed_rules.dart';", FLAGS, ee_path)

MSG_AR = r'''String get messageAr {
    if (expectedRule is QalqalahRule) {
      return 'نقص في القلقلة: لم تُسمع نبرة القلقلة على حرف ($expectedPh)';
    }
    if (expectedRule is LamShamsiyyaRule) {
      return 'خطأ في اللام الشمسية: نُطقت اللام والصواب إدغامها في الحرف بعدها';
    }
    if (expectedRule is LamQamariyyaRule) {
      return 'خطأ في اللام القمرية: لم تُظهَر اللام والصواب إظهارها';
    }'''
MSG_EN = r'''String get messageEn {
    if (expectedRule is QalqalahRule) {
      return 'Missing Qalqalah burst on the letter ($expectedPh)';
    }
    if (expectedRule is LamShamsiyyaRule) {
      return 'Lam Shamsiyya: the lam was pronounced but should be assimilated';
    }
    if (expectedRule is LamQamariyyaRule) {
      return 'Lam Qamariyya: the lam was swallowed but should be pronounced clearly';
    }'''
ADV_AR = r'''String get adviceAr {
    if (expectedRule is QalqalahRule) {
      return 'لم تُسمع نبرة القلقلة على هذا الحرف الساكن؛ اخرجه بنبرة انفجارية خفيفة';
    }
    if (expectedRule is LamShamsiyyaRule) {
      return 'نطقتَ لام «ال» والصواب إدغامها في الحرف الشمسي بعدها وتشديده';
    }
    if (expectedRule is LamQamariyyaRule) {
      return 'أسقطتَ لام «ال» والصواب إظهارها بوضوح قبل الحرف القمري';
    }'''
ADV_EN = r'''String get adviceEn {
    if (expectedRule is QalqalahRule) {
      return 'Release the sakin letter with a light bouncing burst (Qalqalah).';
    }
    if (expectedRule is LamShamsiyyaRule) {
      return 'Do not pronounce the lam of al- before a sun letter; assimilate it and double the next letter.';
    }
    if (expectedRule is LamQamariyyaRule) {
      return 'Pronounce the lam of al- clearly before a moon letter.';
    }'''
ee = replace_once(ee, 'String get messageAr {', MSG_AR, ee_path)
ee = replace_once(ee, 'String get messageEn {', MSG_EN, ee_path)
ee = replace_once(ee, 'String get adviceAr {', ADV_AR, ee_path)
ee = replace_once(ee, 'String get adviceEn {', ADV_EN, ee_path)

RULE_FROM_MAP = r'''final num goldenLen = (map['goldenLen'] as num?) ?? 2;

    // [PATCH] resolve by Arabic name too (runtimeType names are minified on the web)
    if (nameAr == 'القلقلة' || type == 'QalqalahRule') {
      return const QalqalahRule();
    }
    if (nameAr == 'اللام الشمسية' || type == 'LamShamsiyyaRule') {
      return const LamShamsiyyaRule();
    }
    if (nameAr == 'اللام القمرية' || type == 'LamQamariyyaRule') {
      return const LamQamariyyaRule();
    }'''
ee = replace_once(ee, "final num goldenLen = (map['goldenLen'] as num?) ?? 2;", RULE_FROM_MAP, ee_path)

CALL_SITE = r'''// [PATCH] extra Tajweed checks: qalqalah + lam of definiteness
      if (kExtraQalqalahCheck) {
        wordErrors.removeWhere((e) => e.expectedPh == '\u0687');
        wordErrors.addAll(
          _checkQalqalah(
            wordText: wordText,
            wordRefStart: wordRefStart,
            alignments: alignments,
            currentAsrText: currentAsrText,
            targetCharCursor: targetCharCursor,
            bestAsrStartIdx: bestAsrStartIdx,
          ),
        );
      }
      wordErrors.addAll(
        _checkLam(
          expectedWordRules: expectedWordRules,
          wordText: wordText,
          wordRefStart: wordRefStart,
          alignments: alignments,
          currentAsrText: currentAsrText,
          targetCharCursor: targetCharCursor,
          bestAsrStartIdx: bestAsrStartIdx,
        ),
      );

      if (wordErrors.isNotEmpty) {'''
ee = replace_once(ee, 'if (wordErrors.isNotEmpty) {', CALL_SITE, ee_path)

HELPERS = r'''// [PATCH] EXTRA CHECKS: QALQALAH + LAM OF DEFINITENESS
  static const String _qalqalahMark = '\u0687';
  static const String _vowelMarks = '\u064E\u064F\u0650';
  static const String _sunLetters =
      '\u062A\u062B\u062F\u0630\u0631\u0632\u0633\u0634\u0635\u0636\u0637\u0638\u0646';

  static String? _predCharOf(
    PhonemeGroupAlignment a,
    String asr,
    int bestAsrStartIdx,
  ) {
    if (a.predIdx < 0) return null;
    final int p = bestAsrStartIdx + a.predIdx;
    if (p < 0 || p >= asr.length) return null;
    return asr[p];
  }

  static List<ReciterError> _checkQalqalah({
    required String wordText,
    required int wordRefStart,
    required List<PhonemeGroupAlignment> alignments,
    required String currentAsrText,
    required int targetCharCursor,
    required int bestAsrStartIdx,
  }) {
    final List<ReciterError> out = [];
    for (int i = 1; i < wordText.length; i++) {
      if (wordText[i] != _qalqalahMark) continue;
      final int absIdx = wordRefStart + i;
      final String base = wordText[i - 1];

      bool baseHeard = false;
      bool burstHeard = false;
      for (final a in alignments) {
        final int ref = targetCharCursor + a.refIdx;
        final String? pc = _predCharOf(a, currentAsrText, bestAsrStartIdx);
        if (ref == absIdx) {
          if (a.opType == 'match' && pc == _qalqalahMark) burstHeard = true;
        } else if (ref >= absIdx - 2 && ref < absIdx) {
          if (a.opType == 'match') baseHeard = true;
        }
        if (a.opType == 'insert' &&
            pc == _qalqalahMark &&
            ref >= absIdx - 1 &&
            ref <= absIdx + 3) {
          burstHeard = true;
        }
      }

      DebugLogger.log(
        'Qalqalah',
        '[QALQALAH] letter="$base" word="$wordText" baseHeard=$baseHeard burstHeard=$burstHeard',
      );

      if (baseHeard && !burstHeard) {
        out.add(
          ReciterError(
            errorType: ErrorCategory.tajweed,
            speechErrorType: SpeechErrorType.delete,
            expectedPh: base,
            predictedPh: '',
            expectedRule: const QalqalahRule(),
          ),
        );
      }
    }
    return out;
  }

  static List<ReciterError> _checkLam({
    required List<WordTajweedRule> expectedWordRules,
    required String wordText,
    required int wordRefStart,
    required List<PhonemeGroupAlignment> alignments,
    required String currentAsrText,
    required int targetCharCursor,
    required int bestAsrStartIdx,
  }) {
    final List<ReciterError> out = [];
    final bool isShams = expectedWordRules.any((r) => r.ruleId == 21);
    final bool isQamar = expectedWordRules.any((r) => r.ruleId == 22);
    if (!isShams && !isQamar) return out;

    int minPred = 1 << 30;
    for (final a in alignments) {
      final int ref = targetCharCursor + a.refIdx;
      if (a.predIdx >= 0 &&
          (a.opType == 'match' || a.opType == 'replace') &&
          ref >= wordRefStart) {
        minPred = min(minPred, bestAsrStartIdx + a.predIdx);
      }
    }

    if (isShams) {
      int dbl = -1;
      for (int i = 0; i + 1 < wordText.length && i < 4; i++) {
        if (wordText[i] == wordText[i + 1] &&
            wordText[i] != '\u0644' &&
            _sunLetters.contains(wordText[i])) {
          dbl = i;
          break;
        }
      }
      if (dbl >= 0) {
        bool lamHeard = false;
        final int winEnd = wordRefStart + dbl + 2;
        for (final a in alignments) {
          final int ref = targetCharCursor + a.refIdx;
          final String? pc = _predCharOf(a, currentAsrText, bestAsrStartIdx);
          if (a.opType == 'insert' &&
              pc == '\u0644' &&
              ref >= wordRefStart &&
              ref <= winEnd) {
            lamHeard = true;
          }
        }
        if (!lamHeard && dbl == 0 && minPred < (1 << 30)) {
          for (int k = 1; k <= 3; k++) {
            final int idx = minPred - k;
            if (idx < 0 || idx >= currentAsrText.length) break;
            final String c = currentAsrText[idx];
            if (_vowelMarks.contains(c)) continue;
            if (c == '\u0644') lamHeard = true;
            break;
          }
        }

        DebugLogger.log(
          'Lam',
          '[LAM-SHAMS] word="$wordText" lamHeard=$lamHeard',
        );

        if (kExtraLamShamsiCheck && lamHeard) {
          out.add(
            ReciterError(
              errorType: ErrorCategory.tajweed,
              speechErrorType: SpeechErrorType.insert,
              expectedPh: wordText[dbl],
              predictedPh: '\u0644',
              expectedRule: const LamShamsiyyaRule(),
            ),
          );
        }
      }
    }

    if (isQamar) {
      int li = -1;
      for (int i = 0; i + 1 < wordText.length && i < 4; i++) {
        if (wordText[i] == '\u0644' && !_vowelMarks.contains(wordText[i + 1])) {
          li = i;
          break;
        }
      }
      if (li >= 0) {
        final int lamAbs = wordRefStart + li;
        String lamOp = 'none';
        bool nextHeard = false;
        for (final a in alignments) {
          final int ref = targetCharCursor + a.refIdx;
          if (ref == lamAbs) lamOp = a.opType;
          if (ref == lamAbs + 1 && a.opType == 'match') nextHeard = true;
        }
        final bool lamMissing = lamOp == 'delete' && nextHeard;

        DebugLogger.log(
          'Lam',
          '[LAM-QAMAR] word="$wordText" lamOp=$lamOp nextHeard=$nextHeard missing=$lamMissing',
        );

        if (kExtraLamQamariCheck && lamMissing) {
          out.add(
            ReciterError(
              errorType: ErrorCategory.tajweed,
              speechErrorType: SpeechErrorType.delete,
              expectedPh: '\u0644',
              predictedPh: '',
              expectedRule: const LamQamariyyaRule(),
            ),
          );
        }
      }
    }
    return out;
  }

  static int _getErrorPriority(ReciterError e) {'''
ee = replace_once(ee, 'static int _getErrorPriority(ReciterError e) {', HELPERS, ee_path)
write(ee_path, ee)

ps_path = os.path.join(root, 'pubspec.yaml')
with open(ps_path, encoding='utf-8') as f:
    ps = f.read()
if 'path: packages/recite_quran' not in ps:
    lines = ps.split('\n')
    idx = next((i for i, l in enumerate(lines) if l.strip() == 'dependency_overrides:' and not l.startswith(' ')), None)
    block = ['  recite_quran:', '    path: packages/recite_quran']
    if idx is None:
        lines = lines + ['', 'dependency_overrides:'] + block
    else:
        lines[idx + 1:idx + 1] = block
    with open(ps_path, 'w', encoding='utf-8', newline='') as f:
        f.write('\n'.join(lines))

print('recite_quran patched: qalqalah=%s lam_shamsi=%s lam_qamari=%s' % (QALQALAH, LAM_SHAMSI, LAM_QAMARI))
