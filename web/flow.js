'use strict';
/* Startseite (Kacheln Video und Audio), Wegweiser durch den Ablauf, gewonnener Platz, „Wenn Datei existiert“, Zurücksetzen.
   Video läuft in vier Schritten (1 Dateien, 2 Regeln, 3 Wie umwandeln?, 4 Kontrolle & Start), Audio in einer Ansicht.
   Nutzt S, $, $$, h(), fill(), W(), api(), toast() usw. aus app.js/settings.js (nur zur Laufzeit). */

// Die frühere Schritt-Folge (Dateien, Ziel, Benennen, Video, Spuren, Zusammenfassung) ist jetzt der Ablauf („convert“) plus das Fenster „Details“; alte Namen führen dorthin
const OLD_STEPS = {files: null, summary: null, dest: 'dest', name: 'dest', video: 'video', audio: 'video', tracks: 'tracks'};
const VSTEPS = [['files', 'Dateien'], ['rules', 'Regeln'], ['how', 'Wie umwandeln?'], ['check', 'Kontrolle & Start']];

// zeigt die Startseite oder den Ablauf; Voreinstellungsleiste, Schrittleiste und Startleiste passen sich an
function applySteps() {
  $$('.stepsec').forEach(sec => sec.classList.toggle('hidden', sec.dataset.step !== S.step));
  document.body.dataset.step = S.step;
  document.body.dataset.vstep = S.step === 'convert' && S.world === 'video' ? S.vstep : '';
  applyKindTheme();
  if (typeof cvLayout === 'function') cvLayout();
  if (typeof cvWorldVis === 'function') cvWorldVis();
}

function showStep(id, keepScroll) {
  let tab = null;
  if (id in OLD_STEPS) { tab = OLD_STEPS[id]; id = 'convert'; }
  if (id !== 'start' && id !== 'convert') id = 'start';
  S.step = id;
  applySteps();
  if (id === 'convert') cvRender();
  if (id === 'start') renderStartTiles();
  existsUI();
  if (!keepScroll) window.scrollTo(0, 0);
  if (tab) openSheet(tab);
}
// Video: Schritt 1 bis 4
function vGo(n) {
  S.vstep = Math.max(1, Math.min(4, n));
  applySteps(); cvRender();
  window.scrollTo(0, 0);
}

// ---------- Startseite: Kacheln Video und Audio ----------
const KIND_TILES = {
  video: ['video', 'Video', 'Filme und Serien: Codec, Tonspuren, Untertitel und Hardware-Beschleunigung.', 'Video wählen'],
  audio: ['audio', 'Audio', 'Musik und Hörbücher: MP3, AAC, FLAC, Opus, Samplerate und Kanäle.', 'Audio wählen'],
};
function renderStartTiles() {
  const box = $('#startTiles'); if (!box) return;
  fill(box, ['video', 'audio'].map(k => {
    const [ico, title, sub, go] = KIND_TILES[k], n = S.files[k].length;
    return h('button', {type: 'button', class: 'kindtile ' + k, 'data-kind': k, onclick: () => enterKind(k)},
      h('span', {class: 'kico'}, icon(ico)), h('span', {class: 'kt'}, title), h('span', {class: 'ksub'}, sub),
      n ? h('span', {class: 'kresume'}, n + (n === 1 ? ' Datei' : ' Dateien') + ' ausgewählt · weiter') : null,
      h('span', {class: 'kgo'}, n ? 'Weiter' : go, ' →'));
  }));
}

// ---------- Startseite: gewonnener Platz (Video und Audio getrennt gezählt) ----------
function savedCol(k, t) {
  const name = W(k).name;
  if (!t || !t.count) return h('div', {class: 'savedcol ' + k}, h('div', {class: 'kname'}, name), h('p', {class: 'muted small'}, 'Noch nichts umgewandelt. Hier siehst du bald, wie viel Speicherplatz du durch das Konvertieren gewonnen hast.'));
  const diff = t.in - t.out, pct = t.in ? Math.round(Math.abs(diff) / t.in * 100) : 0;
  return h('div', {class: 'savedcol ' + k}, h('div', {class: 'kname'}, name),
    h('div', {class: 'savedbig ' + (diff >= 0 ? 'good' : 'warn')}, (diff >= 0 ? '−' : '+') + fmtSize(Math.abs(diff))),
    h('div', {class: 'muted small'}, (diff >= 0 ? 'Platz gewonnen' : 'Mehrbedarf (z. B. durch verlustfreie Formate)') + ' (' + pct + ' %)' + (t.since ? ' seit ' + t.since.split('-').reverse().join('.') : '')),
    h('div', {class: 'savedrow'}, h('small', {class: 'muted'}, t.count + (t.count === 1 ? ' Datei' : ' Dateien') + ' · ' + fmtSize(t.in) + ' → ' + fmtSize(t.out))),
    h('button', {type: 'button', class: 'small ghost savedreset', 'data-kind': k, title: 'Zählung von ' + name + ' auf 0 setzen', onclick: () => openSavedReset(k)}, 'Zurücksetzen'));
}
function renderSaved() {
  const d = S.saved || {}, box = $('#savedBody');
  fill(box, ['video', 'audio'].map(k => savedCol(k, d[k])));
}
function openSavedReset(kind) {
  S.resetKind = kind;
  const t = S.saved && S.saved[kind];
  $('#savedResetText').textContent = `Die Zählung „Gewonnener Platz“ von „${W(kind).name}“` + (t && t.since ? ' (seit ' + t.since.split('-').reverse().join('.') + ')' : '') + ' wird gelöscht. Die andere Art behält ihre Zahlen.';
  $('#savedResetDlg').showModal();
}
async function doSavedReset() {
  $('#savedResetDlg').close();
  const kind = S.resetKind;
  try { const r = await api('/api/stats/reset', {kind}); S.saved = r.saved; renderSaved(); toast('Statistik von „' + W(kind).name + '“ zurückgesetzt.', 'ok'); }
  catch (e) { toast(e.message, 'bad'); }
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

// ---------- alles zurücksetzen (nur die gerade gewählte Art) ----------
const DEST_FIELDS = ['outMode', 'outDir', 'outStruct', 'exists'];
// Anfangswerte = die im HTML eingestellten; die Grundeinstellung ist „Remux“ (nichts wird umgewandelt)
const RESET_OVERRIDES = {
  video: {vContainer: 'mkv', vCodec: 'copy', vAudioMode: 'copy', vSubMode: 'copy', vTrkRules: '', vQuality: 'good'},
  audio: {aFormat: 'flac'},
};
function captureDefaults() {
  S.defaults = {};
  [...FIELDS, ...CHECKS].forEach(k => { const el = $('#' + k); S.defaults[k] = el.type === 'checkbox' ? el.checked : el.value; });
}
function resetWorld() {
  const w = S.world, d = S.defaults, over = RESET_OVERRIDES[w];
  [...PRESET_FIELDS[w], ...DEST_FIELDS].filter(k => !NAME_FIELDS.includes(k)).forEach(k => setField(k, k in over ? over[k] : d[k]));
  setField('vHwDec', cfg().hwDecode !== false);
  setField('outDir', cfg().defaultOutDir || ''); setField('outMode', cfg().defaultOutDir ? 'custom' : 'same');
  S.name[w] = {...NAME_EMPTY}; showName(w); vfReset(w);
  if (w === 'video') { S.qSig = null; S.vstep = 1; S.presetSkip = false; CV.reviewed.clear(); CV.inh = {}; CV.gsel = {}; CV.open.clear(); CV.unfold.clear(); }
  S.files[w].length = 0;
  refreshAudioUI(); refreshVideoUI(); outModeUI(); syncNameUI(); renderFiles(); renderHero(); renderStartTiles(); saveSettings();
  showStep('start');
  toast(W(w).name + ' wurde verworfen.', 'ok');
}
function openReset() {
  const w = S.world, n = S.files[w].length;
  // nichts gewählt (keine Dateien, noch im ersten Schritt): kein Grund zur Rückfrage
  if (!n && (w !== 'video' || S.vstep <= 1)) { resetWorld(); return; }
  $('#resetText').textContent = `${n ? n + (n === 1 ? ' Datei' : ' Dateien') + ' und alle' : 'Alle'} Eingaben von „${W(w).name}“ (Ziel, Benennung, Regeln, Einstellungen) gehen verloren, danach geht es zur Startseite.`;
  $('#resetDlg').showModal();
}

function wireFlow() {
  $('#savedResetNo').onclick = () => $('#savedResetDlg').close();
  $('#savedResetYes').onclick = doSavedReset;
  $('#exists').addEventListener('input', existsUI);
  $('#resetAll').onclick = openReset; $('#wizDiscard').onclick = openReset;
  $('#resetNo').onclick = () => $('#resetDlg').close();
  $('#resetYes').onclick = () => { $('#resetDlg').close(); resetWorld(); };
  // Kopfzeile: Umbenennen und Verlauf gelten in jeder Ansicht; der Ablauf bleibt dabei, wo er war
  $('#cvHome').onclick = () => showStep('start');
  $('#startRename').onclick = () => { location.hash = '#rename'; };
  $('#startHistory').onclick = () => { location.hash = '#history'; };
  $('#wizBack').onclick = () => vGo(S.vstep - 1);
  $('#wizNext').onclick = () => {
    if (S.vstep === 1 && S.presetSkip) { S.presetSkip = false; vGo(4); return; } // Voreinstellung gewählt: direkt zur Kontrolle
    vGo(S.vstep + 1);
  };
}
