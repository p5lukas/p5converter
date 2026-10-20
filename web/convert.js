'use strict';
/* Konvertieren in EINER Ansicht (statt sechs Schritten):
   oben die Dateien, darunter ein Satz zum Antippen für alles, was nicht in die Tabelle passt (Hardware, Ziel, Prüfen),
   dann die Tabelle „Vorher → Nachher“ (links die Quelle, rechts das Ergebnis, jede Zeile direkt änderbar) und unten die Startleiste.
   Dateien mit gleichen Rahmendaten (Spuren, Sprachen, Formate) bilden eine Gruppe; eine Entscheidung gilt für die ganze Gruppe.
   Abweichende Dateien sind eine eigene Gruppe und müssen kontrolliert werden; die Entscheidungen einer kontrollierten Gruppe werden bei gleichen
   Spuren übernommen („Übernommen“). Das Funkel-Zeichen (SVG, kein Emoji) steht nur bei dem, was das Programm selbst erkannt oder angepasst hat (Regeln, Sprach-Wünsche,
   Forced-Erkennung, Übernahme) – nicht bei Standardvorschlägen.
   Der Zustand bleibt in den Feldern der Oberfläche (#vCodec, #vCrf, …; sie stecken versteckt im Fenster „Details“) und in f.tracks je Datei:
   so funktionieren Voreinstellungen, Speichern und Starten unverändert. Die Berechnung steckt in trkplan.js (TP) und quality.js (Q).
   Nutzt S, $, h(), fill(), api(), icon(), setField(), trk*() usw. aus den anderen Dateien (nur zur Laufzeit). */

const CV = {tab: 'dest', gsel: {}, reviewed: new Set(), inh: {}, open: new Set(), unfold: new Set(), pop: null, qOpen: false, groups: [], bad: [], names: {}};

// ---------- Hilfen ----------
// Feld der Oberfläche setzen und die übliche Verarbeitung auslösen (Speichern, Vorschau, Neuzeichnen)
function cvSet(id, v) { setField(id, v); $('#' + id).dispatchEvent(new Event('input', {bubbles: true})); }
function cvSelect(id, labels, aria) {
  const src = $('#' + id);
  const sel = h('select', {'aria-label': aria || id, onchange: ev => cvSet(id, ev.target.value)});
  [...src.options].forEach(o => sel.append(h('option', {value: o.value, disabled: o.disabled, selected: o.value === src.value}, (labels && labels[o.value]) || o.textContent)));
  return sel;
}
function cvCheck(id) {
  const src = $('#' + id);
  return h('input', {type: 'checkbox', checked: src.checked, onchange: ev => { src.checked = ev.target.checked; src.dispatchEvent(new Event('input', {bubbles: true})); }});
}
const CV_CODEC = {copy: 'Kopieren (Remux)', h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9'};
const CV_SRC_CODEC = {h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9', mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2', vc1: 'VC-1', wmv3: 'WMV', msmpeg4v3: 'MPEG-4'};
const CV_FORMAT = fmt => /matroska|webm/.test(fmt || '') ? 'MKV' : /mp4|mov/.test(fmt || '') ? 'MP4' : /avi/.test(fmt || '') ? 'AVI' : /mpegts/.test(fmt || '') ? 'TS' : /flv/.test(fmt || '') ? 'FLV' : (fmt || '?').split(',')[0].toUpperCase();
const CV_AFMT = {mp3: 'MP3', ogg: 'Ogg Vorbis', opus: 'Opus', m4a: 'AAC (M4A)', flac: 'FLAC', wav: 'WAV'};
const CV_ACODEC = {mp3: 'MP3', vorbis: 'Vorbis', opus: 'Opus', aac: 'AAC', alac: 'ALAC', flac: 'FLAC', wma: 'WMA', wmav2: 'WMA', ac3: 'AC-3', pcm_s16le: 'WAV', pcm_s24le: 'WAV', pcm_s32le: 'WAV'};
const cvVideoStream = info => (info.streams || []).find(s => s.type === 'video' && !s.attachedPic);
const cvKbps = n => n ? Math.round(n / 1000) + ' kbit/s' : '';
function cvVideoDesc(info) {
  const v = cvVideoStream(info); if (!v) return 'kein Video';
  return [CV_SRC_CODEC[v.codec] || (v.codec || '?').toUpperCase(), v.height ? v.height + 'p' : '', v.bitDepth ? v.bitDepth + ' Bit' : ''].filter(Boolean).join(' · ');
}
function cvBitrate(info) { const v = cvVideoStream(info); const b = (v && v.bitRate) || (info.bitRate && info.bitRate > 0 ? info.bitRate : 0); return b ? (b >= 1e6 ? (b / 1e6).toFixed(1).replace('.', ',') + ' Mbit/s' : Math.round(b / 1000) + ' kbit/s') : 'unbekannt'; }
const cvTrackName = r => langName(r.lang) + ' · ' + trkDesc(r.s);
const cvSigText = info => { const g = TP.signature(info); return 'Ton: ' + (g.audio.map(l => l === 'und' ? '?' : langName(l)).join(', ') || 'keiner') + ' · Untertitel: ' + (g.sub.map(l => l === 'und' ? '?' : langName(l)).join(', ') || 'keine'); };

// ---------- Aufbau: welche Teile sind sichtbar? ----------
// Audio: Dateien, Satz und Tabelle in einer Ansicht. Video: vier Schritte; die Dateien (1), Regeln (2), Kacheln „Wie umwandeln?“ (3) und die Tabelle (4) teilen sich den Platz.
function cvLayout() {
  const conv = S.step === 'convert', video = S.world === 'video', st = S.vstep, show = (id, on) => { const e = $('#' + id); if (e) e.classList.toggle('hidden', !on); };
  show('cvStepper', conv && video); show('cvHead', conv && video);
  show('cvFiles', conv && (!video || st === 1));
  show('cvRules', conv && video && st === 2); show('cvHow', conv && video && st === 3);
  show('cvSentence', conv && !video); show('cvTable', conv && (!video || st === 4));
  show('presetBar', conv && (!video || st === 1));
  show('scanFolder', conv && video); show('cvScan', conv && video && st === 1 && !!LIBUI.id);
  $('#aPresets').classList.toggle('hidden', video); $('#vPresets').classList.toggle('hidden', !video);
  show('wizNav', conv && video && st < 4); show('stepnav', conv && (!video || st === 4));
}
// Schrittleiste oben: 1 Dateien · 2 Regeln · 3 Wie umwandeln? · 4 Kontrolle & Start (am Handy nur der aktuelle Schritt beschriftet)
function cvStepper() {
  const n = S.files.video.length;
  fill($('#cvStepper'), VSTEPS.map(([id, name], i) => {
    const k = i + 1, cls = k === S.vstep ? 'on' : k < S.vstep ? 'done' : '';
    return [i ? h('span', {class: 'sep'}) : null, h('button', {type: 'button', class: 'stp ' + cls, 'data-step': id, 'aria-current': k === S.vstep ? 'step' : null, disabled: k > 1 && !n,
      title: k > 1 && !n ? 'Zuerst Dateien wählen' : name, onclick: () => vGo(k)}, h('i', {}, k < S.vstep ? icon('check') : String(k)), h('span', {class: 'stn'}, name))];
  }));
}
const CV_HEADS = [
  ['Dateien wählen', 'Wähle zuerst den Quellordner, darin werden auch alle Unterordner durchsucht. Oder nimm eine Voreinstellung: dann geht es gleich zur Kontrolle.', 'stepFiles'],
  ['Regeln', 'Was soll mit Tonspuren und Untertiteln allgemein passieren? Die voreingestellten Regeln gelten schon, jede lässt sich für diesen Lauf abwählen.', 'stepRules'],
  ['Wie soll umgewandelt werden?', 'Hardware, Speicherort und Kontrolle. Alles lässt sich in der Kontrolle noch genauer einstellen.', 'stepHow'],
  ['Kontrolle & Start', 'Links, wie die Dateien jetzt sind, rechts, was herauskommt. Jede Zeile lässt sich ändern.', 'stepCheck'],
];
function cvHeadRender() {
  const [t, sub, key] = CV_HEADS[S.vstep - 1];
  fill($('#cvHead'), h('h1', {}, t, infoBtn(key)), h('p', {class: 'muted'}, sub));
}

// ---------- Fenster „Details“ (die früheren Schritte: Ziel, Benennen, Video, Spuren, Prüfen) ----------
function cvWorldVis() {
  $$('#detailsDlg [data-world]:not(.dsec)').forEach(el => el.classList.toggle('hidden', el.dataset.world !== S.world));
  const tv = $('#dtabVideo'); if (tv) tv.textContent = S.world === 'video' ? 'Video' : 'Audio-Einstellungen';
}
function detailsTabs() {
  $$('#detailsTabs button').forEach(b => b.classList.toggle('on', b.dataset.dtab === CV.tab));
  $$('#detailsBody .dsec').forEach(sec => sec.classList.toggle('hidden', sec.dataset.dsec !== CV.tab || !!(sec.dataset.world && sec.dataset.world !== S.world)));
}
function openSheet(tab) {
  const dlg = $('#detailsDlg');
  if (tab) CV.tab = tab;
  if (CV.tab === 'tracks' && S.world !== 'video') CV.tab = 'dest';
  cvClosePop(); cvWorldVis(); detailsTabs();
  if (!dlg.open) dlg.showModal();
  if (CV.tab === 'tracks') trkRender();
  if (CV.tab === 'dest') syncNameUI();
  if (CV.tab === 'video') { refreshAudioUI(); refreshVideoUI(); }
  vfUI(); existsUI();
}

// ---------- kleine Fenster am Satz (Popover) ----------
function cvClosePop() {
  if (!CV.pop) return;
  CV.pop.el.remove(); document.removeEventListener('pointerdown', cvPopOutside, true); document.removeEventListener('keydown', cvPopKey, true); CV.pop = null;
}
const cvPopOutside = e => { if (CV.pop && !CV.pop.el.contains(e.target) && !CV.pop.anchor.contains(e.target) && !e.target.closest('dialog')) cvClosePop(); };
const cvPopKey = e => { if (e.key === 'Escape') cvClosePop(); };
function cvPopFill() {
  if (!CV.pop) return;
  const b = CV.pop.el.querySelector('.cvpop-b'), a = document.activeElement;
  if (b.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox') return; // nicht mitten im Tippen neu bauen
  fill(b, CV.pop.build());
}
function cvPopPlace() {
  const el = CV.pop.el;
  if (matchMedia('(max-width:700px)').matches) { el.style.left = el.style.top = ''; return; } // Handy: als Blatt unten (CSS)
  const r = CV.pop.anchor.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  const below = r.bottom + 8, top = below + hh > innerHeight - 8 ? Math.max(8, r.top - hh - 8) : below;
  el.style.top = top + 'px';
}
function cvPop(anchor, title, build) {
  if (CV.pop && CV.pop.anchor === anchor) { cvClosePop(); return; }
  cvClosePop();
  const el = h('div', {class: 'cvpop', role: 'dialog', 'aria-label': title}, h('div', {class: 'cvpop-h'}, h('b', {}, title), h('button', {type: 'button', class: 'small ghost', 'aria-label': 'Schließen', onclick: cvClosePop}, '✕')), h('div', {class: 'cvpop-b'}));
  document.body.append(el);
  CV.pop = {el, anchor, build};
  cvPopFill(); cvPopPlace();
  document.addEventListener('pointerdown', cvPopOutside, true); document.addEventListener('keydown', cvPopKey, true);
}
const tok = (text, onclick, cls, title) => h('button', {type: 'button', class: 'tok' + (cls ? ' ' + cls : ''), title: title || null, onclick: ev => onclick(ev.currentTarget)}, text);

// Hardware
function cvHwText() {
  const r = resolveBackend(), codec = $('#vCodec').value, caps = backendCaps(r.id), ok = r.id === 'cpu' || (caps && caps.codecs && caps.codecs[codec]);
  return (r.auto ? 'Automatisch: ' : '') + (BACKEND_FULL[r.id] || r.id) + (ok && r.id !== 'cpu' ? ' ✓' : '');
}
function popHW() {
  const r = resolveBackend(), codec = $('#vCodec').value, hw = r.id !== 'cpu' && codec !== 'copy';
  return [h('label', {}, h('span', {class: 'lt'}, 'Encoder / Hardware'), cvSelect('vBackend', null, 'Encoder')),
    h('div', {class: 'muted small'}, 'Wird verwendet: ', h('b', {}, encoderName(r.id, codec)), ' · ', BACKEND_FULL[r.id] || r.id, r.pref ? ' (bevorzugt laut Einstellungen)' : ''),
    hw ? h('label', {class: 'check'}, cvCheck('vHwDec'), h('span', {}, 'Hardware-Decoding nutzen (fällt bei Fehler automatisch zurück)')) : null,
    h('div', {class: 'muted small'}, 'Mehr zur Hardware: Startseite oder Einstellungen → Hardware.')];
}
// Ziel
function cvDestText() {
  const custom = $('#outMode').value === 'custom', dir = $('#outDir').value.trim();
  return custom ? (dir ? 'Ordner ' + pathLabel(dir).split(/[\\/]/).filter(Boolean).slice(-2).join('/') : 'eigenem Ordner (fehlt noch)') : 'neben der Quelle';
}
function popDest() {
  const custom = $('#outMode').value === 'custom';
  return [h('label', {}, h('span', {class: 'lt'}, 'Speicherort'), cvSelect('outMode', null, 'Speicherort')),
    custom ? h('label', {}, h('span', {class: 'lt'}, 'Ordner'), h('div', {class: 'row'}, h('input', {value: $('#outDir').value, placeholder: '/output', onchange: ev => cvSet('outDir', ev.target.value.trim())}),
      h('button', {type: 'button', class: 'small', onclick: async () => { const r = await openBrowser('dir', $('#outDir').value); if (r) cvSet('outDir', r.dir); }}, '…'))) : null,
    custom ? h('label', {}, h('span', {class: 'lt'}, 'Struktur'), cvSelect('outStruct', null, 'Struktur')) : null,
    h('label', {}, h('span', {class: 'lt'}, 'Wenn Datei existiert'), cvSelect('exists', null, 'Wenn Datei existiert'), h('span', {class: 'small ' + ($('#exists').value === 'overwrite' ? 'warn' : 'muted')}, EXISTS_HINT[$('#exists').value] || ''))];
}
// Prüfen
function cvCheckText() {
  const t = $('#vfTracks').checked, d = $('#vfDecode').checked, del = $('#deleteSource').checked;
  const what = t && d ? 'Spuren und Decode-Test' : t ? 'Spuren' : d ? 'Decode-Test' : 'nur Grundprüfung';
  return what + (del ? ', Original löschen' : '');
}
function popCheck() {
  const w = S.world;
  return [h('p', {class: 'muted small', style: 'margin:0'}, 'Nach dem Umwandeln wird die neue Datei immer auf Lesbarkeit und Laufzeit geprüft. Mehr dazu:'),
    h('label', {class: 'check'}, cvCheck('vfTracks'), h('span', {}, 'Spuren & Größe prüfen')), h('div', {class: 'vfhint'}, vfTimeEl(w, 'tracks')),
    h('label', {class: 'check'}, cvCheck('vfDecode'), h('span', {}, 'Ergebnis komplett durchlesen (Decode-Test)')), h('div', {class: 'vfhint'}, vfTimeEl(w, 'decode')),
    h('label', {class: 'check'}, cvCheck('deleteSource'), h('span', {}, 'Quelldatei nach bestandener Prüfung löschen')),
    h('div', {class: 'vfhint warn'}, 'Unwiderruflich: kein Papierkorb.')];
}

// ---------- Dateien ----------
// Quellordner (die Wurzeln aus den Einstellungen bzw. dem Template, mit Anzeigenamen): ein Klick öffnet den Datei-Browser direkt dort, die Suche durchsucht immer auch Unterordner
function cvRootButtons() {
  const roots = (S.info && S.info.roots) || [];
  fill($('#rootBtns'), roots.length ? [h('span', {class: 'muted small'}, 'Quellordner:'), roots.map(r => h('button', {type: 'button', class: 'rootbtn', title: r, onclick: () => pickFrom(r)},
    icon('folder'), h('span', {class: 'rbn'}, rootNameOf(r) || r.split(/[\\/]/).filter(Boolean).pop() || r), rootNameOf(r) ? h('small', {class: 'muted'}, r) : null))] : null);
}
function cvFilesPanel(files) {
  renderFileList(); cvRootButtons();
  const tot = files.reduce((a, f) => a + (f.size || 0), 0);
  fill($('#fileSummary'), files.length ? [h('b', {}, files.length + (files.length === 1 ? ' Datei' : ' Dateien')), ' · ' + fmtSize(tot)] : 'Noch keine Dateien');
  $('#cvFileDetails').classList.toggle('hidden', !files.length);
}

// ---------- Der Satz ----------
function cvSentence(files) {
  const n = files.length, copy = S.world === 'video' && $('#vCodec').value === 'copy';
  const parts = [h('span', {}, n ? (n === 1 ? 'Diese Datei wird ' : n + ' Dateien werden ') : 'Die Dateien werden ')];
  if (S.world === 'video') {
    parts.push(copy ? h('span', {}, 'neu verpackt (Video wird nicht neu kodiert)') : h('span', {}, 'mit ', tok(cvHwText(), a => cvPop(a, 'Hardware', popHW), '', 'Encoder und Hardware ändern'), ' umgewandelt'));
  } else parts.push(h('span', {}, 'umgewandelt'));
  parts.push(h('span', {}, ', gespeichert '), tok(cvDestText(), a => cvPop(a, 'Ziel', popDest), $('#outMode').value === 'custom' && !$('#outDir').value.trim() ? 'warnt' : '', 'Zielordner und „Wenn Datei existiert“'),
    h('span', {}, ' und danach geprüft: '), tok(cvCheckText(), a => cvPop(a, 'Prüfen', popCheck), $('#deleteSource').checked ? 'warnt' : '', 'Kontrolle nach dem Umwandeln'), h('span', {}, '.'));
  fill($('#cvSentence'), h('div', {class: 'cvsent'}, parts));
}

// ---------- Qualität (Stufen) ----------
function qualityControl(compact) {
  const c = qCurrent(), st = $('#vQuality').value, scale = Q.scaleName(c.backend);
  const seg = h('div', {class: 'qseg', role: 'radiogroup', 'aria-label': 'Qualität'}, Q.STAGES.map(([id, name, sub]) => h('button', {type: 'button', role: 'radio', 'aria-checked': st === id ? 'true' : 'false',
    class: 'qs' + (st === id ? ' on' : ''), onclick: () => qSetStage(id)}, h('b', {}, name), h('small', {}, sub))));
  const out = h('output', {}, $('#vCrf').value);
  const adv = CV.qOpen ? h('div', {class: 'qadv'}, h('label', {class: 'qsl'}, h('span', {}, scale + ' '), out,
    h('input', {type: 'range', min: 10, max: 40, value: $('#vCrf').value, 'aria-label': scale, oninput: ev => { out.textContent = ev.target.value; }, onchange: ev => cvSet('vCrf', ev.target.value)})),
    h('div', {class: 'muted small'}, 'Niedriger = bessere Qualität, größere Datei. ' + (Q.SCALE_HELP[scale] || '') + '. Die Zahl gilt nur für diesen Encoder.')) : null;
  return h('div', {class: 'qctl'}, seg,
    h('div', {class: 'qline muted small'}, st === 'custom' ? 'Eigener Wert · ' : '', scale + ' ' + $('#vCrf').value, ' · ', encoderName(c.backend, c.codec),
      ' · ', h('button', {type: 'button', class: 'linkbtn', onclick: () => { CV.qOpen = !CV.qOpen; renderQualityControls(); cvRender(); }}, CV.qOpen ? 'Regler ausblenden ▴' : 'Erweitert ▾')),
    adv);
}
function renderQualityControls() { const m = $('#vQualityMount'); if (m) fill(m, qualityControl(true)); }

// ---------- Zeilen der Tabelle ----------
function cvRow(label, before, after, o) {
  o = o || {};
  return h('div', {class: 'cvr' + (o.cls ? ' ' + o.cls : ''), role: 'row'},
    h('div', {class: 'cvk', role: 'rowheader'}, label, o.info ? infoBtn(o.info) : null),
    h('div', {class: 'cvb'}, before),
    h('div', {class: 'cva', 'aria-hidden': 'true'}, '→'),
    h('div', {class: 'cvn' + (o.ai ? ' aib' : '')}, after),
    o.extra ? h('div', {class: 'cvx'}, o.extra) : null);
}
// eine Änderung an der n-ten Spur für ALLE Dateien der Gruppe (gleiche Rahmendaten: die n-te Tonspur ist überall die n-te Tonspur)
function cvEach(g, ord, fn) {
  g.items.forEach(it => { const s = TP.atOrdinal(it.info, ord); if (s) { fn(it, s); delete CV.inh[it.f.path + '#' + s.index]; } });
  cvRender();
}
function cvSetKind(g, ord, want, type) {
  cvEach(g, ord, (it, s) => {
    const a0 = trkPlanAuto(it.info).tracks.find(x => x.index === s.index);
    const autoKind = !a0 || !a0.kept ? 'drop' : (type === 'audio' && a0.action === 'encode') ? 'encode' : 'copy';
    trkSet(it.f, s.index, want === autoKind ? {action: undefined, codec: undefined, kbps: undefined} : {action: want, codec: undefined, kbps: undefined});
  });
}
const cvKind = r => !r.kept ? 'drop' : (r.type === 'audio' && r.action === 'encode') ? 'encode' : 'copy';

function cvReasons(g, ex, r) {
  const out = [], key = ex.f.path + '#' + r.index, edit = trkEdit(ex.f, r.index);
  if (CV.inh[key] && Object.keys(edit).length) out.push({kind: 'inherit', text: 'Übernommen aus ' + CV.inh[key] + ': dort wurde dieselbe Spur schon kontrolliert.', undo: () => {
    g.items.forEach(it => { Object.keys(it.f.tracks || {}).forEach(k => { if (CV.inh[it.f.path + '#' + k]) { trkSet(it.f, +k, {action: undefined, codec: undefined, kbps: undefined, forced: undefined, default: undefined, title: undefined, lang: undefined}); delete CV.inh[it.f.path + '#' + k]; } }); });
    cvRender(); }});
  const ord = TP.ordinal(ex.info, r.index);
  TP.autoReasons(r).forEach(a => {
    if ((a.kind === 'rule' || a.kind === 'lang') && r.own) return; // eigene Entscheidung gilt
    const undo = {
      rule: () => cvSetKind(g, ord, 'copy', r.type), lang: () => cvSetKind(g, ord, 'copy', r.type),
      default: () => cvEach(g, ord, (it, s) => trkSet(it.f, s.index, {default: false})),
      forced: () => cvEach(g, ord, (it, s) => trkSet(it.f, s.index, {forced: false})),
    }[a.kind];
    const text = {rule: a.text.replace(/^Regel: /, 'Regel „') + '“ angewendet', lang: 'Sprache nicht in deiner Liste – wird entfernt', default: 'Standard-Spur nach deiner Rangliste',
      forced: 'Als Forced erkannt: ' + a.text.replace(/^Wahrscheinlich Forced \(/, '').replace(/\)$/, '') + '. Passt zu deinem Wunsch.'}[a.kind];
    out.push({kind: a.kind, text, undo});
  });
  if (r.kept && r.type === 'subtitle' && r.guess) out.push({kind: 'suggest', text: `Vorschlag: nur ${r.guess.n} statt ${r.guess.of} ${r.guess.unit} – wahrscheinlich ein Forced-Untertitel (erzwungene Untertitel).`, apply: 'Als Forced markieren',
    do: () => cvEach(g, ord, (it, s) => trkSet(it.f, s.index, {forced: true}))});
  return out;
}
function cvAiBlock(reasons) {
  return reasons.map(a => h('div', {class: 'cvai'}, h('span', {class: 'ai'}, h('i', {}, icon('news')), a.kind === 'suggest' ? ' Vorschlag' : a.kind === 'inherit' ? ' Übernommen' : ' Automatisch'), h('span', {class: 'cvwhy'}, a.text),
    h('button', {type: 'button', class: 'small', onclick: a.kind === 'suggest' ? a.do : a.undo}, a.kind === 'suggest' ? a.apply : 'rückgängig')));
}

// Format und Bitrate einer umzuwandelnden Tonspur (im Fenster am Ziel und im Editor „⋯“)
function cvEncFields(g, ord, r) {
  const e = trkEncInfo(r);
  return h('div', {class: 'cvencf'}, h('div', {class: 'trkgrid'},
    h('label', {}, h('span', {class: 'lt'}, 'Format'), h('select', {'aria-label': 'Zielformat', onchange: ev => { const c = ev.target.value; cvEach(g, ord, (it, t) => trkSet(it.f, t.index, {action: 'encode', codec: c, kbps: REC_KBPS[c]})); }},
      Object.keys(REC_NAME).map(c => h('option', {value: c, selected: c === e.c}, REC_NAME[c])))),
    e.c !== 'flac' ? h('label', {}, h('span', {class: 'lt'}, 'Bitrate je Stereo-Paar (kbit/s)'), h('input', {type: 'number', min: 32, max: 640, value: e.per, 'aria-label': 'Bitrate je Stereo-Paar',
      onchange: ev => { const k = +ev.target.value; ev.target.blur(); cvEach(g, ord, (it, t) => trkSet(it.f, t.index, {action: 'encode', kbps: k > 0 ? k : undefined, codec: trkEdit(it.f, t.index).codec || e.c})); }})) : null),
    h('p', {class: 'muted small' + (e.capped ? ' cap' : '')}, trkEncExplain(r)));
}
// kleines Fenster am Ziel „→ E-AC-3 … 640 kbit/s“: wird bei jeder Änderung neu aufgebaut, deshalb sucht es seine Spur jedes Mal neu
function popEnc(gkey, ord) {
  const g = CV.groups.find(x => x.key === gkey), ex = g && g.items[0], s = ex && TP.atOrdinal(ex.info, ord), r = s && ex.plan.tracks.find(x => x.index === s.index);
  if (!r || !r.kept || r.action !== 'encode') return [h('p', {class: 'muted small'}, 'Diese Spur wird nicht mehr umgewandelt.')];
  return [cvEncFields(g, ord, r), isLossless(r.s) ? h('p', {class: 'small warn'}, 'Diese Spur ist verlustfrei. Beim Kleinermachen geht ein Teil der Qualität unwiderruflich verloren; „unverändert“ ist verlustfrei und am schnellsten.') : null];
}

function cvTrackEditor(g, ex, r, ord) {
  const s = r.s, e = trkEdit(ex.f, s.index), isA = r.type === 'audio', enc = r.kept && r.action === 'encode' && isA;
  const val = e.lang !== undefined ? normLang(e.lang) : normLang(s.lang);
  const langSel = h('select', {'aria-label': 'Sprache', onchange: ev => { const v = ev.target.value; cvEach(g, ord, (it, t) => trkSet(it.f, t.index, {lang: v === normLang(t.lang) || (!v && noLang(t.lang)) ? undefined : v})); }},
    [h('option', {value: '', selected: noLang(val) && !val}, 'Unbekannt (keine Angabe)'), LANGS.map(([c, n]) => h('option', {value: c, selected: c === val}, n + ' (' + c + ')')),
      val && !LANGS.some(x => x[0] === val) && val !== 'und' ? h('option', {value: val, selected: true}, val.toUpperCase() + ' (' + val + ')') : null]);
  return h('div', {class: 'cved'}, h('div', {class: 'trkgrid'},
    h('label', {}, h('span', {class: 'lt'}, 'Titel (so heißt die Spur im Player)'), h('input', {value: e.title !== undefined ? e.title : (s.title || ''), placeholder: isA ? 'z. B. Deutsch 5.1' : 'z. B. Deutsch',
      onchange: ev => { const v = ev.target.value; cvEach(g, ord, (it, t) => trkSet(it.f, t.index, {title: v === (t.title || '') ? undefined : v})); }})),
    h('label', {}, h('span', {class: 'lt'}, 'Sprache'), langSel)),
    enc ? cvEncFields(g, ord, r) : null,
    enc && isLossless(s) ? h('p', {class: 'small warn'}, 'Diese Spur ist verlustfrei. Beim Kleinermachen geht ein Teil der Qualität unwiderruflich verloren; „unverändert“ ist verlustfrei und am schnellsten.') : null);
}

function cvTrackRow(g, ex, r, n) {
  const s = r.s, isA = r.type === 'audio', ord = TP.ordinal(ex.info, r.index), key = g.key + '#' + ord.type + ord.n, open = CV.open.has(key), kind = cvKind(r);
  const reasons = cvReasons(g, ex, r);
  const before = h('div', {}, h('div', {}, cvTrackName({lang: s.lang, s, type: r.type})),
    h('div', {class: 'muted small'}, [s.title ? '„' + s.title + '“' : null, s.default ? 'Standard' : null, s.forced ? 'Forced' : null, !isA && s.frames ? s.frames + ' Zeilen' : null].filter(Boolean).join(' · ') || 'Spur ' + s.index));
  const opts = isA ? [['copy', 'unverändert'], ['encode', 'umwandeln'], ['drop', 'entfernen']] : [['copy', 'behalten'], ['drop', 'entfernen']];
  const act = h('select', {class: 'cvact ' + kind, 'aria-label': (isA ? 'Ton ' : 'Untertitel ') + n + ': was passiert?', onchange: ev => cvSetKind(g, ord, ev.target.value, r.type)},
    opts.map(([v, t]) => h('option', {value: v, selected: v === kind}, t)));
  const flags = [];
  if (r.kept) {
    if (!isA) flags.push(h('button', {type: 'button', class: 'cvflag' + (r.forced ? ' on' : ''), 'aria-pressed': r.forced ? 'true' : 'false', title: 'Forced = erzwungene Untertitel, werden nur bei fremdsprachigen Stellen gezeigt',
      onclick: () => { const want = !r.forced; cvEach(g, ord, (it, t) => trkSet(it.f, t.index, {forced: want === !!t.forced ? undefined : want})); }}, 'Forced'));
    flags.push(h('button', {type: 'button', class: 'cvflag' + (r.def ? ' on' : ''), 'aria-pressed': r.def ? 'true' : 'false', title: 'Diese Spur startet der Player automatisch',
      onclick: () => {
        if (isA) cvEach(g, ord, (it, t) => trkToggleAudioDefault(it.f, it.info, t.index));
        else { const want = !r.def; cvEach(g, ord, (it, t) => trkSet(it.f, t.index, {default: want === !!t.default ? undefined : want})); }
      }}, 'Standard'));
  }
  const after = h('div', {class: 'cvafter'}, act, kind === 'encode' ? h('button', {type: 'button', class: 'cvenc', title: 'Zielformat und Bitrate ändern', onclick: ev => cvPop(ev.currentTarget, 'Ton ' + n + ' umwandeln', () => popEnc(g.key, ord)) }, '→ ' + trkTargetDesc(r) + ' ▾') : null, flags,
    h('button', {type: 'button', class: 'cvmore', 'aria-expanded': open ? 'true' : 'false', title: 'Titel, Sprache und Format ändern', onclick: () => { open ? CV.open.delete(key) : CV.open.add(key); cvRender(); }}, open ? '▴' : '⋯'));
  const noLg = r.kept && noLang(r.lang);
  const extra = [cvAiBlock(reasons),
    noLg ? h('div', {class: 'cvwarn small'}, icon('warn'), ' Die Sprache fehlt. Ohne Sprache ordnet Plex die Spur nicht richtig zu. ', h('button', {type: 'button', class: 'small', onclick: () => { CV.open.add(key); cvRender(); }}, 'Sprache festlegen')) : null,
    open ? cvTrackEditor(g, ex, r, ord) : null];
  return cvRow((isA ? 'Ton ' : 'Untertitel ') + n, before, after, {ai: reasons.length > 0, cls: (!r.kept ? 'dropped ' : '') + (reasons.length ? 'hasai' : ''), extra: extra.flat().filter(Boolean).length ? extra : null, info: n === 1 ? (isA ? 'rowAudio' : 'rowSub') : null});
}

// Dateiname: Beispiel für die erste Datei der Gruppe (vom Server berechnet)
// Alle neuen Dateinamen einzeilig („alt → neu“), nur wenn tatsächlich umbenannt wird; Vorschau vom Server in einer Anfrage für alle Dateien
function cvNameList(files) {
  const pat = $('#pattern').value.trim(), rules = cleanRules(nameRules()), suf = $('#suffix').value;
  if (!files.length || (!pat && !rules.length && !suf)) return null;
  const target = S.world === 'video' ? {codec: $('#vCodec').value, height: +$('#vHeight').value, bitDepth: +$('#vDepth').value, container: $('#vContainer').value} : {container: outExt()};
  const body = {items: files.map(f => f.path), pattern: pat, replace: rules, suffix: suf, ext: outExt(), mode: 'convert', target}, k = 'L' + JSON.stringify(body);
  const box = h('div', {class: 'cvnamelist', 'aria-label': 'Neue Dateinamen'});
  const paint = items => {
    const seen = {}; items.forEach(x => { if (!x.error) seen[x.new.toLowerCase()] = (seen[x.new.toLowerCase()] || 0) + 1; });
    const bad = items.filter(x => x.error || seen[x.new.toLowerCase()] > 1).length;
    fill(box, h('div', {class: 'cvnlh muted small'}, items.length + (items.length === 1 ? ' Datei' : ' Dateien') + ' bekommen einen neuen Namen' + (bad ? ' · ' : ''), bad ? h('span', {class: 'bad'}, bad + (bad === 1 ? ' Problem' : ' Probleme')) : null),
      items.map(x => { const dup = !x.error && seen[x.new.toLowerCase()] > 1;
        return h('div', {class: 'cvnl' + (x.error || dup ? ' bad' : '')}, h('span', {class: 'o', title: x.old}, x.old), h('span', {class: 'ar'}, '→'),
          h('span', {class: 'n', title: x.error ? x.error : x.new}, x.error ? x.error : x.new + (dup ? ' (doppelt!)' : ''))); }));
  };
  if (CV.names[k]) paint(CV.names[k]);
  else { fill(box, h('div', {class: 'cvnlh muted small'}, 'Namen werden berechnet …')); api('/api/rename/preview', body).then(r => { CV.names[k] = r.items || []; paint(CV.names[k]); }).catch(() => fill(box, h('div', {class: 'cvnlh bad small'}, 'Vorschau nicht möglich'))); }
  return box;
}
function cvNameCell(ex) {
  const pat = $('#pattern').value.trim(), rules = cleanRules(nameRules()), suf = $('#suffix').value, plain = !pat && !rules.length && !suf;
  const span = h('span', {class: 'cvname'}, plain ? 'bleibt' : '…');
  if (!plain) {
    const target = S.world === 'video' ? {codec: $('#vCodec').value, height: +$('#vHeight').value, bitDepth: +$('#vDepth').value, container: $('#vContainer').value} : {container: outExt()};
    const body = {items: [ex.f.path], pattern: pat, replace: rules, suffix: suf, ext: outExt(), mode: 'convert', target}, k = JSON.stringify(body);
    if (CV.names[k]) span.textContent = CV.names[k];
    else api('/api/rename/preview', body).then(r => { const x = r.items[0]; CV.names[k] = x ? (x.error ? x.error : x.new) : ''; span.textContent = CV.names[k]; }).catch(() => { span.textContent = 'Vorschau nicht möglich'; });
  }
  return h('div', {class: 'cvafter'}, span, h('button', {type: 'button', class: 'small', onclick: () => openSheet('dest')}, 'ändern'));
}

// ---------- Gruppen ----------
function cvGroups(items) {
  const map = new Map();
  items.forEach(it => { const k = TP.frameKey(it.info); if (!map.has(k)) map.set(k, {key: k, items: []}); map.get(k).items.push(it); });
  const list = [...map.values()].sort((a, b) => b.items.length - a.items.length);
  list.forEach((g, i) => { g.n = i + 1; g.name = 'Gruppe ' + (i + 1); });
  return list;
}
const cvUnreviewed = () => (S.world === 'video' && CV.groups.length > 1) ? CV.groups.filter(g => !CV.reviewed.has(g.key)).length : 0;
function cvPropagate(src) {
  const ex = src.items[0], edits = ex.f.tracks || {};
  if (!Object.keys(edits).length) return 0;
  let n = 0;
  CV.groups.forEach(g2 => {
    if (g2 === src || CV.reviewed.has(g2.key)) return;
    g2.items.forEach(it => {
      Object.entries(TP.transferEdits(ex.info, edits, it.info)).forEach(([idx, e]) => {
        if (it.f.tracks && it.f.tracks[idx]) return; // eigene Entscheidung bleibt
        trkSet(it.f, +idx, e); CV.inh[it.f.path + '#' + idx] = src.name; n++;
      });
    });
  });
  return n;
}
function cvReview(g) {
  CV.reviewed.add(g.key);
  const n = cvPropagate(g);
  toast(n ? `${g.name} kontrolliert. Ihre Entscheidungen wurden bei ${n} gleichen Spuren anderer Gruppen übernommen (als „Übernommen“ markiert).` : `${g.name} kontrolliert.`, 'ok');
  cvRender();
}

// Hinweise oberhalb der Tabelle
function cvWarnings(files, g, items) {
  const w = [];
  if ($('#outMode').value === 'custom' && !$('#outDir').value.trim()) w.push('Es ist kein Zielordner angegeben.');
  if ($('#deleteSource').checked) w.push('Die Quelldateien werden nach bestandener Prüfung sofort und endgültig GELÖSCHT.');
  if ($('#exists').value === 'overwrite') w.push('Vorhandene Zieldateien werden überschrieben.');
  if (CV.bad.length) w.push(CV.bad.length + (CV.bad.length === 1 ? ' Datei ließ sich nicht lesen' : ' Dateien ließen sich nicht lesen') + ' (' + CV.bad.slice(0, 2).map(fileLabel).join(', ') + (CV.bad.length > 2 ? ' …' : '') + '). Sie werden trotzdem versucht, ohne Spurauswahl.');
  if (g) {
    const ex = g.items[0];
    trkWarnings(ex.f, ex.info, ex.plan).forEach(x => w.push(x));
    if (ex.plan.guard.audio) w.push('In ' + g.name.replace('Gruppe', 'Gruppe') + ' gibt es keine der Tonsprachen aus deiner Liste. Deshalb wurde dort nichts entfernt.');
    if (ex.plan.guard.sub) w.push('In ' + g.name + ' gibt es keine der Untertitelsprachen aus deiner Liste. Deshalb wurden dort keine Untertitel entfernt.');
  }
  return w.length ? h('div', {class: 'banner warn'}, w.map(x => h('div', {}, icon('warn'), ' ' + x))) : null;
}

// ---------- Karten der Kontrolle (Video, Audio, Untertitel, Dateiname) ----------
// Jedes Thema ist eine eigene Karte mit Kopf (Symbol, Titel, Kurzfassung) und den Zeilen „Vorher → Nachher“. Video, Untertitel und Name sind grün, Audio ist orange.
function cvCardHead(ico, title, info, summary) {
  return h('div', {class: 'cvchead'}, h('span', {class: 'cvico'}, icon(ico)), h('h2', {}, title, info ? infoBtn(info) : null), summary ? h('span', {class: 'cvsum muted small'}, summary) : null);
}
function cvCard(cls, ico, title, info, summary, rows) {
  return h('section', {class: 'cvcard sec-' + cls + (cls === 'audio' ? ' hue-audio' : ''), 'data-card': cls}, cvCardHead(ico, title, info, summary), h('div', {class: 'cvgrid', role: 'table', 'aria-label': title}, rows));
}
const cvColHead = () => h('div', {class: 'cvcols', role: 'row'}, h('div', {}, ''), h('div', {}, 'Vorher (Quelle)'), h('div', {}), h('div', {}, 'Nachher (Ergebnis)'));

function cvVideoTable(items) {
  const groups = CV.groups = cvGroups(items);
  CV.gsel.video = (groups.find(x => x.key === CV.gsel.video) || groups[0] || {}).key;
  items.forEach(it => { it.plan = trkPlan(it.f, it.info); });
  const g = groups.find(x => x.key === CV.gsel.video), ex = g.items[0], copy = $('#vCodec').value === 'copy';
  const strip = groups.length > 1 ? h('div', {class: 'cvgroups', role: 'tablist', 'aria-label': 'Gruppen'}, groups.map(x => {
    const rev = CV.reviewed.has(x.key);
    return h('button', {type: 'button', role: 'tab', 'aria-selected': x.key === g.key ? 'true' : 'false', class: 'cvg' + (x.key === g.key ? ' on' : '') + (rev ? ' rev' : ' todo'), title: cvSigText(x.items[0].info),
      onclick: () => { CV.gsel.video = x.key; cvRender(); }}, h('span', {class: 'cvgt'}, h('b', {}, x.name), ' · ' + x.items.length + (x.items.length === 1 ? ' Datei' : ' Dateien')),
      h('span', {class: 'cvgs'}, rev ? '✓ kontrolliert' : 'noch nicht kontrolliert'));
  })) : null;
  const gline = groups.length > 1 ? h('div', {class: 'cvgline'}, h('span', {class: 'muted small'}, g.name + ': ' + cvSigText(ex.info) + (g.n > 1 ? ' – anders aufgebaut als ' + groups[0].name + ', bitte prüfen.' : ''), infoBtn('groups')),
    CV.reviewed.has(g.key) ? h('span', {class: 'chip ok'}, '✓ kontrolliert') : h('button', {type: 'button', class: 'primary small', onclick: () => cvReview(g)}, '✓ ' + g.name + ' ist kontrolliert')) : null;

  const vRows = [], aRows = [], sRows = [];
  // Video
  const vsrc = cvVideoStream(ex.info), vch = copy ? false : (vsrc && (CV_SRC_CODEC[vsrc.codec] || '').toLowerCase().replace(/[. ]/g, '') !== (CV_CODEC[$('#vCodec').value] || '').toLowerCase().replace(/[. ]/g, ''));
  vRows.push(cvRow('Video', cvVideoDesc(ex.info), h('div', {class: 'cvafter'}, cvSelect('vCodec', CV_CODEC, 'Video-Codec'), copy ? h('span', {class: 'muted small'}, 'Bild wird nicht neu kodiert') : [cvSelect('vHeight', {0: 'Auflösung wie Quelle'}, 'Auflösung'), cvSelect('vDepth', null, 'Bit-Tiefe')]), {cls: vch ? 'chg' : '', info: 'rowVideo'}));
  vRows.push(cvRow('Container', CV_FORMAT(ex.info.format), h('div', {class: 'cvafter'}, cvSelect('vContainer', {mkv: 'MKV', mp4: 'MP4'}, 'Container')), {cls: CV_FORMAT(ex.info.format) !== $('#vContainer').value.toUpperCase() ? 'chg' : '', info: 'rowContainer'}));
  if (!copy) vRows.push(cvRow('Qualität', cvBitrate(ex.info), [qualityControl(false), cvLowHint(ex.info)], {cls: 'qrowc', info: 'rowQuality'}));
  // Ton und Untertitel
  const FOLD = 6;
  ['audio', 'subtitle'].forEach(type => {
    const rows = type === 'audio' ? aRows : sRows;
    const list = ex.plan.tracks.filter(r => r.type === type), foldKey = g.key + '#' + type, folded = list.length > FOLD && !CV.unfold.has(foldKey);
    (folded ? list.slice(0, FOLD) : list).forEach((r, i) => rows.push(cvTrackRow(g, ex, r, i + 1)));
    if (list.length > FOLD) rows.push(h('div', {class: 'cvmorerow'}, h('button', {type: 'button', class: 'small ghost', onclick: () => { folded ? CV.unfold.add(foldKey) : CV.unfold.delete(foldKey); cvRender(); }},
      folded ? (list.length - FOLD) + ' weitere ' + (type === 'audio' ? 'Tonspuren' : 'Untertitel') + ' anzeigen ▾' : 'Weniger anzeigen ▴')));
    if (!list.length) rows.push(cvRow(type === 'audio' ? 'Ton' : 'Untertitel', h('span', {class: 'muted'}, type === 'audio' ? 'keine Tonspur' : 'keine Untertitel'), h('span', {class: 'muted'}, '–')));
  });
  const nRows = [cvRow('Dateiname', fileLabel(ex.f), cvNameCell(ex), {info: 'rowName'}), cvNameList(S.files.video)].filter(Boolean);
  const sumOf = (type, one, many) => {
    const list = ex.plan.tracks.filter(r => r.type === type);
    if (!list.length) return 'keine ' + many;
    const enc = list.filter(r => r.kept && r.type === 'audio' && r.action === 'encode').length, drop = list.filter(r => !r.kept).length;
    return list.length + ' ' + (list.length === 1 ? one : many) + (enc ? ' · ' + enc + ' umgewandelt' : '') + (drop ? ' · ' + drop + ' entfernt' : '') + (!enc && !drop ? ' · bleiben unverändert' : '');
  };
  const vsum = copy ? 'Video wird nicht neu kodiert' : (vsrc ? (CV_SRC_CODEC[vsrc.codec] || (vsrc.codec || '?').toUpperCase()) : '?') + ' → ' + CV_CODEC[$('#vCodec').value];
  const plainName = !$('#pattern').value.trim() && !cleanRules(nameRules()).length && !$('#suffix').value;
  const hints = S.rulesSeen ? null : trkRuleSuggestions(items);
  return [strip, gline, cvWarnings(null, g, items), hints, cvLegend(), cvColHead(),
    cvCard('video', 'video', 'Video', 'cardVideo', vsum, vRows), cvCard('audio', 'wave', 'Audio', 'cardAudio', sumOf('audio', 'Tonspur', 'Tonspuren'), aRows),
    cvCard('subs', 'subs', 'Untertitel', 'cardSubs', sumOf('subtitle', 'Untertitel', 'Untertitel'), sRows), cvCard('name', 'file', 'Dateiname', 'cardName', plainName ? 'bleibt wie er ist' : 'wird angepasst', nRows)];
}
const cvLegend = () => h('div', {class: 'cvlegend muted small'}, h('span', {class: 'ai'}, h('i', {}, icon('news'))), ' = vom Programm automatisch erkannt oder angepasst', infoBtn('autoMark'), ' · jede Zeile lässt sich ändern · Einzelspuren und Namensmuster unter „Details“');
// Hinweis, wenn die Quelle schon klein ist: Neukodieren spart dann kaum Platz
function cvLowHint(info) {
  const v = cvVideoStream(info), br = (v && v.bitRate) || (info.bitRate > 0 ? info.bitRate : 0), height = v && v.height;
  if (!Q.lowBitrate(br, height)) return null;
  return h('div', {class: 'cvlow small'}, icon('warn'), ' Die Quelle ist schon klein (' + cvBitrate(info) + ' bei ' + height + 'p). Neu kodieren spart hier kaum Platz und kann die Datei sogar größer machen. Nimm besser „Normal“ oder „Klein“ oder lass das Video unverändert (Kopieren). Wird das Ergebnis nicht kleiner, bleibt dein Original in jedem Fall erhalten.');
}

// ---------- Tabelle Audio ----------
function cvAudioTable(items) {
  const ex = items[0], a = (ex.info.streams || []).find(s => s.type === 'audio'), pic = (ex.info.streams || []).some(s => s.attachedPic);
  const codecs = [...new Set(items.map(it => { const s = (it.info.streams || []).find(x => x.type === 'audio'); return s ? (CV_ACODEC[s.codec] || (s.codec || '?').toUpperCase()) : '?'; }))];
  const bef = x => { const s = (x.info.streams || []).find(q => q.type === 'audio'); return s ? [CV_ACODEC[s.codec] || (s.codec || '?').toUpperCase(), cvKbps(s.bitRate || x.info.bitRate)].filter(Boolean).join(' ') : '?'; };
  const f = $('#aFormat').value;
  const qual = [];
  if (!$('#aModeRow').classList.contains('hidden')) qual.push(cvSelect('aMode', null, 'Qualitätsmodus'));
  if (!$('#aQualityRow').classList.contains('hidden')) { const out = h('output', {}, $('#aQuality').value); qual.push(h('label', {class: 'qsl'}, h('span', {}, f === 'mp3' ? 'VBR V' : 'Qualität '), out, h('input', {type: 'range', min: $('#aQuality').min, max: $('#aQuality').max, value: $('#aQuality').value, 'aria-label': 'Qualität', oninput: ev => { out.textContent = ev.target.value; }, onchange: ev => cvSet('aQuality', ev.target.value)}), h('span', {class: 'muted small'}, f === 'mp3' ? ' (0 = beste)' : ' (10 = beste)'))); }
  if (!$('#aBitrateRow').classList.contains('hidden')) qual.push(cvSelect('aBitrate', null, 'Bitrate'));
  if (!$('#aFlacRow').classList.contains('hidden')) { const out = h('output', {}, $('#aFlac').value); qual.push(h('label', {class: 'qsl'}, h('span', {}, 'Kompression '), out, h('input', {type: 'range', min: $('#aFlac').min, max: $('#aFlac').max, value: $('#aFlac').value, 'aria-label': 'FLAC-Kompression', oninput: ev => { out.textContent = ev.target.value; }, onchange: ev => cvSet('aFlac', ev.target.value)}))); }
  if (!$('#aWavRow').classList.contains('hidden')) qual.push(cvSelect('aWav', null, 'Bit-Tiefe'));
  const rows = [
    cvRow('Format', items.length > 1 ? h('div', {}, codecs.join(', '), h('div', {class: 'muted small'}, items.length + ' Dateien')) : bef(ex), h('div', {class: 'cvafter'}, cvSelect('aFormat', null, 'Format')), {cls: codecs.length === 1 && codecs[0] === (CV_AFMT[f] || '').split(' ')[0] ? '' : 'chg', info: 'aFormat'}),
    qual.length ? cvRow('Qualität', items.length === 1 ? (cvKbps((((ex.info.streams || []).find(q => q.type === 'audio') || {}).bitRate) || ex.info.bitRate) || '–') : 'je Datei verschieden', h('div', {class: 'cvafter'}, qual), {cls: 'chg'}) : null,
    cvRow('Samplerate', a && a.sampleRate ? a.sampleRate / 1000 + ' kHz' : '?', h('div', {class: 'cvafter'}, cvSelect('aRate', null, 'Samplerate')), {info: 'aRate'}),
    cvRow('Kanäle', a ? chTxt(a.channels) || a.channels : '?', h('div', {class: 'cvafter'}, cvSelect('aCh', null, 'Kanäle')), {info: 'aCh'}),
    !$('#aCover').parentElement.classList.contains('hidden') ? cvRow('Cover-Bild', pic ? 'vorhanden' : 'keines', h('div', {class: 'cvafter'}, h('label', {class: 'check'}, cvCheck('aCover'), h('span', {}, 'übernehmen'))), {info: 'aCover'}) : null,
    cvRow('Dateiname', fileLabel(ex.f), cvNameCell(ex), {info: 'rowName'}),
    cvNameList(S.files.audio),
  ].filter(Boolean);
  return [cvWarnings(null, null, items), h('div', {class: 'cvlegend muted small'}, 'Jede Zeile lässt sich ändern · Tags (Titel, Interpret, Album …) werden immer übernommen · Namensmuster unter „Details“'),
    cvColHead(), cvCard('audio', 'audio', 'Audio-Datei', 'cardAudioFile', items.length === 1 ? 'Vorher → Nachher' : items.length + ' Dateien', rows)];
}

// ---------- Schritt 2: Regeln (nur Video) ----------
function cvRulesView(items) {
  S.rulesSeen = true;
  items.forEach(it => { it.plan = trkPlan(it.f, it.info); });
  const card = (cls, ico, title, info, body) => h('section', {class: 'cvcard sec-' + cls}, cvCardHead(ico, title, info), h('div', {class: 'cvcbody'}, body));
  const sug = trkRuleSuggestions(items);
  const r = trkRules();
  return [card('prefs', 'star', 'Meine Sprach-Wünsche', 'trkPrefs', trkPrefLine()),
    card('rules', 'shield', 'Voreingestellte Regeln', 'trkGlobal', trkGlobalRules(items, false)),
    sug,
    card('own', 'edit', 'Eigene Regeln für diesen Lauf', 'trkRules', [h('p', {class: 'muted small'}, 'Gelten nur jetzt (und in Voreinstellungen, die du speicherst). Sie laufen von oben nach unten, die erste passende Regel gewinnt; eigene Regeln gehen den voreingestellten voraus. Eigene Änderungen an einzelnen Spuren gehen immer vor.'),
      trkRulesBody(r, () => trkRulesSave(r), () => cvRender(), false)])];
}

// ---------- Schritt 3: Wie umwandeln? (Kacheln Hardware, Speichern, Danach prüfen) ----------
// Auswahl als Pillen: die Werte kommen aus den Optionen des versteckten Felds, geändert wird über cvSet (Speichern, Vorschau und Neuzeichnen laufen wie sonst)
function cvPills(id, labels, aria, onlyUsable) {
  const src = $('#' + id);
  return h('div', {class: 'pills', role: 'radiogroup', 'aria-label': aria || id}, [...src.options].filter(o => !(onlyUsable && o.disabled)).map(o => h('button', {type: 'button', role: 'radio', class: 'pill' + (o.value === src.value ? ' on' : ''), 'aria-checked': o.value === src.value ? 'true' : 'false',
    disabled: o.disabled, title: o.disabled ? 'Nicht nutzbar' : null, onclick: () => cvSet(id, o.value)}, (labels && labels[o.value]) || o.textContent.replace(/ ✓$/, ''))));
}
function cvTile(cls, ico, title, info, big, sub, body) {
  return h('section', {class: 'cvcard cvtile sec-' + cls, 'data-tile': cls}, cvCardHead(ico, title, info), h('div', {class: 'cvcbody'}, h('div', {class: 'tbig'}, big), sub ? h('div', {class: 'muted small'}, sub) : null, body));
}
const cvOpt = (id, title, sub, bad) => h('label', {class: 'opt' + ($('#' + id).checked ? ' on' : '') + (bad ? ' bad' : '')}, cvCheck(id), h('span', {}, h('b', {}, title), h('small', {class: 'muted'}, sub)));
function cvSentenceText(n) {
  const copy = $('#vCodec').value === 'copy', del = $('#deleteSource').checked;
  return (n === 1 ? 'Diese Datei wird ' : n + ' Dateien werden ') + (copy ? 'neu verpackt (Video wird nicht neu kodiert)' : 'mit ' + cvHwText() + ' umgewandelt') + ', gespeichert ' + cvDestText() + ' und danach geprüft: ' + cvCheckText() + '.' ;
}
function cvHowStep(files) {
  const codec = $('#vCodec').value, copy = codec === 'copy', r = resolveBackend(), hw = !copy && r.id !== 'cpu', custom = $('#outMode').value === 'custom', n = files.length;
  const hwTile = cvTile('hw', 'chip', 'Hardware', 'tileHw', copy ? 'Kein Umwandeln' : cvHwText(), copy ? 'Das Video wird nur neu verpackt, nichts wird neu berechnet. Sehr schnell, kein Qualitätsverlust.' : hw ? 'Schnell, die CPU bleibt frei.' : 'Die CPU rechnet: beste Qualität je Dateigröße, aber langsam.',
    [h('div', {class: 'tgrp'}, h('span', {class: 'lt'}, 'Video'), cvPills('vCodec', CV_CODEC, 'Video-Codec')),
      copy ? null : h('div', {class: 'tgrp'}, h('span', {class: 'lt'}, 'Encoder'), cvPills('vBackend', {auto: 'Automatisch'}, 'Encoder', true)),
      hw ? h('label', {class: 'check'}, cvCheck('vHwDec'), h('span', {}, 'Hardware-Decoding nutzen (fällt bei Fehler automatisch zurück)')) : null]);
  const destTile = cvTile('dest', 'disk', 'Speichern', 'tileDest', custom ? ($('#outDir').value.trim() ? cvDestText().replace(/^./, c => c.toUpperCase()) : 'Eigener Ordner fehlt noch') : 'Neben der Quelle', custom ? 'Alles landet im gewählten Ordner.' : 'Gleicher Ordner wie das Original, neuer Name.',
    [h('div', {class: 'tgrp'}, h('span', {class: 'lt'}, 'Speicherort'), cvPills('outMode', {same: 'Neben der Quelle', custom: 'Eigener Ordner …'}, 'Speicherort')),
      custom ? h('div', {class: 'tgrp'}, h('div', {class: 'row'}, h('input', {value: $('#outDir').value, placeholder: '/output', 'aria-label': 'Zielordner', onchange: ev => cvSet('outDir', ev.target.value.trim())}),
        h('button', {type: 'button', class: 'small', onclick: async () => { const x = await openBrowser('dir', $('#outDir').value); if (x) cvSet('outDir', x.dir); }}, '…'))) : null,
      custom ? h('div', {class: 'tgrp'}, h('span', {class: 'lt'}, 'Struktur'), cvPills('outStruct', {keep: 'Ordnerstruktur beibehalten', flat: 'Alles in einen Ordner'}, 'Struktur')) : null,
      h('div', {class: 'tgrp'}, h('span', {class: 'lt'}, 'Wenn die Datei schon da ist'), cvPills('exists', {rename: 'Beide behalten', skip: 'Überspringen', overwrite: 'Überschreiben'}, 'Wenn Datei existiert'),
        h('span', {class: 'small ' + ($('#exists').value === 'overwrite' ? 'warn' : 'muted')}, EXISTS_HINT[$('#exists').value] || ''))]);
  const chkTile = cvTile('check', 'shield', 'Danach prüfen', 'tileCheck', cvCheckText().replace(/^./, c => c.toUpperCase()), 'Nach dem Umwandeln wird die neue Datei immer auf Lesbarkeit und Laufzeit geprüft. Das Original bleibt, bis alles stimmt.',
    [cvOpt('vfTracks', 'Spuren & Größe', vfTime('video', 'tracks')[0]), cvOpt('vfDecode', 'Komplett durchlesen (Decode-Test)', vfTime('video', 'decode')[0]),
      cvOpt('deleteSource', 'Original danach löschen', 'unwiderruflich, kein Papierkorb', true)]);
  fill($('#cvHow'), h('div', {class: 'cvtiles'}, hwTile, destTile, chkTile), h('div', {class: 'cvresult'}, icon('check'), h('span', {id: 'cvResultText'}, n ? cvSentenceText(n) : 'Noch keine Dateien gewählt.')));
}

// ---------- Leisten unten ----------
// Schritte 1 bis 3 (Video): Zurück / Weiter mit kurzer Zeile
function cvBarWiz(files, items) {
  const n = files.length, st = S.vstep;
  let info = '', next = 'Weiter →', off = false;
  if (st === 1) { info = n ? n + (n === 1 ? ' Datei' : ' Dateien') + ' · ' + fmtSize(files.reduce((a, f) => a + (f.size || 0), 0)) : 'Wähle Dateien aus'; next = S.presetSkip ? 'Weiter zur Kontrolle →' : 'Weiter zu den Regeln →'; off = !n; }
  else if (st === 2) { info = items && items.length ? trkSumText(trkSum(items.filter(x => x.plan)), items) : ''; next = 'Weiter →'; }
  else { info = n ? cvSentenceText(n) : ''; next = 'Weiter zur Kontrolle →'; }
  $('#wizInfo').textContent = info;
  $('#wizNext').textContent = next; $('#wizNext').disabled = off;
  $('#wizBack').classList.toggle('hidden', st === 1);
}
function cvBar(files, items) {
  const n = files.length, parts = [];
  if (n) parts.push(n + (n === 1 ? ' Datei' : ' Dateien'));
  if (S.world === 'video') {
    const copy = $('#vCodec').value === 'copy';
    parts.push(copy ? 'Remux' : CV_CODEC[$('#vCodec').value] + ' ' + Q.stageName($('#vQuality').value) + ' · ' + (BACKEND_FULL[resolveBackend().id] || ''));
    if (items && items.length) { const all = items.filter(x => x.plan); if (all.length) parts.push(trkSumText(trkSum(all), all)); }
  } else parts.push(CV_AFMT[$('#aFormat').value] || '');
  const un = cvUnreviewed();
  fill($('#startInfo'), parts.filter(Boolean).join(' · '), un ? h('span', {class: 'warn'}, ' · ' + (un === 1 ? '1 Gruppe' : un + ' Gruppen') + ' noch nicht kontrolliert') : null);
  const custom = $('#outMode').value === 'custom' && !$('#outDir').value.trim();
  $('#start').disabled = !n || custom;
  $('#start').title = !n ? 'Zuerst Dateien hinzufügen' : custom ? 'Zielordner angeben' : '';
}

// ---------- Hauptdarstellung ----------
let cvSeq = 0, cvRaf = 0;
function cvRender() {
  if (S.step !== 'convert') return;
  cancelAnimationFrame(cvRaf);
  cvRaf = requestAnimationFrame(cvRenderNow);
}
async function cvRenderNow() {
  const my = ++cvSeq, video = S.world === 'video', files = S.files[S.world], box = $('#cvTable');
  if (video && !files.length && S.vstep > 1) { S.vstep = 1; applySteps(); }
  const st = S.vstep;
  cvLayout();
  if (video) { cvStepper(); cvHeadRender(); }
  cvFilesPanel(files);
  if (!video) cvSentence(files);
  if (video && st === 1) { cvBarWiz(files, null); cvPopFill(); return; }
  if (video && st === 3) { cvHowStep(files); cvBarWiz(files, null); cvPopFill(); return; }
  const target = video && st === 2 ? $('#cvRules') : box;
  const title = h('div', {class: 'cvempty', id: 'trkProgress'}, 'Lese die Dateien …');
  if (!files.length) {
    CV.groups = []; CV.bad = [];
    fill(box, h('div', {class: 'cvempty big'}, 'Hier erscheint eine Tabelle: links, wie die Dateien jetzt sind, rechts, was nach dem Umwandeln herauskommt. Jede Zeile lässt sich ändern.'));
    cvBar(files, null); cvPopFill(); return;
  }
  const need = files.filter(f => !(TRK.probe[f.path] && TRK.probe[f.path].__v) && !TRK.bad.has(f.path));
  if (need.length) {
    fill(target, title);
    if (video && st === 2) cvBarWiz(files, null); else cvBar(files, null);
    await trkLoadAll(files);
    if (my !== cvSeq) return;
  }
  const items = [], bad = [];
  files.forEach(f => { const p = TRK.probe[f.path]; if (p && p.__v) items.push({f, info: p.__v}); else bad.push(f); });
  CV.bad = bad;
  if (!items.length) { fill(target, cvWarnings(files, null, []), h('div', {class: 'cvempty'}, 'Keine der Dateien ließ sich lesen.')); if (video && st === 2) cvBarWiz(files, null); else cvBar(files, null); return; }
  if (my !== cvSeq) return;
  if (video && st === 2) { fill(target, cvRulesView(items)); cvBarWiz(files, items); cvPopFill(); return; }
  fill(box, video ? cvVideoTable(items) : cvAudioTable(items));
  cvBar(files, items);
  cvPopFill();
}

function wireConvert() {
  $('#detailsBtn').onclick = () => openSheet();
  $('#detailsClose').onclick = () => $('#detailsDlg').close();
  $('#detailsDlg').addEventListener('close', () => { saveSettings(); cvRender(); });
  $$('#detailsTabs [data-dtab]').forEach(b => b.onclick = () => { CV.tab = b.dataset.dtab; openSheet(); });
  $('#detailsDlg').addEventListener('click', ev => { if (ev.target === $('#detailsDlg')) $('#detailsDlg').close(); }); // Klick auf den Hintergrund
  matchMedia('(max-width:700px)').addEventListener('change', () => { if (CV.pop) cvPopPlace(); });
  addEventListener('resize', () => { if (CV.pop) cvPopPlace(); });
}
