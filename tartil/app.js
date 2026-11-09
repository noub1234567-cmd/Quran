/* app.js — ترتيل: near-live Quran recitation checker, fully on the device. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const CFG = {
    modelUrl: 'https://huggingface.co/noubou/tartil-onnx/resolve/main/model.int8.onnx',
    ortBase: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/',
    cache: 'tartil-model', refUrl: 'tartil_ref.json.gz',
  };
  try { const u = localStorage.getItem('tartil.modelUrl'); if (u) CFG.modelUrl = u; } catch (e) {}
  const q = new URLSearchParams(location.search); if (q.get('model')) CFG.modelUrl = q.get('model');

  const SURAS = ['الفاتحة','البقرة','آل عمران','النساء','المائدة','الأنعام','الأعراف','الأنفال','التوبة','يونس','هود','يوسف','الرعد','إبراهيم','الحجر','النحل','الإسراء','الكهف','مريم','طه','الأنبياء','الحج','المؤمنون','النور','الفرقان','الشعراء','النمل','القصص','العنكبوت','الروم','لقمان','السجدة','الأحزاب','سبأ','فاطر','يس','الصافات','ص','الزمر','غافر','فصلت','الشورى','الزخرف','الدخان','الجاثية','الأحقاف','محمد','الفتح','الحجرات','ق','الذاريات','الطور','النجم','القمر','الرحمن','الواقعة','الحديد','المجادلة','الحشر','الممتحنة','الصف','الجمعة','المنافقون','التغابن','الطلاق','التحريم','الملك','القلم','الحاقة','المعارج','نوح','الجن','المزمل','المدثر','القيامة','الإنسان','المرسلات','النبأ','النازعات','عبس','التكوير','الانفطار','المطففين','الانشقاق','البروج','الطارق','الأعلى','الغاشية','الفجر','البلد','الشمس','الليل','الضحى','الشرح','التين','العلق','القدر','البينة','الزلزلة','العاديات','القارعة','التكاثر','العصر','الهمزة','الفيل','قريش','الماعون','الكوثر','الكافرون','النصر','المسد','الإخلاص','الفلق','الناس'];
  const PH = {"'":'ء','3':'ع','b':'ب','t':'ت','th':'ث','j':'ج','H':'ح','kh':'خ','d':'د','dh':'ذ','r':'ر','R':'ر مفخمة','z':'ز','s':'س','sh':'ش','S':'ص','D':'ض','T':'ط','Z':'ظ','gh':'غ','f':'ف','q':'ق','k':'ك','l':'ل','L':'ل مفخمة','m':'م','n':'ن','N':'ن مخفاة','h':'ه','w':'و','y':'ي','a':'فتحة','i':'كسرة','u':'ضمة','aa':'ألف مد','uu':'واو مد','ii':'ياء مد','ee':'إمالة'};
  const TG = {ikhfa:'إخفاء',ikhfa_mufakhkham:'إخفاء مفخّم',ikhfa_shafawi:'إخفاء شفوي',idgham_ghunna:'إدغام بغنة',idgham_bila_ghunna:'إدغام بلا غنة',idgham_shafawi:'إدغام شفوي',idgham_mithlayn:'إدغام مثلين',idgham_mutaqaribayn:'إدغام متقاربين',iqlab:'إقلاب',izhar_halqi:'إظهار حلقي',izhar_shafawi:'إظهار شفوي',izhar_mutlaq:'إظهار مطلق',ghunna:'غنة',qalqala:'قلقلة',tafkhim:'تفخيم',tarqiq:'ترقيق',tanween:'تنوين',leen:'لين',madd_asli:'مد أصلي',madd_muttasil:'مد متصل',madd_munfasil:'مد منفصل',madd_arid_lilsukun:'مد عارض',madd_lazim:'مد لازم',madd_silah_sughra:'صلة صغرى',madd_silah_kubra:'صلة كبرى',waqf:'وقف',tanween_waqf:'تنوين عند الوقف',hamzat_wasl:'همزة وصل',lafz_jalala_tafkhim:'تفخيم لفظ الجلالة',lafz_jalala_tarqiq:'ترقيق لفظ الجلالة',iltiqa:'التقاء ساكنين'};
  const ph = (s) => { if (s == null) return '—'; const g = s.endsWith(':'); const b = g ? s.slice(0, -1) : s; return (PH[b] || b) + (g ? ' مشددة' : ''); };

  let REF = null, pass = null, tracker = null, worker = null, modelReady = false, running = false, ctl = null, stream = null, segCount = 0, procMs = 0;

  const setStatus = (t) => { $('status').textContent = t; };

  // ---------- reference data ----------
  async function loadRef() {
    const res = await fetch(CFG.refUrl);
    if (!res.ok) throw new Error('تعذّر تحميل ملف المرجع');
    let text;
    if (typeof DecompressionStream !== 'undefined') text = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
    else throw new Error('المتصفح قديم: يلزم متصفح حديث');
    REF = JSON.parse(text);
    const cnt = {};
    for (const k in REF.verses) { const [s, a] = k.split(':').map(Number); cnt[s] = Math.max(cnt[s] || 0, a); }
    REF.counts = cnt;
  }
  function fillSuras() {
    const sel = $('sura');
    SURAS.forEach((n, i) => { const o = document.createElement('option'); o.value = i + 1; o.textContent = (i + 1) + ' — ' + n; sel.appendChild(o); });
    let s = 112, f = 1, t = 4;
    try { const v = JSON.parse(localStorage.getItem('tartil.sel') || 'null'); if (v) { s = v.s; f = v.f; t = v.t; } } catch (e) {}
    sel.value = s; fillAyas(f, t);
  }
  function fillAyas(f, t) {
    const n = REF.counts[+$('sura').value] || 1;
    for (const id of ['from', 'to']) { const el = $(id); el.innerHTML = ''; for (let a = 1; a <= n; a++) { const o = document.createElement('option'); o.value = a; o.textContent = a; el.appendChild(o); } }
    $('from').value = Math.min(f || 1, n); $('to').value = Math.min(t || n, n);
  }
  function fixRange() { if (+$('to').value < +$('from').value) $('to').value = $('from').value; }

  // ---------- passage rendering ----------
  function renderPassage() {
    fixRange();
    const s = +$('sura').value, f = +$('from').value, t = +$('to').value;
    try { localStorage.setItem('tartil.sel', JSON.stringify({ s, f, t })); } catch (e) {}
    pass = TartilTracker.buildPassage(REF, s, f, t);
    tracker = TartilTracker.create(pass, REF.vocab);
    const box = $('text'); box.innerHTML = ''; $('detail').style.display = 'none'; $('reportCard').style.display = 'none';
    let lastV = null, frag = document.createDocumentFragment();
    pass.words.forEach((w, i) => {
      if (lastV !== null && pass.wordVerse[i] !== lastV) { const v = document.createElement('span'); v.className = 'vn'; v.textContent = '﴿' + lastV + '﴾'; frag.appendChild(v); frag.appendChild(document.createTextNode(' ')); }
      lastV = pass.wordVerse[i];
      const sp = document.createElement('span'); sp.className = 'w st-pending'; sp.dataset.i = i; sp.textContent = w;
      frag.appendChild(sp); frag.appendChild(document.createTextNode(' '));
    });
    const v = document.createElement('span'); v.className = 'vn'; v.textContent = '﴿' + lastV + '﴾'; frag.appendChild(v);
    box.appendChild(frag);
    setStatus('جاهز. اضغط ابدأ ثم اقرأ.');
  }
  function paint() {
    const st = tracker.wordStates(), el = $('text').querySelectorAll('.w');
    const bad = new Set(tracker.allFlags().map((f) => f.word));
    el.forEach((e, i) => { const c = 'w st-' + st[i] + (bad.has(i) ? ' hasflag' : ''); if (e.className !== c) e.className = c; });
  }
  function showDetail(i) {
    const fl = tracker.allFlags().filter((f) => f.word === i); const d = $('detail');
    if (!fl.length) { d.style.display = 'none'; return; }
    d.style.display = 'block';
    d.innerHTML = '<div class="big">' + pass.words[i] + '</div>' + fl.map((f) => {
      const what = f.kind === 'sub' ? 'سُمع «' + ph(f.heard) + '» بدل «' + ph(f.ref) + '»' : 'لم يُسمع «' + ph(f.ref) + '»';
      const tg = f.tags.filter((t) => TG[t]).map((t) => '<span class="tag">' + TG[t] + '</span>').join('');
      return '<div>' + (f.level === 'confirmed' ? '✗ ' : '؟ ') + what + (f.level === 'confirmed' ? '' : ' (محتمل)') + tg + '</div>';
    }).join('');
  }
  function report() {
    const fl = tracker.allFlags(); $('reportCard').style.display = 'block';
    const conf = fl.filter((f) => f.level === 'confirmed'), pos = fl.filter((f) => f.level !== 'confirmed');
    const st = tracker.wordStates(), seen = st.filter((x) => x !== 'pending').length;
    $('summary').innerHTML = '<p>غُطّيت ' + seen + ' كلمة من ' + st.length + ' — أخطاء مؤكدة: <b>' + conf.length + '</b> — محتملة: ' + pos.length + '</p>' + (conf.length ? '' : '<p>لا أخطاء مؤكدة. ما شاء الله.</p>');
    $('report').innerHTML = conf.concat(pos).map((f) => {
      const what = f.kind === 'sub' ? 'سُمع «' + ph(f.heard) + '» بدل «' + ph(f.ref) + '»' : 'لم يُسمع «' + ph(f.ref) + '»';
      const tg = f.tags.filter((t) => TG[t]).map((t) => '<span class="tag">' + TG[t] + '</span>').join('');
      return '<div class="item"><span class="big">' + pass.words[f.word] + '</span> — آية ' + pass.wordVerse[f.word] + '<br>' + (f.level === 'confirmed' ? '✗ ' : '؟ ') + what + (f.level === 'confirmed' ? '' : ' (محتمل)') + tg + '</div>';
    }).join('');
  }

  // ---------- model ----------
  async function openCache() { try { return await caches.open(CFG.cache); } catch (e) { return null; } }
  async function cachedModel() { const c = await openCache(); if (!c) return null; const hit = await c.match('local-model-v1'); return hit ? new Uint8Array(await hit.arrayBuffer()) : null; }
  async function fetchModel(onp) {
    const res = await fetch(CFG.modelUrl);
    if (!res.ok) throw new Error('تعذّر تنزيل النموذج (HTTP ' + res.status + ')');
    const total = +res.headers.get('content-length') || 0, rd = res.body.getReader();
    let buf = total ? new Uint8Array(total) : null, got = 0, chunks = [];
    for (;;) { const r = await rd.read(); if (r.done) break; if (buf) buf.set(r.value, got); else chunks.push(r.value); got += r.value.length; onp(got, total); }
    if (!buf) { buf = new Uint8Array(got); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; } }
    if (total && got !== total) throw new Error('انقطع التنزيل قبل أن يكتمل، أعد المحاولة');
    return buf;
  }
  function startWorker(bytes) {
    return new Promise((resolve, reject) => {
      worker = new Worker('worker.js');
      worker.onmessage = (ev) => { if (ev.data.type === 'ready') resolve(); else if (ev.data.type === 'error') reject(new Error(ev.data.message)); };
      worker.onerror = (e) => reject(new Error('تعذّر تشغيل خيط التحليل'));
      worker.postMessage({ type: 'init', ortBase: CFG.ortBase, bytes: bytes.buffer }, [bytes.buffer]);
    });
  }
  async function loadModel(fileBytes) {
    $('loadBtn').disabled = true; $('prog').style.display = 'block';
    try {
      let bytes = fileBytes || await cachedModel();
      if (!bytes) {
        $('modelState').textContent = 'جارٍ تنزيل النموذج…';
        bytes = await fetchModel((g, t) => { $('progBar').style.width = (t ? 100 * g / t : 50) + '%'; $('modelState').textContent = 'جارٍ التنزيل: ' + Math.round(g / 1e6) + (t ? ' / ' + Math.round(t / 1e6) : '') + ' ميغابايت'; });
      }
      const c = await openCache();
      if (c && !(await c.match('local-model-v1'))) { try { await c.put('local-model-v1', new Response(bytes.slice(0))); } catch (e) { /* storage full: continue */ } }
      $('modelState').textContent = 'جارٍ تهيئة النموذج…'; $('progBar').style.width = '100%';
      await startWorker(bytes); hookWorker();
      modelReady = true; $('modelState').textContent = '✓ النموذج جاهز'; $('prog').style.display = 'none'; $('loadBtn').style.display = 'none'; $('go').disabled = false;
    } catch (e) {
      $('modelState').textContent = 'تعذّر: ' + e.message; $('loadBtn').disabled = false; $('prog').style.display = 'none';
    }
  }
  let rid = 0; const waiting = new Map();
  function runModel(samples) {
    return new Promise((resolve, reject) => {
      const id = ++rid; waiting.set(id, { resolve, reject });
      worker.postMessage({ type: 'run', id, samples }, [samples.buffer]);
    });
  }
  function hookWorker() {
    worker.onmessage = (ev) => {
      const m = ev.data, w = waiting.get(m.id); if (!w) return; waiting.delete(m.id);
      if (m.type === 'result') w.resolve(m); else w.reject(new Error(m.message));
    };
  }

  // ---------- segments ----------
  async function handleSegment(samples) {
    const sec = samples.length / 16000;
    const m = await runModel(new Float32Array(samples));
    const r = tracker.process(m.logp, m.T, m.V);
    segCount++; procMs += m.ms;
    const msg = { ok: 'حُلّل مقطع (' + sec.toFixed(1) + ' ث في ' + (m.ms / 1000).toFixed(1) + ' ث)', lost: 'لم أتعرّف على هذا المقطع ضمن الآيات المحددة', unreliable: 'المقطع غير واضح أو لا يطابق النص', short: 'مقطع قصير جدًا' }[r.status];
    setStatus(msg); paint();
    if (tracker.done && running) setTimeout(stop, 300);
    return { text: '', ms: m.ms };
  }

  async function start() {
    if (running) return;
    renderPassage(); segCount = 0; procMs = 0; hookWorker();
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } }); }
    catch (e) { setStatus('لا يمكن الوصول إلى الميكروفون: أعطِ الإذن من إعدادات المتصفح'); return; }
    try {
      ctl = await QuranLive.start(stream, {
        transcribe: handleSegment,
        onUpdate: (u) => { if (running) setStatus(u.processing ? 'جارٍ التحليل…' + (u.pending ? ' (' + u.pending + ' بالانتظار)' : '') : 'أستمع… ' + u.seconds.toFixed(0) + ' ث'); },
      });
    } catch (e) { setStatus('تعذّر بدء التسجيل: ' + e.message); stream.getTracks().forEach((t) => t.stop()); return; }
    running = true; $('go').textContent = 'إيقاف'; $('go').className = 'rec'; lock(true);
  }
  async function stop() {
    if (!running) return; running = false;
    $('go').disabled = true; setStatus('أُنهي التحليل…');
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); if (ctl) await ctl.stop(); } catch (e) {}
    ctl = null; stream = null; paint(); report(); lock(false);
    $('go').textContent = 'ابدأ'; $('go').className = 'primary'; $('go').disabled = false;
    setStatus('انتهى التحليل (' + segCount + ' مقطع)');
  }
  function lock(on) { for (const id of ['sura', 'from', 'to', 'fileBtn']) $(id).disabled = on; }

  // ---------- analyse a recorded file ----------
  async function analyseFile(file) {
    if (!modelReady) { setStatus('حمّل النموذج أولًا'); return; }
    renderPassage(); hookWorker(); segCount = 0; lock(true); $('go').disabled = true;
    try {
      setStatus('جارٍ قراءة الملف…');
      const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
      const buf = await ac.decodeAudioData(await file.arrayBuffer()); ac.close();
      const len = Math.ceil(buf.duration * 16000), off = new OfflineAudioContext(1, len, 16000), src = off.createBufferSource();
      src.buffer = buf; src.connect(off.destination); src.start();
      const x = (await off.startRendering()).getChannelData(0);
      const seg = QuranLive.createSegmenter(), segs = [];
      for (let i = 0; i < x.length; i += 8000) segs.push(...seg.push(x.subarray(i, Math.min(x.length, i + 8000))));
      segs.push(...seg.flush());
      for (let k = 0; k < segs.length; k++) {
        setStatus('تحليل المقطع ' + (k + 1) + ' من ' + segs.length + '…');
        await handleSegment(segs[k].samples);
      }
      paint(); report(); setStatus('انتهى التحليل (' + segs.length + ' مقطع)');
    } catch (e) { setStatus('تعذّر تحليل الملف: ' + e.message); }
    lock(false); $('go').disabled = false;
  }

  // ---------- init ----------
  async function init() {
    $('modelUrl').value = CFG.modelUrl;
    try { await loadRef(); } catch (e) { setStatus(e.message); return; }
    fillSuras(); renderPassage();
    $('sura').onchange = () => { fillAyas(1, REF.counts[+$('sura').value]); renderPassage(); };
    $('from').onchange = $('to').onchange = renderPassage;
    $('go').onclick = () => (running ? stop() : start());
    $('fileBtn').onclick = () => $('audioFile').click();
    $('audioFile').onchange = (e) => { const f = e.target.files[0]; if (f) analyseFile(f); e.target.value = ''; };
    $('showPos').onchange = () => $('text').parentNode.classList.toggle('hidepos', !$('showPos').checked);
    $('text').onclick = (e) => { const t = e.target.closest('.w'); if (t) showDetail(+t.dataset.i); };
    $('modelUrl').onchange = () => { CFG.modelUrl = $('modelUrl').value.trim(); try { localStorage.setItem('tartil.modelUrl', CFG.modelUrl); } catch (e) {} };
    $('modelFile').onchange = async (e) => { const f = e.target.files[0]; if (f) { const c = await openCache(); if (c) await c.delete('local-model-v1'); loadModel(new Uint8Array(await f.arrayBuffer())); } };
    $('loadBtn').onclick = () => loadModel();
    const cached = await cachedModel().catch(() => null);
    if (cached) { $('modelState').textContent = 'النموذج محفوظ في هاتفك'; loadModel(cached); }
    else { $('modelState').textContent = 'النموذج غير محمَّل بعد'; }
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init();
})();
