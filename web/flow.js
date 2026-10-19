'use strict';
/* Startseite und Konvertieren-Ansicht (je Welt), gewonnener Platz, „Wenn Datei existiert“, Zurücksetzen.
   Nutzt S, $, $$, h(), fill(), W(), api(), toast() usw. aus app.js/settings.js (nur zur Laufzeit). */

const STEPS = {
  video: [['start', 'Start'], ['convert', 'Konvertieren']],
  audio: [['start', 'Start'], ['convert', 'Konvertieren']],
};
const stepIds = () => STEPS[S.world].map(s => s[0]);
// Die frühere Schritt-Folge (Dateien, Ziel, Benennen, Video, Spuren, Zusammenfassung) ist jetzt eine Ansicht („convert“); alte Namen führen dorthin
const OLD_STEPS = {files: null, summary: null, dest: 'dest', name: 'dest', video: 'video', audio: 'video', tracks: 'tracks'};

// zeigt die Startseite oder die Konvertieren-Ansicht; Voreinstellungsleiste und Startleiste passen sich an
function applySteps() {
  $$('.stepsec').forEach(sec => sec.classList.toggle('hidden', sec.dataset.step !== S.step));
  $('#hwCard').classList.toggle('hidden', S.world !== 'video');
  $('#aPresets').classList.toggle('hidden', S.world !== 'audio');
  $('#vPresets').classList.toggle('hidden', S.world !== 'video');
  $('#stepnav').classList.toggle('hidden', S.step === 'start');
  document.body.dataset.step = S.step;
  if (typeof cvWorldVis === 'function') cvWorldVis();
}

function showStep(id, keepScroll) {
  let tab = null;
  if (id in OLD_STEPS) { tab = OLD_STEPS[id]; id = 'convert'; }
  if (!stepIds().includes(id)) id = 'start';
  S.step = id;
  applySteps();
  if (id === 'convert') cvRender();
  existsUI();
  if (!keepScroll) window.scrollTo(0, 0);
  if (tab) openSheet(tab);
}

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
  if (w === 'video') { setField('vMaterial', 'standard'); S.qSig = null; CV.reviewed.clear(); CV.inh = {}; CV.gsel = {}; CV.open.clear(); CV.unfold.clear(); }
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
  // die drei Knöpfe sitzen in der Kopfzeile und gelten in jeder Ansicht: zuerst zur Hauptansicht; ein schon geöffneter Assistent bleibt, wo er war
  $('#startFlow').onclick = () => { if (location.hash) location.hash = ''; showStep(S.step === 'start' ? 'convert' : S.step); };
  $('#cvHome').onclick = () => showStep('start');
  $('#startRename').onclick = () => { location.hash = '#rename'; };
  $('#startHistory').onclick = () => { location.hash = '#history'; };
}
