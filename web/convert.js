import { $, BACKEND_FULL, S, api, encoderName, fmtSize, hwResult, infoBtn, openBrowser, pathLabel, pickFrom, renderFileList, resolveBackend, rootNameOf, toast, workingBackends } from './app.js';
import { CV, cvNameList, cvPopFill, cvPopPlace, cvRow, cvTrackRow } from './convert-tracks.js';
import { openClip } from './clip.js';
import { qCurrent, qSetStage } from './crf.js';
import { EXISTS_HINT, VSTEPS, applySteps, vGo } from './flow.js';
import { icon } from './icons.js';
import { LIB, LIBUI } from './library.js';
import { Q } from './quality.js';
import { cleanRules, nameRules } from './rename.js';
import { fill, h, setField } from './settings.js';
import { TRK, chTxt, codecTxt, fileLabel, langName, trkGlobalList, trkHasPrefs, trkLoadAll, trkPlan, trkPrefLine, trkRules, trkRulesSave, trkSet, trkSum, trkSumText, trkWarnings } from './tracks.js';
import { trkGlobalRules, trkRuleSuggestionList, trkRuleSuggestions, trkRulesBody } from './tracks-rules.js';
import { TP } from './trkplan.js';
import { vfTime } from './verify.js';

export { CV };

'use strict';
/* Konvertieren: eine Seite mit Karten (Video, Ton, Untertitel, Regeln, Name & Ziel, Prüfen) statt vieler Schritte und einem Details-Fenster.
   Video hat zwei Schritte: 1 Dateien, 2 Konvertieren (Audio nur die eine Ansicht). Jede Karte zeigt eine Zeile mit dem Wichtigsten und klappt an Ort
   und Stelle auf; was das Programm selbst erkannt oder angepasst hat (Regeln, Sprach-Wünsche, Forced-Erkennung, Übernahme), ist offen und trägt das Funkel-Zeichen
   (SVG, kein Emoji). Dateien mit gleichen Rahmendaten (Spuren, Sprachen, Formate) bilden eine Gruppe; eine Entscheidung gilt für die ganze Gruppe. Abweichende
   Dateien sind eine eigene Gruppe und müssen kontrolliert werden; die Entscheidungen einer kontrollierten Gruppe werden bei gleichen Spuren übernommen („Übernommen“).
   Der Zustand bleibt in den Feldern der Oberfläche (#vCodec, #vCrf, …; sie stecken versteckt in #fieldStore) und in f.tracks je Datei:
   so funktionieren Voreinstellungen, Speichern und Starten unverändert. Die Berechnung steckt in trkplan.js (TP) und quality.js (Q).
   Nutzt S, $, h(), fill(), api(), icon(), setField(), trk*() usw. aus den anderen Dateien (nur zur Laufzeit). */


// ---------- Hilfen ----------
// Feld der Oberfläche setzen und die übliche Verarbeitung auslösen (Speichern, Vorschau, Neuzeichnen)
export function cvSet(id, v) { setField(id, v); $('#' + id).dispatchEvent(new Event('input', {bubbles: true})); }
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
const cvSigText = info => { const g = TP.signature(info); return 'Ton: ' + (g.audio.map(l => l === 'und' ? '?' : langName(l)).join(', ') || 'keiner') + ' · Untertitel: ' + (g.sub.map(l => l === 'und' ? '?' : langName(l)).join(', ') || 'keine'); };

// ---------- Aufbau: welche Teile sind sichtbar? ----------
// Video: Schritt 1 (Dateien, Voreinstellungen, Ordner-Tipps) und Schritt 2 (Konvertieren). Audio: Dateien und Karten in einer Ansicht.
export function cvLayout() {
  const conv = S.step === 'convert', video = S.world === 'video', st = S.vstep, show = (id, on) => { const e = $('#' + id); if (e) e.classList.toggle('hidden', !on); };
  show('cvStepper', conv && video);
  show('cvFiles', conv && (!video || st === 1));
  show('cvTable', conv && (!video || st === 2));
  show('presetBar', conv && video && st === 1);
  show('cvScanHelp', conv && video && st === 1); show('cvScan', conv && video && st === 1 && !!LIBUI.id);
  show('wizNav', conv && video && st === 1); show('stepnav', conv && (!video || st === 2));
  const sp = $('#savePreset'); if (sp) sp.classList.toggle('hidden', !video); // Voreinstellungen gibt es nur für Video
}
// Schrittleiste oben: 1 Dateien · 2 Konvertieren (am Handy nur der aktuelle Schritt beschriftet)
function cvStepper() {
  const n = S.files.video.length;
  fill($('#cvStepper'), VSTEPS.map(([id, name], i) => {
    const k = i + 1, cls = k === S.vstep ? 'on' : k < S.vstep ? 'done' : '';
    return [i ? h('span', {class: 'sep'}) : null, h('button', {type: 'button', class: 'stp ' + cls, 'data-step': id, 'aria-current': k === S.vstep ? 'step' : null, disabled: k > 1 && !n,
      title: k > 1 && !n ? 'Zuerst Dateien wählen' : name, onclick: () => vGo(k)}, h('i', {}, k < S.vstep ? icon('check') : String(k)), h('span', {class: 'stn'}, name))];
  }));
}

// ---------- Karten: auf- und zuklappen ----------
// Standard: offen, wenn das Programm etwas erkannt hat oder etwas Aufmerksamkeit braucht; sonst eine Zeile. Wer selbst auf- oder zuklappt, behält seine Wahl.
const cvIsOpen = (id, dflt) => id in CV.card ? CV.card[id] : !!dflt;
function cvToggle(id, open) { CV.card[id] = open; cvRender(); }
function cvOpenCard(id) {
  CV.card[id] = true; cvLayout(); cvRender();
  setTimeout(() => { const el = document.querySelector('[data-card="' + id + '"]'); if (el) el.scrollIntoView({block: 'start', behavior: 'smooth'}); }, 120);
}
// frühere Reiter des Fensters „Details“ führen jetzt zur passenden Karte
const CV_OLD_TAB = {dest: 'name', name: 'name', video: 'video', audio: 'video', tracks: 'audio', verify: 'check'};
export function openSheet(tab) { cvOpenCard(CV_OLD_TAB[tab] || 'video'); }

// Textbausteine für die Zusammenfassungen
function cvDestText() {
  const custom = $('#outMode').value === 'custom', dir = $('#outDir').value.trim();
  return custom ? (dir ? 'Ordner ' + pathLabel(dir).split(/[\\/]/).filter(Boolean).slice(-2).join('/') : 'eigenem Ordner (fehlt noch)') : 'neben der Quelle';
}
function cvCheckText() {
  const t = $('#vfTracks').checked, d = $('#vfDecode').checked, del = $('#deleteSource').checked;
  const what = t && d ? 'Spuren und Decode-Test' : t ? 'Spuren' : d ? 'Decode-Test' : 'nur Grundprüfung';
  return what + (del ? ', Original löschen' : '');
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

// ---------- Qualität (Stufen) ----------
function qualityControl(compact) {
  const c = qCurrent(), st = $('#vQuality').value, scale = Q.scaleName(c.backend);
  const seg = h('div', {class: 'qseg', role: 'radiogroup', 'aria-label': 'Qualität'}, Q.STAGES.map(([id, name, sub]) => h('button', {type: 'button', role: 'radio', 'aria-checked': st === id ? 'true' : 'false',
    class: 'qs' + (st === id ? ' on' : ''), onclick: () => qSetStage(id)}, h('b', {}, name), h('small', {}, sub), h('small', {class: 'qv'}, scale + ' ' + Q.value(c.backend, c.codec, id)))));
  const out = h('output', {}, $('#vCrf').value), custom = st === 'custom';
  // Der Regler steht immer da (nicht hinter „Erweitert“): Bewegen setzt die Stufe auf „Eigener Wert“
  const slider = h('div', {class: 'qadv' + (custom ? ' on' : '')}, h('label', {class: 'qsl'}, h('span', {}, (custom ? 'Eigener Wert · ' : 'Selbst einstellen · ') + scale + ' '), out,
    h('input', {type: 'range', min: 10, max: 40, value: $('#vCrf').value, 'aria-label': 'Eigener Wert (' + scale + ')', oninput: ev => { out.textContent = ev.target.value; }, onchange: ev => cvSet('vCrf', ev.target.value)})),
    h('div', {class: 'muted small'}, 'Niedriger = bessere Qualität, größere Datei. ' + (Q.SCALE_HELP[scale] || '') + '. Die Zahl gilt nur für diesen Encoder.'));
  return h('div', {class: 'qctl'}, seg, slider,
    h('div', {class: 'qline muted small'}, custom ? 'Eigener Wert · ' : '', scale + ' ' + $('#vCrf').value, ' · ', encoderName(c.backend, c.codec)));
}
export function renderQualityControls() { const m = $('#vQualityMount'); if (m) fill(m, qualityControl(true)); }

// ---------- Gruppen ----------
function cvGroups(items) {
  const map = new Map();
  items.forEach(it => { const k = TP.frameKey(it.info); if (!map.has(k)) map.set(k, {key: k, items: []}); map.get(k).items.push(it); });
  const list = [...map.values()].sort((a, b) => b.items.length - a.items.length);
  list.forEach((g, i) => { g.n = i + 1; g.name = 'Gruppe ' + (i + 1); });
  return list;
}
export const cvUnreviewed = () => (S.world === 'video' && CV.groups.length > 1) ? CV.groups.filter(g => !CV.reviewed.has(g.key)).length : 0;
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

// ---------- Karten der Konvertieren-Seite (Video, Ton, Untertitel, Regeln, Name & Ziel, Prüfen) ----------
// Jedes Thema ist eine Karte mit Kopf (Symbol, Titel, Kurzfassung) und aufklappbarem Inhalt. Video, Untertitel, Regeln, Name & Ziel und Prüfen sind grün, Audio ist orange.
function cvCardHead(ico, title, info, summary, tog) {
  const props = {class: 'cvchead' + (tog ? ' tog' : '')};
  if (tog && !tog.open) props.onclick = ev => { if (!ev.target.closest('button, a, select, input')) cvToggle(tog.id, true); };
  return h('div', props, h('span', {class: 'cvico'}, icon(ico)), h('h2', {}, title, info ? infoBtn(info) : null), summary ? h('span', {class: 'cvsum' + (tog && !tog.open ? '' : ' muted small')}, summary) : null,
    tog ? h('button', {type: 'button', class: 'cvtog small ghost', 'aria-expanded': tog.open ? 'true' : 'false', title: tog.open ? 'Einklappen' : 'Aufklappen', onclick: () => cvToggle(tog.id, !tog.open)}, tog.open ? 'einklappen ▴' : 'ändern ›') : null);
}
// o: {id (aufklappbar), open (Standard), body (statt Zeilen)}
function cvCard(cls, ico, title, info, summary, rows, o) {
  o = o || {};
  const open = o.id ? cvIsOpen(o.id, o.open) : true;
  if (o.id && o.open && !(o.id in CV.card)) CV.card[o.id] = true; // was offen anfing, klappt nicht von selbst zu (z. B. nach „Als Forced markieren“)
  return h('section', {class: 'cvcard sec-' + cls + (cls === 'audio' ? ' hue-audio' : '') + (open ? '' : ' closed'), 'data-card': o.id || cls},
    cvCardHead(ico, title, info, summary, o.id ? {id: o.id, open} : null),
    !open ? null : o.body ? h('div', {class: 'cvcbody'}, o.body) : h('div', {class: 'cvgrid', role: 'table', 'aria-label': title}, rows));
}
const cvColHead = () => h('div', {class: 'cvcols', role: 'row'}, h('div', {}, ''), h('div', {}, 'Vorher (Quelle)'), h('div', {}), h('div', {}, 'Nachher (Ergebnis)'));
const cvShortName = s => codecTxt(s).replace(/ \(.*\)$/, '');
// Auswahl als Pillen: die Werte kommen aus den Optionen des versteckten Felds, geändert wird über cvSet (Speichern, Vorschau und Neuzeichnen laufen wie sonst)
function cvPills(id, labels, aria, onlyUsable) {
  const src = $('#' + id);
  return h('div', {class: 'pills', role: 'radiogroup', 'aria-label': aria || id}, [...src.options].filter(o => !(onlyUsable && o.disabled)).map(o => h('button', {type: 'button', role: 'radio', class: 'pill' + (o.value === src.value ? ' on' : ''), 'aria-checked': o.value === src.value ? 'true' : 'false',
    disabled: o.disabled, title: o.disabled ? 'Nicht nutzbar' : null, onclick: () => cvSet(id, o.value)}, (labels && labels[o.value]) || o.textContent.replace(/ ✓$/, ''))));
}
const cvOpt = (id, title, sub, bad) => h('label', {class: 'opt' + ($('#' + id).checked ? ' on' : '') + (bad ? ' bad' : '')}, cvCheck(id), h('span', {}, h('b', {}, title), h('small', {class: 'muted'}, sub)));
const cvNumber = (id, aria, min, max) => h('input', {type: 'number', class: 'cvnum', min, max, value: $('#' + id).value, 'aria-label': aria, onchange: ev => cvSet(id, ev.target.value)});
const SPEED_HINT = {slow: 'kleinste Datei, dauert länger', medium: 'guter Kompromiss', fast: 'schneller, Datei etwas größer', veryfast: 'sehr schnell, Datei größer'};

// ---------- Inhalt der Karten „Name & Ziel“, „Prüfen“, „Regeln“ ----------
function cvDestBody(files) {
  const custom = $('#outMode').value === 'custom', grp = (label, ...kids) => h('div', {class: 'tgrp'}, h('span', {class: 'lt'}, label), ...kids);
  return [
    grp('Speichern', cvPills('outMode', {same: 'Neben der Quelle', custom: 'Eigener Ordner …'}, 'Speicherort')),
    custom ? h('div', {class: 'tgrp'}, h('div', {class: 'row'}, h('input', {value: $('#outDir').value, placeholder: '/output', 'aria-label': 'Zielordner', onchange: ev => cvSet('outDir', ev.target.value.trim())}),
      h('button', {type: 'button', class: 'small', onclick: async () => { const x = await openBrowser('dir', $('#outDir').value); if (x) cvSet('outDir', x.dir); }}, '…'))) : null,
    custom ? grp('Struktur', cvPills('outStruct', {keep: 'Ordnerstruktur beibehalten', flat: 'Alles in einen Ordner'}, 'Struktur')) : null,
    grp('Wenn die Datei schon da ist', cvPills('exists', {rename: 'Beide behalten', skip: 'Überspringen', overwrite: 'Überschreiben'}, 'Wenn Datei existiert'),
      h('span', {class: 'small ' + ($('#exists').value === 'overwrite' ? 'warn' : 'muted')}, EXISTS_HINT[$('#exists').value] || '')),
    h('div', {class: 'tgrp cvnamebox', 'data-nameslot': '1'}), // #nameStore (Dateiname, Muster, Ersetzungen) wird hier eingehängt
    cvNameList(files)];
}
function cvCheckBody() {
  const w = S.world;
  return [cvOpt('vfTracks', 'Spuren & Größe', vfTime(w, 'tracks')[0]), cvOpt('vfDecode', 'Komplett durchlesen (Decode-Test)', vfTime(w, 'decode')[0]),
    cvOpt('deleteSource', 'Original danach löschen', 'unwiderruflich, kein Papierkorb', true),
    h('p', {class: 'muted small'}, 'Die neue Datei wird immer auf Lesbarkeit und Laufzeit geprüft. Das Original bleibt, bis alles stimmt.')];
}
function cvRulesBody(items) {
  const r = trkRules();
  return [trkPrefLine(), trkGlobalRules(items, false),
    h('div', {class: 'cvown'}, h('h4', {}, 'Eigene Regeln für diesen Lauf'), trkRulesBody(r, () => trkRulesSave(r), () => cvRender(), false))];
}
const cvRulesSummary = items => {

  const r = trkRules(), n = trkGlobalList().filter(e => e.on).length + r.audio.length;
  return (n ? n + (n === 1 ? ' Regel aktiv' : ' Regeln aktiv') : 'keine Regeln') + (trkHasPrefs() && r.usePrefs ? ' · Sprach-Wünsche an' : '');
};

// ---------- Video ----------
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

  const vRows = [], aRows = [], sRows = [], sugEl = trkRuleSuggestions(items), nSug = trkRuleSuggestionList(items).length;
  const vsrc = cvVideoStream(ex.info), srcH = vsrc && vsrc.height, srcD = vsrc && vsrc.bitDepth;
  const vch = copy ? false : (vsrc && (CV_SRC_CODEC[vsrc.codec] || '').toLowerCase().replace(/[. ]/g, '') !== (CV_CODEC[$('#vCodec').value] || '').toLowerCase().replace(/[. ]/g, ''));
  const facts = LIB.sourceFacts(items.map(it => ({f: it.f, info: it.info, size: it.f.size})), {audio: cvShortName, sub: cvShortName}), hint = copy ? null : LIB.convertHint(facts, $('#vCodec').value);
  vRows.push(cvRow('Video', cvVideoDesc(ex.info), h('div', {class: 'cvafter'}, cvSelect('vCodec', CV_CODEC, 'Video-Codec'), copy ? h('span', {class: 'muted small'}, 'Bild wird nicht neu kodiert') :
    [cvSelect('vHeight', {0: 'wie Quelle' + (srcH ? ' (' + srcH + 'p)' : '')}, 'Auflösung'), cvSelect('vDepth', {0: 'wie Quelle' + (srcD ? ' (' + srcD + ' Bit)' : '')}, 'Bit-Tiefe')]),
    {cls: vch ? 'chg' : '', extra: hint ? [h('div', {class: 'small cvhint ' + (hint.tone || 'plain')}, icon(hint.tone === 'warn' ? 'warn' : 'info'), ' ', hint.text)] : null}));
  vRows.push(cvRow('Container', CV_FORMAT(ex.info.format), h('div', {class: 'cvafter'}, cvSelect('vContainer', {mkv: 'MKV', mp4: 'MP4'}, 'Container')), {cls: CV_FORMAT(ex.info.format) !== $('#vContainer').value.toUpperCase() ? 'chg' : ''}));
  if (!copy) {
    const r = resolveBackend(), codec = $('#vCodec').value, avail = workingBackends(codec).map(id => BACKEND_FULL[id] || id);
    vRows.push(cvRow('Qualität', cvBitrate(ex.info), [qualityControl(false), cvLowHint(ex.info)], {cls: 'qrowc'}));
    vRows.push(cvRow('Geschwindigkeit', null, h('div', {class: 'cvafter'}, cvPills('vPreset', {slow: 'Langsam', medium: 'Mittel', fast: 'Schnell', veryfast: 'Sehr schnell'}, 'Geschwindigkeit'), h('span', {class: 'muted small'}, SPEED_HINT[$('#vPreset').value] || ''))));
    vRows.push(cvRow('Probeclip', null, h('div', {class: 'cvafter'}, h('button', {type: 'button', class: 'small', id: 'clipBtn', onclick: openClip}, '30 Sekunden testen …'), h('span', {class: 'muted small'}, 'vergleicht Einstellungen an einem kurzen Ausschnitt: Größe, Bild, Tempo'))));
    vRows.push(cvRow('Encoder', h('span', {class: 'muted small'}, avail.length ? 'Gefunden: ' + avail.join(', ') : hwResult().done ? 'keine Hardware gefunden' : 'Hardware-Erkennung läuft …'),
      h('div', {class: 'cvafter'}, cvPills('vBackend', {auto: 'Automatisch'}, 'Encoder', true), h('span', {class: 'muted small'}, 'Wird verwendet: ', h('b', {}, encoderName(r.id, codec)), ' · ', BACKEND_FULL[r.id] || r.id, r.pref ? ' (bevorzugt laut Einstellungen)' : ''),
        r.id !== 'cpu' ? h('label', {class: 'check'}, cvCheck('vHwDec'), h('span', {}, 'Grafikkarte auch zum Lesen nutzen (fällt bei Fehler automatisch zurück)')) : null)));
  }
  // Ton und Untertitel
  const FOLD = 6;
  ['audio', 'subtitle'].forEach(type => {
    const rows = type === 'audio' ? aRows : sRows;
    const list = ex.plan.tracks.filter(r => r.type === type), foldKey = g.key + '#' + type, folded = list.length > FOLD && !CV.unfold.has(foldKey);
    if (type === 'audio' && sugEl) rows.push(h('div', {class: 'cvpad'}, sugEl));
    if (type === 'audio' && list.length) rows.push(cvRow('Alle Tonspuren', null, h('div', {class: 'cvafter'}, cvSelect('vAudioMode', {copy: 'unverändert lassen', encode: 'kleiner machen (neu kodieren)'}, 'Alle Tonspuren'),
      $('#vAudioMode').value === 'encode' ? [cvSelect('vAudioCodec', null, 'Format'), cvNumber('vAudioKbps', 'Bitrate je Stereo-Paar', 32, 640), h('span', {class: 'muted small'}, 'kbit/s je Stereo-Paar')] : h('span', {class: 'muted small'}, 'gilt für Spuren ohne eigene Entscheidung'))));
    if (type === 'subtitle' && list.length) rows.push(cvRow('Alle Untertitel', null, h('div', {class: 'cvafter'}, cvSelect('vSubMode', {copy: 'alle behalten', none: 'alle entfernen'}, 'Alle Untertitel'), h('span', {class: 'muted small'}, 'gilt für Spuren ohne eigene Entscheidung'))));
    (folded ? list.slice(0, FOLD) : list).forEach((r, i) => rows.push(cvTrackRow(g, ex, r, i + 1)));
    if (list.length > FOLD) rows.push(h('div', {class: 'cvmorerow'}, h('button', {type: 'button', class: 'small ghost', onclick: () => { folded ? CV.unfold.add(foldKey) : CV.unfold.delete(foldKey); cvRender(); }},
      folded ? (list.length - FOLD) + ' weitere ' + (type === 'audio' ? 'Tonspuren' : 'Untertitel') + ' anzeigen ▾' : 'Weniger anzeigen ▴')));
    if (!list.length) rows.push(cvRow(type === 'audio' ? 'Ton' : 'Untertitel', h('span', {class: 'muted'}, type === 'audio' ? 'keine Tonspur' : 'keine Untertitel'), h('span', {class: 'muted'}, '–')));
  });
  const sumOf = (type, one, many) => {
    const list = ex.plan.tracks.filter(r => r.type === type);
    if (!list.length) return 'keine ' + many;
    const enc = list.filter(r => r.kept && r.type === 'audio' && r.action === 'encode').length, drop = list.filter(r => !r.kept).length;
    const def = list.find(r => r.kept && r.def), defTxt = def ? ' · Standard: ' + langName(def.lang) + (def.forced ? ' (Forced)' : '') : '';
    return list.length + ' ' + (list.length === 1 ? one : many) + (enc ? ' · ' + enc + ' umgewandelt' : '') + (drop ? ' · ' + drop + ' entfernt' : '') + (!enc && !drop ? ' · bleiben unverändert' : '') + defTxt;
  };
  const attention = type => ex.plan.tracks.some(r => r.type === type && (r.own || r.guess || !r.kept || r.why.length || (r.kept && TP.noLang(r.lang)))) || (type === 'audio' ? $('#vAudioMode').value !== 'copy' : $('#vSubMode').value !== 'copy');
  const vsum = copy ? 'Video wird nicht neu kodiert' : (vsrc ? (CV_SRC_CODEC[vsrc.codec] || (vsrc.codec || '?').toUpperCase()) : '?') + ' → ' + CV_CODEC[$('#vCodec').value] + ' · ' + Q.stageName($('#vQuality').value) + ' · ' + SPEED_NAME[$('#vPreset').value] + ' · ' + (BACKEND_FULL[resolveBackend().id] || '');
  const plainName = !$('#pattern').value.trim() && !cleanRules(nameRules()).length && !$('#suffix').value;
  const nameSum = 'Name ' + (plainName ? 'bleibt' : 'wird angepasst') + ' · ' + cvDestText() + ' · ' + ({rename: 'Datei da: nummerieren', skip: 'Datei da: überspringen', overwrite: 'Datei da: überschreiben'}[$('#exists').value] || '');
  return [strip, gline, cvWarnings(null, g, items), cvColHead(),
    cvCard('video', 'video', 'Video', 'cardVideo', vsum, vRows, {id: 'video', open: true}),
    cvCard('audio', 'wave', 'Ton', 'cardAudio', sumOf('audio', 'Tonspur', 'Tonspuren') + (nSug ? ' · ' + nSug + (nSug === 1 ? ' Vorschlag' : ' Vorschläge') : ''), aRows, {id: 'audio', open: attention('audio') || nSug > 0}),
    cvCard('subs', 'subs', 'Untertitel', 'cardSubs', sumOf('subtitle', 'Untertitel', 'Untertitel'), sRows, {id: 'subs', open: attention('subtitle')}),
    cvCard('rules', 'shield', 'Regeln', 'trkGlobal', cvRulesSummary(items), null, {id: 'rules', open: false, body: cvRulesBody(items)}),
    cvCard('name', 'file', 'Name & Ziel', 'cardName', nameSum, null, {id: 'name', open: ($('#outMode').value === 'custom' && !$('#outDir').value.trim()) || $('#exists').value === 'overwrite', body: cvDestBody(S.files.video)}),
    cvCard('check', 'shield', 'Prüfen', 'tileCheck', cvCheckText().replace(/^./, c => c.toUpperCase()), null, {id: 'check', open: $('#deleteSource').checked, body: cvCheckBody()})];
}
export const SPEED_NAME = {slow: 'Langsam', medium: 'Mittel', fast: 'Schnell', veryfast: 'Sehr schnell'};
// Hinweis, wenn die Quelle schon klein ist: Neukodieren spart dann kaum Platz
function cvLowHint(info) {
  const v = cvVideoStream(info), br = (v && v.bitRate) || (info.bitRate > 0 ? info.bitRate : 0), height = v && v.height;
  if (!Q.lowBitrate(br, height)) return null;
  return h('div', {class: 'cvlow small'}, icon('warn'), ' Die Quelle ist schon klein (' + cvBitrate(info) + ' bei ' + height + 'p). Neu kodieren spart hier kaum Platz und kann die Datei sogar größer machen. Nimm besser „Normal“ oder „Klein“ oder lass das Video unverändert (Kopieren). Wird das Ergebnis nicht kleiner, bleibt dein Original in jedem Fall erhalten.');
}

// ---------- Audio ----------
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
    cvRow('Format', items.length > 1 ? h('div', {}, codecs.join(', '), h('div', {class: 'muted small'}, items.length + ' Dateien')) : bef(ex), h('div', {class: 'cvafter'}, cvSelect('aFormat', null, 'Format')), {cls: codecs.length === 1 && codecs[0] === (CV_AFMT[f] || '').split(' ')[0] ? '' : 'chg'}),
    qual.length ? cvRow('Qualität', items.length === 1 ? (cvKbps((((ex.info.streams || []).find(q => q.type === 'audio') || {}).bitRate) || ex.info.bitRate) || '–') : 'je Datei verschieden', h('div', {class: 'cvafter'}, qual), {cls: 'chg'}) : null,
    cvRow('Samplerate', a && a.sampleRate ? a.sampleRate / 1000 + ' kHz' : '?', h('div', {class: 'cvafter'}, cvSelect('aRate', null, 'Samplerate')), {info: 'aRate'}),
    cvRow('Kanäle', a ? chTxt(a.channels) || a.channels : '?', h('div', {class: 'cvafter'}, cvSelect('aCh', null, 'Kanäle')), {info: 'aCh'}),
    !$('#aCover').parentElement.classList.contains('hidden') ? cvRow('Cover-Bild', pic ? 'vorhanden' : 'keines', h('div', {class: 'cvafter'}, h('label', {class: 'check'}, cvCheck('aCover'), h('span', {}, 'übernehmen'))), {info: 'aCover'}) : null,
  ].filter(Boolean);
  const plainName = !$('#pattern').value.trim() && !cleanRules(nameRules()).length && !$('#suffix').value;
  const nameSum = 'Name ' + (plainName ? 'bleibt' : 'wird angepasst') + ' · ' + cvDestText();
  return [cvWarnings(null, null, items), cvColHead(), cvCard('audio', 'audio', 'Audio-Datei', 'cardAudioFile', items.length === 1 ? 'Vorher → Nachher' : items.length + ' Dateien', rows),
    cvCard('name', 'file', 'Name & Ziel', 'cardName', nameSum, null, {id: 'name', open: $('#outMode').value === 'custom' && !$('#outDir').value.trim(), body: cvDestBody(S.files.audio)}),
    cvCard('check', 'shield', 'Prüfen', 'tileCheck', cvCheckText().replace(/^./, c => c.toUpperCase()), null, {id: 'check', open: $('#deleteSource').checked, body: cvCheckBody()})];
}

// ---------- Leisten unten ----------
// Schritt 1 (Video): Weiter mit kurzer Zeile
function cvBarWiz(files) {
  const n = files.length;
  $('#wizInfo').textContent = n ? n + (n === 1 ? ' Datei' : ' Dateien') + ' · ' + fmtSize(files.reduce((a, f) => a + (f.size || 0), 0)) : 'Wähle Dateien aus';
  $('#wizNext').textContent = 'Weiter →'; $('#wizNext').disabled = !n;
  $('#wizBack').classList.add('hidden');
}
function cvBar(files, items) {
  const n = files.length, parts = [];
  if (n) parts.push(n + (n === 1 ? ' Datei' : ' Dateien'));
  if (S.world === 'video') {
    const copy = $('#vCodec').value === 'copy';
    parts.push(copy ? 'Remux' : CV_CODEC[$('#vCodec').value] + ' ' + Q.stageName($('#vQuality').value) + ' · ' + (SPEED_NAME[$('#vPreset').value] || '') + ' · ' + (BACKEND_FULL[resolveBackend().id] || ''));
    if (items && items.length) { const all = items.filter(x => x.plan); if (all.length) parts.push(trkSumText(trkSum(all), all)); }
  } else parts.push(CV_AFMT[$('#aFormat').value] || '');
  const un = cvUnreviewed();
  fill($('#startInfo'), parts.filter(Boolean).join(' · '), un ? h('span', {class: 'warn'}, ' · ' + (un === 1 ? '1 Gruppe' : un + ' Gruppen') + ' noch nicht kontrolliert') : null);
  const custom = $('#outMode').value === 'custom' && !$('#outDir').value.trim();
  $('#start').disabled = !n || custom;
  $('#start').title = !n ? 'Zuerst Dateien hinzufügen' : custom ? 'Zielordner angeben' : '';
}

// ---------- Hauptdarstellung ----------
// #nameStore (Dateiname, Muster, Ersetzungen) ist immer im Dokument: zu Hause in #fieldStore, solange keine Karte „Name & Ziel“ offen ist
function cvNameHome() { const st = $('#nameStore'); if (st && st.parentElement.id !== 'fieldStore') $('#fieldStore').append(st); }
function cvNameDock(box) { const slot = box.querySelector('[data-nameslot]'); if (slot) slot.append($('#nameStore')); }
let cvSeq = 0, cvRaf = 0;
export function cvRender() {
  if (S.step !== 'convert') return;
  cancelAnimationFrame(cvRaf);
  cvRaf = requestAnimationFrame(cvRenderNow);
}
async function cvRenderNow() {
  // nicht mitten im Tippen (Namensmuster) neu aufbauen: Das Feld würde den Fokus verlieren; bei „change“ kommt der Neuaufbau
  const act = document.activeElement;
  if (act && act.closest && act.closest('#nameStore') && /^(INPUT|TEXTAREA)$/.test(act.tagName)) return;
  const my = ++cvSeq, video = S.world === 'video', files = S.files[S.world], box = $('#cvTable');
  if (video && !files.length && S.vstep > 1) { S.vstep = 1; applySteps(); }
  const st = S.vstep;
  cvLayout();
  if (video) cvStepper();
  cvFilesPanel(files);
  if (video && st === 1) { cvNameHome(); cvBarWiz(files); cvPopFill(); return; }
  const title = h('div', {class: 'cvempty', id: 'trkProgress'}, 'Lese die Dateien …');
  if (!files.length) {
    CV.groups = []; CV.bad = []; cvNameHome();
    fill(box, h('div', {class: 'cvempty big'}, 'Hier erscheint, was mit den Dateien passiert, sobald du welche gewählt hast.'));
    cvBar(files, null); cvPopFill(); return;
  }
  const need = files.filter(f => !(TRK.probe[f.path] && TRK.probe[f.path].__v) && !TRK.bad.has(f.path));
  if (need.length) {
    cvNameHome(); fill(box, title); cvBar(files, null);
    await trkLoadAll(files);
    if (my !== cvSeq) return;
  }
  const items = [], bad = [];
  files.forEach(f => { const p = TRK.probe[f.path]; if (p && p.__v) items.push({f, info: p.__v}); else bad.push(f); });
  CV.bad = bad;
  if (!items.length) { cvNameHome(); fill(box, cvWarnings(files, null, []), h('div', {class: 'cvempty'}, 'Keine der Dateien ließ sich lesen.')); cvBar(files, null); return; }
  if (my !== cvSeq) return;
  cvNameHome();
  fill(box, video ? cvVideoTable(items) : cvAudioTable(items));
  cvNameDock(box);
  cvBar(files, items);
  cvPopFill();
}

export function wireConvert() {
  matchMedia('(max-width:700px)').addEventListener('change', () => { if (CV.pop) cvPopPlace(); });
  addEventListener('resize', () => { if (CV.pop) cvPopPlace(); });
  // Namensfelder: Tabelle und Vorschau erst nach der Eingabe neu zeichnen
  const ns = $('#nameStore');
  ns.addEventListener('change', () => cvRender());
  ns.addEventListener('click', ev => { if (ev.target.closest('button')) setTimeout(cvRender, 400); });
}
