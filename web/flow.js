'use strict';
/* Ablauf in Schritten (je Welt) mit Startseite, Reitern, „Zurück/Weiter“ und Zusammenfassung.
   Nutzt S, $, $$, h(), fill(), W(), api(), toast() usw. aus app.js/settings.js (nur zur Laufzeit). */

const STEPS = {
  video: [['start', 'Start'], ['files', 'Dateien'], ['dest', 'Ziel'], ['name', 'Benennen'], ['video', 'Video'], ['tracks', 'Audio & Untertitel'], ['summary', 'Zusammenfassung']],
  audio: [['start', 'Start'], ['files', 'Dateien'], ['dest', 'Ziel'], ['name', 'Benennen'], ['audio', 'Einstellungen'], ['summary', 'Zusammenfassung']],
};
const stepIds = () => STEPS[S.world].map(s => s[0]);

function renderSteps() {
  const ids = stepIds(), cur = ids.indexOf(S.step), n = S.files[S.world].length;
  fill($('#steps'), STEPS[S.world].map(([id, label], i) => h('button', {type: 'button', 'data-step-btn': id, class: 'stepbtn' + (id === S.step ? ' on' : '') + (i < cur ? ' past' : ''),
    title: label, 'aria-current': id === S.step ? 'step' : null, onclick: () => showStep(id)},
    h('i', {}, id === 'start' ? icon('planet') : String(i)), h('span', {}, label), id === 'files' && n ? h('em', {}, n) : null)));
  const on = $('#steps .stepbtn.on'); if (on && on.scrollIntoView) on.scrollIntoView({inline: 'center', block: 'nearest'});
}

// zeigt nur den gewählten Schritt; Reiter, Zurück/Weiter und Voreinstellungsleiste passen sich an
function applySteps() {
  const ids = stepIds(), i = ids.indexOf(S.step);
  $$('.stepsec').forEach(sec => sec.classList.toggle('hidden', !(sec.dataset.step === S.step && (!sec.dataset.world || sec.dataset.world === S.world))));
  $('#hwCard').classList.toggle('hidden', S.world !== 'video');
  // Voreinstellungen gibt es nur dort, wo auch die Einstellungen sind (Video bzw. Einstellungen), nicht in jedem Schritt
  $('#presetBar').classList.toggle('hidden', !(S.step === 'video' || S.step === 'audio'));
  $('#aPresets').classList.toggle('hidden', S.world !== 'audio');
  $('#vPresets').classList.toggle('hidden', S.world !== 'video');
  $('#stepnav').classList.toggle('hidden', S.step === 'start');
  $('#stepNext').classList.toggle('hidden', S.step === 'summary');
  $('#start').classList.toggle('hidden', S.step !== 'summary');
  $('#savePreset').classList.toggle('hidden', S.step !== 'summary');
  $('#stepBack').textContent = i <= 1 ? '← Startseite' : '← Zurück';
  document.body.dataset.step = S.step;
  renderSteps();
}

function showStep(id, keepScroll) {
  if (!stepIds().includes(id)) id = 'start';
  S.step = id;
  applySteps();
  if (id === 'summary') renderSummary();
  if (id === 'files') renderFiles();
  if (id === 'name') syncNameUI();
  if (id === 'tracks') trkRender();
  existsUI();
  if (!keepScroll) window.scrollTo(0, 0);
}
const stepMove = d => { const ids = stepIds(), i = ids.indexOf(S.step) + d; showStep(i < 0 ? 'start' : ids[Math.min(i, ids.length - 1)]); };

// ---------- Startseite: gewonnener Platz ----------
// Gewonnener Platz: strikt je Welt – Audio zeigt nur Audio, Video nur Video (eigene Zählung, eigenes Zurücksetzen)
function renderSaved() {
  const d = S.saved, box = $('#savedBody'), t = d && d[S.world];
  $('#savedReset').classList.toggle('hidden', !(t && t.count));
  if (!t || !t.count) {
    fill(box, h('p', {class: 'muted small'}, 'In „' + W(S.world).name + '“ noch nichts umgewandelt. Hier siehst du bald, wie viel Speicherplatz du in dieser Welt durch das Konvertieren gewonnen hast.'));
    return;
  }
  const diff = t.in - t.out, pct = t.in ? Math.round(Math.abs(diff) / t.in * 100) : 0;
  fill(box, h('div', {class: 'savedbig ' + (diff >= 0 ? 'good' : 'warn')}, (diff >= 0 ? '−' : '+') + fmtSize(Math.abs(diff))),
    h('div', {class: 'muted small'}, (diff >= 0 ? 'Platz gewonnen' : 'Mehrbedarf (z. B. durch verlustfreie Formate)') + ' (' + pct + ' %)' + (t.since ? ' seit ' + t.since.split('-').reverse().join('.') : '')),
    h('div', {class: 'savedrow'}, h('small', {class: 'muted'}, t.count + (t.count === 1 ? ' Datei' : ' Dateien') + ' · ' + fmtSize(t.in) + ' → ' + fmtSize(t.out))));
}
function openSavedReset() {
  const t = S.saved && S.saved[S.world];
  $('#savedResetText').textContent = `Die Zählung „Gewonnener Platz“ der Welt „${W(S.world).name}“` + (t && t.since ? ' (seit ' + t.since.split('-').reverse().join('.') + ')' : '') + ' wird gelöscht. Die andere Welt behält ihre Zahlen.';
  $('#savedResetDlg').showModal();
}
async function doSavedReset() {
  $('#savedResetDlg').close();
  try { const r = await api('/api/stats/reset', {kind: S.world}); S.saved = r.saved; renderSaved(); toast('Statistik von „' + W(S.world).name + '“ zurückgesetzt.', 'ok'); }
  catch (e) { toast(e.message, 'bad'); }
}

// ---------- Zusammenfassung ----------
function sumRow(label, step, ...content) {
  return h('div', {class: 'sumrow'}, h('div', {class: 'suml'}, h('b', {}, label), h('button', {type: 'button', class: 'small ghost', onclick: () => showStep(step)}, 'Ändern')), h('div', {class: 'sumc'}, content));
}
async function renderSummary() {
  const files = S.files[S.world], tot = files.reduce((a, f) => a + (f.size || 0), 0), warns = [];
  const dir = $('#outMode').value === 'custom' ? $('#outDir').value.trim() : '';
  if (!files.length) warns.push('Es sind noch keine Dateien ausgewählt.');
  if ($('#outMode').value === 'custom' && !dir) warns.push('Es ist kein Zielordner angegeben.');
  if ($('#deleteSource').checked) warns.push('Die Quelldateien werden nach erfolgreicher Konvertierung GELÖSCHT.');
  if (S.world === 'video' && $('#vCodec').value !== 'copy') {
    const r = resolveBackend(); if (r && r.note) warns.push(r.note);
  }
  const names = files.slice(0, 4).map(f => f.rel || f.path.split(/[\\/]/).pop());
  const existsTxt = {rename: 'Gibt es die Zieldatei schon: beide behalten, die neue wird nummeriert', skip: 'Gibt es die Zieldatei schon: überspringen, die vorhandene bleibt unberührt', overwrite: 'Gibt es die Zieldatei schon: überschreiben, die vorhandene wird ersetzt'}[$('#exists').value];
  if ($('#exists').value === 'overwrite') warns.push('Vorhandene Zieldateien werden überschrieben.');
  const pat = $('#pattern').value.trim(), rules = cleanRules(nameRules()), suf = $('#suffix').value;
  const nameParts = [pat ? 'Muster ' + pat : 'Originalname', suf ? 'Zusatz „' + suf + '“' : null, rules.length ? rules.length + (rules.length === 1 ? ' Ersetzung' : ' Ersetzungen') : null].filter(Boolean);
  const settings = describePreset({world: S.world, values: collectPresetValues(S.world)});
  const sp = h('span', {class: 'muted small'}, '');
  const rows = [
    sumRow('Dateien', 'files', h('div', {}, files.length + (files.length === 1 ? ' Datei' : ' Dateien') + (files.length ? ' · ' + fmtSize(tot) : '')), files.length ? h('div', {class: 'muted small'}, names.join(' · ') + (files.length > 4 ? ' · … und ' + (files.length - 4) + ' weitere' : '')) : null),
    sumRow('Ziel', 'dest', h('div', {}, dir ? 'Ordner ' + dir : 'Neben der Quelldatei'), h('div', {class: 'muted small'}, existsTxt)),
    sumRow('Benennen', 'name', h('div', {}, nameParts.join(' · ')), sp),
    sumRow(S.world === 'video' ? 'Video' : 'Einstellungen', S.world === 'video' ? 'video' : 'audio', h('div', {}, settings),
      S.world === 'video' && $('#vCodec').value !== 'copy' ? h('div', {class: 'muted small'}, 'Encoder: ' + $('#vResolved').textContent.replace(/\s+/g, ' ').trim()) : null),
  ];
  if (S.world === 'video') {
    const am = $('#vAudioMode').value === 'copy' ? 'Audiospuren unverändert' : 'Audio neu kodiert (' + $('#vAudioCodec').value.toUpperCase() + ' ' + $('#vAudioKbps').value + ' kbit/s)';
    const al = $('#vAudioLangs').value.trim(), sl = $('#vSubLangs').value.trim();
    const sm = $('#vSubMode').value === 'none' ? 'Untertitel entfernt' : 'Untertitel unverändert';
    const ed = trkEditedFiles();
    rows.push(sumRow('Audio & Untertitel', 'tracks', h('div', {}, am + (al ? ' · nur ' + al : '')), h('div', {}, sm + (sl && $('#vSubMode').value !== 'none' ? ' · nur ' + sl : '')),
      ed ? h('div', {class: 'muted small'}, 'Einzelne Spuren geändert bei ' + ed + (ed === 1 ? ' Datei' : ' Dateien')) : null));
  }
  fill($('#summaryBody'), warns.length ? h('div', {class: 'banner warn'}, warns.map(w => h('div', {}, icon('warn'), ' ' + w))) : null, rows);
  $('#start').disabled = !files.length || ($('#outMode').value === 'custom' && !dir);
  // Beispiel für den neuen Namen der ersten Datei
  if (files.length) {
    try {
      const r = await api('/api/rename/preview', {items: [files[0].path], pattern: pat, replace: rules, suffix: suf, ext: outExt(), mode: 'convert',
        target: S.world === 'video' ? {codec: $('#vCodec').value, height: +$('#vHeight').value, bitDepth: +$('#vDepth').value, container: $('#vContainer').value} : {container: outExt()}});
      const x = r.items[0];
      if (x) sp.textContent = 'Beispiel: ' + x.old + ' → ' + (x.error ? x.error : x.new);
    } catch (e) { /* nur ein Beispiel */ }
  }
}

// ---------- „Wenn Datei existiert“: erklärender Satz unter der Auswahl ----------
const EXISTS_HINT = {
  rename: 'Vorhandene Datei bleibt, die neue bekommt eine Nummer, z. B. „Film (2).mkv“.',
  skip: 'Vorhandene Datei wird nicht angefasst, dieser Auftrag wird übersprungen.',
  overwrite: 'Achtung: Die vorhandene Datei wird ersetzt. Das lässt sich nicht rückgängig machen.',
};
function existsUI() {
  const v = $('#exists').value, el = $('#existsHint');
  el.textContent = EXISTS_HINT[v] || '';
  el.classList.toggle('warn', v === 'overwrite');
}

// ---------- alles zurücksetzen (nur die gerade gewählte Welt) ----------
const DEST_FIELDS = ['outMode', 'outDir', 'outStruct', 'exists'];
// Anfangswerte = die im HTML eingestellten; die Grundeinstellung ist „Remux“ (nichts wird umgewandelt)
const RESET_OVERRIDES = {
  video: {vContainer: 'mkv', vCodec: 'copy', vAudioMode: 'copy', vAudioLangs: '', vSubMode: 'copy', vSubLangs: ''},
  audio: {aFormat: 'flac'},
};
function captureDefaults() {
  S.defaults = {};
  [...FIELDS, ...CHECKS].forEach(k => { const el = $('#' + k); S.defaults[k] = el.type === 'checkbox' ? el.checked : el.value; });
}
function resetWorld() {
  const w = S.world, d = S.defaults, over = RESET_OVERRIDES[w];
  [...PRESET_FIELDS[w], ...DEST_FIELDS, 'deleteSource'].filter(k => !NAME_FIELDS.includes(k)).forEach(k => setField(k, k in over ? over[k] : d[k]));
  setField('vHwDec', cfg().hwDecode !== false);
  setField('outDir', cfg().defaultOutDir || ''); setField('outMode', cfg().defaultOutDir ? 'custom' : 'same');
  S.name[w] = {...NAME_EMPTY}; showName(w);
  S.files[w].length = 0;
  refreshAudioUI(); refreshVideoUI(); outModeUI(); syncNameUI(); renderFiles(); renderHero(); saveSettings();
  showStep('start');
  toast(W(w).name + ' wurde zurückgesetzt.', 'ok');
}
function openReset() {
  const w = S.world, n = S.files[w].length;
  $('#resetText').textContent = `Dateien${n ? ' (' + n + ')' : ''}, Ziel, Benennung und alle Einstellungen der Welt „${W(w).name}“ gehen zurück auf den Anfang: ` +
    (w === 'video' ? 'Video „Remux als MKV“, Audio und Untertitel unverändert.' : 'Einstellungen „Remux als FLAC“.');
  $('#resetDlg').showModal();
}

function wireFlow() {
  $('#savedReset').onclick = openSavedReset;
  $('#savedResetNo').onclick = () => $('#savedResetDlg').close();
  $('#savedResetYes').onclick = doSavedReset;
  $('#exists').addEventListener('input', existsUI);
  $('#resetAll').onclick = openReset;
  $('#resetNo').onclick = () => $('#resetDlg').close();
  $('#resetYes').onclick = () => { $('#resetDlg').close(); resetWorld(); };
  $('#startFlow').onclick = () => showStep('files');
  $('#startRename').onclick = () => { location.hash = '#rename'; };
  $('#stepBack').onclick = () => stepMove(-1);
  $('#stepNext').onclick = () => stepMove(1);
}
