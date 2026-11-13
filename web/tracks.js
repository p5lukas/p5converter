import { $, S, api, saveSettings } from './app.js';
import { cvRender } from './convert.js';
import { icon } from './icons.js';
import { cfg, h } from './settings.js';
import { TP } from './trkplan.js';

'use strict';
/* Details → „Audio & Untertitel“ (Video; die Tabelle in der Konvertieren-Ansicht arbeitet mit denselben Daten). Alles bleibt unverändert (Passthrough), solange man nichts festlegt.
   Drei Ansichten: „Gruppen“ (Dateien mit gleichen Sprachen zusammengefasst, eine Entscheidung je Gruppe), „Tabelle“ (alle Dateien × Sprachen mit Häkchen)
   und „Einzelne Dateien“ (Spurkarten mit Erweitert). Darüber: Regeln nach Codec (z. B. nur DTS umwandeln) und die Sprach-Wünsche aus den Einstellungen.
   Berechnet wird alles in web/trkplan.js (reine Logik, mit Node getestet). Eigene Änderungen je Datei: f.tracks = {streamIndex: {…}} (gehen vor),
   zum Server geht pro Datei overrides.tracks (internal/build/video.go: TrackEdit).
   Nutzt S, $, h(), fill(), api(), icon() usw. aus app.js/settings.js (nur zur Laufzeit). */

export const TRK = {probe: {}, bad: new Set(), cur: 0, busy: false, open: new Set(), view: 'groups', probing: 0, probeDone: 0, openGroups: new Set()};
const {normLang, noLang, REC_KBPS} = TP;

// Sprachen: Code (ISO 639-2, wie Plex sie liest) → Name; die häufigsten stehen zuerst
export const LANGS = [['ger', 'Deutsch'], ['eng', 'Englisch'], ['fre', 'Französisch'], ['spa', 'Spanisch'], ['ita', 'Italienisch'], ['jpn', 'Japanisch'], ['kor', 'Koreanisch'],
  ['chi', 'Chinesisch'], ['rus', 'Russisch'], ['por', 'Portugiesisch'], ['dut', 'Niederländisch'], ['pol', 'Polnisch'], ['tur', 'Türkisch'], ['swe', 'Schwedisch'],
  ['dan', 'Dänisch'], ['nor', 'Norwegisch'], ['fin', 'Finnisch'], ['cze', 'Tschechisch'], ['hun', 'Ungarisch'], ['gre', 'Griechisch'], ['ara', 'Arabisch'], ['hin', 'Hindi']];
// Reihenfolge der Anzeige: häufige Sprachen zuerst (wie LANGS), unbekannte am Ende
const langRank = l => { const i = LANGS.findIndex(x => x[0] === normLang(l)); return l === 'und' ? 999 : i < 0 ? 500 : i; };
const byLang = (a, b) => langRank(a) - langRank(b) || (a < b ? -1 : 1);
export const langName = l => noLang(l) ? 'Sprache unbekannt' : ((LANGS.find(x => x[0] === normLang(l)) || [])[1] || normLang(l).toUpperCase());

// Codec-Kennung zuerst, der Markenname in Klammern (ist beides gleich, steht es nur einmal): „E-AC-3 (Dolby Digital Plus)“
const CODEC_TXT = {ac3: 'AC-3 (Dolby Digital)', eac3: 'E-AC-3 (Dolby Digital Plus)', truehd: 'TrueHD (Dolby TrueHD)', dts: 'DTS', aac: 'AAC', flac: 'FLAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis',
  alac: 'ALAC', pcm_s16le: 'PCM (unkomprimiert)', pcm_s24le: 'PCM (unkomprimiert)', pcm_s32le: 'PCM (unkomprimiert)', pcm_bluray: 'PCM (unkomprimiert)',
  subrip: 'SRT (Text)', srt: 'SRT (Text)', ass: 'ASS (Text mit Stil)', ssa: 'ASS (Text mit Stil)', webvtt: 'WebVTT (Text)', mov_text: 'MP4-Text', hdmv_pgs_subtitle: 'PGS (Bild)', dvd_subtitle: 'VobSub (Bild)', dvb_subtitle: 'DVB (Bild)'};
const LOSSLESS = ['truehd', 'flac', 'alac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_bluray'];
export const isLossless = s => LOSSLESS.includes(s.codec) || (s.codec === 'dts' && /ma|hd/i.test(s.profile || ''));
export function codecTxt(s) {
  const p = s.profile || '';
  if (s.codec === 'dts') return /ma/i.test(p) ? 'DTS-HD MA' : /hra|high res/i.test(p) ? 'DTS-HD HRA' : /hd/i.test(p) ? 'DTS-HD' : /es/i.test(p) ? 'DTS-ES' : 'DTS';
  const base = CODEC_TXT[s.codec] || (s.codec || '?').toUpperCase();
  return /atmos/i.test(p) ? base + ' · Atmos' : base;
}
// Bitrate der Spur („640 kbit/s“); fehlt sie in der Datei, bleibt es leer
const kbpsTxt = s => s && s.bitRate > 0 ? Math.round(s.bitRate / 1000) + ' kbit/s' : '';
// Beschreibung einer Spur: „E-AC-3 (Dolby Digital Plus) 5.1 · 640 kbit/s“ (bei Untertiteln nur die Kennung)
export const trkDesc = s => { const a = s.type === 'audio', main = [codecTxt(s), a ? chTxt(s.channels) : ''].filter(Boolean).join(' '); return a && kbpsTxt(s) ? main + ' · ' + kbpsTxt(s) : main; };
export const chTxt = n => ({1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1'}[n] || (n ? n + ' Kanäle' : ''));

// Empfehlung beim Neu-Kodieren: Bitrate gilt je Stereo-Paar; mehr Kanäle bekommen automatisch mehr (Kanäle ÷ 2, höchstens 640)
export const REC_NAME = {aac: 'AAC (läuft überall, empfohlen)', opus: 'Opus (sehr klein, modern)', ac3: 'AC-3 (Dolby Digital, für TV/AV-Receiver)', eac3: 'E-AC-3 (Dolby Digital Plus)', flac: 'FLAC (verlustfrei, groß)', mp3: 'MP3'};
const targetKbps = (perStereo, ch) => Math.min(640, ch > 2 ? Math.round(perStereo * ch / 2) : perStereo);
// Ziel einer umzuwandelnden Tonspur: Format, Kanäle und Bitrate (je Stereo-Paar eingestellt, bei Surround entsprechend mehr, höchstens 640)
const TARGET_NAME = {aac: 'AAC', opus: 'Opus', ac3: 'AC-3 (Dolby Digital)', eac3: 'E-AC-3 (Dolby Digital Plus)', flac: 'FLAC', mp3: 'MP3'};
export function trkEncInfo(r) {
  const s = r.s, c = r.codec || $('#vAudioCodec').value, ch = s.channels || 2;
  const per = r.kbps || (r.codec ? REC_KBPS[c] : +$('#vAudioKbps').value) || REC_KBPS[c] || 160;
  const raw = ch > 2 ? Math.round(per * ch / 2) : per, flac = c === 'flac';
  return {c, ch, per, raw, kbps: flac ? 0 : Math.min(640, raw), capped: !flac && raw > 640};
}
export const trkTargetDesc = r => { const e = trkEncInfo(r); return [TARGET_NAME[e.c] || e.c, chTxt(e.ch)].filter(Boolean).join(' ') + (e.kbps ? ' · ' + e.kbps + ' kbit/s' + (e.capped ? ' (Maximum)' : '') : ''); };
// Rechnung zur Bitrate in Worten (für Fenster und Karten)
export function trkEncExplain(r) {
  const e = trkEncInfo(r);
  if (e.c === 'flac') return 'FLAC ist verlustfrei – die Datei wird dadurch meist größer, nicht kleiner.';
  return `Ergebnis für diese Spur: ${e.kbps} kbit/s` + (e.ch > 2 ? ` (${chTxt(e.ch)}: ${e.per} × ${e.ch} ÷ 2 = ${e.raw}` + (e.capped ? `, auf höchstens 640 gedeckelt – mehr schafft der Encoder bei AC-3 und E-AC-3 nicht` : '') + ')' : ' (Stereo)') +
    `. Empfehlung: ${(TARGET_NAME[e.c] || e.c).split(' (')[0]} mit ${REC_KBPS[e.c] || e.per} kbit/s je Stereo-Paar.`;
}
export const fileLabel = f => f.rel || f.path.split(/[\\/]/).pop();

// ---------- Regeln (Codec → umwandeln/entfernen) und Sprach-Wünsche ----------
// Regeln dieses Laufs liegen im versteckten Feld #vTrkRules (und damit in Voreinstellungen): {audio, sub, usePrefs, off}.
// „off“ = Schlüssel der allgemeinen Regeln (Einstellungen → Regeln), die für diesen Lauf abgewählt sind.
export function trkRules() {
  let r = {}; try { r = JSON.parse($('#vTrkRules').value || '{}') || {}; } catch (e) { r = {}; }
  return {audio: Array.isArray(r.audio) ? r.audio : [], sub: [] /* Untertitel-Regeln gibt es seit 0.3.6 nicht mehr; gespeicherte werden ignoriert */, usePrefs: r.usePrefs !== false, off: Array.isArray(r.off) ? r.off : []};
}
export function trkRulesSave(r) {
  const o = {audio: r.audio, sub: r.sub};
  if (r.usePrefs === false) o.usePrefs = false;
  if (r.off && r.off.length) o.off = r.off;
  $('#vTrkRules').value = (r.audio.length || r.usePrefs === false || (r.off && r.off.length)) ? JSON.stringify(o) : '';
  saveSettings();
}
const trkRuleKey = (type, x) => type === 'audio' ? ['a', x.codec || 'any', x.ch || 'any', x.action || 'copy', x.to || '', x.kbps || ''].join('/') : ['s', x.kind || 'any', x.action || 'copy'].join('/');
// allgemeine Regeln aus den Einstellungen: [{type, rule, key, on}] (on = für diesen Lauf nicht abgewählt)
export function trkGlobalList() {
  const g = cfg().trackRules || {}, off = new Set(trkRules().off);
  return [...(g.audio || []).map(rule => ({type: 'audio', rule})), ].map(e => { e.key = trkRuleKey(e.type, e.rule); e.on = !off.has(e.key); return e; });
}
const trkPrefs = () => { const p = cfg().trackPrefs || {}; return {audioKeep: p.audioKeep || [], subKeep: p.subKeep || [], audioDefault: p.audioDefault || [], subDefault: p.subDefault || []}; };
export const trkHasPrefs = () => { const p = trkPrefs(); return !!(p.audioKeep.length || p.subKeep.length || p.audioDefault.length || p.subDefault.length); };
function trkCfg() {
  const r = trkRules(), g = trkGlobalList().filter(e => e.on);
  // eigene Regeln dieses Laufs gehen vor, danach die allgemeinen (die erste passende gewinnt)
  return {audioRules: [...r.audio, ...g.filter(e => e.type === 'audio').map(e => e.rule)], subRules: [...r.sub, ...g.filter(e => e.type === 'sub').map(e => e.rule)], audioMode: $('#vAudioMode').value, audioCodec: $('#vAudioCodec').value, audioKbps: +$('#vAudioKbps').value,
    subMode: $('#vSubMode').value, usePrefs: r.usePrefs, prefs: trkPrefs()};
}
export const trkPlan = (f, info) => TP.plan(info, f.tracks, trkCfg());
export const trkPlanAuto = info => TP.plan(info, {}, trkCfg());

// ---------- eigene Änderungen je Datei ----------
export function trkEdit(f, idx) { return (f.tracks && f.tracks[idx]) || {}; }
export function trkSet(f, idx, patch) {
  f.tracks = f.tracks || {};
  const e = {...(f.tracks[idx] || {}), ...patch};
  Object.keys(e).forEach(k => { if (e[k] === undefined || e[k] === null) delete e[k]; });
  if (Object.keys(e).length) f.tracks[idx] = e; else delete f.tracks[idx];
  if (!Object.keys(f.tracks).length) delete f.tracks;
}
export const trkCount = f => Object.keys(f.tracks || {}).length;
const trkEditedFiles = () => S.files.video.filter(f => trkCount(f)).length;

async function trkProbe(f) {
  if (!TRK.probe[f.path]) TRK.probe[f.path] = api('/api/probe?path=' + encodeURIComponent(f.path)).catch(e => { delete TRK.probe[f.path]; throw e; });
  return TRK.probe[f.path];
}
// alle Dateien lesen (höchstens 6 gleichzeitig); fn(done, total) meldet den Fortschritt
export async function trkProbeAll(files, fn) {
  let i = 0, done = 0;
  const worker = async () => {
    while (i < files.length) {
      const f = files[i++];
      try { await trkProbe(f); } catch (e) { /* Datei nicht lesbar: wird übersprungen */ }
      done++; if (fn) fn(done, files.length);
    }
  };
  await Promise.all(Array.from({length: Math.min(6, files.length)}, worker));
}
// was für diese Datei an den Server geht: Regeln + Wünsche + eigene Änderungen (leer = nichts Besonderes)
export async function trackOverridesFor(f) {
  let info; try { info = await trkProbe(f); } catch (e) { return trkCount(f) ? {tracks: f.tracks} : {}; }
  const p = trkPlan(f, info);
  return Object.keys(p.edits).length ? {tracks: p.edits} : {};
}
const trkStreams = (info, type) => (info.streams || []).filter(s => s.type === type && !s.attachedPic);

// Genau eine Standard-Tonspur: Klick auf eine andere Spur setzt sie und nimmt allen übrigen den Standard (auch dem aus der Quelldatei oder der Rangliste);
// Klick auf die gesetzte Spur nimmt eine eigene Wahl zurück (dann gelten Rangliste bzw. Quelldatei wieder), sonst bleibt keine Spur Standard.
export function trkToggleAudioDefault(f, info, idx) {
  const aud = trkStreams(info, 'audio'), now = trkPlan(f, info).tracks.filter(r => r.type === 'audio'), cur = now.find(r => r.index === idx);
  const isDef = r => r && r.kept && r.def;
  const manual = aud.some(o => trkEdit(f, o.index).default !== undefined);
  if (isDef(cur)) {
    if (manual) aud.forEach(o => trkSet(f, o.index, {default: undefined}));
    else aud.forEach(o => trkSet(f, o.index, {default: o.default || now.some(r => r.index === o.index && r.def) ? false : undefined}));
    return;
  }
  aud.forEach(o => trkSet(f, o.index, {default: o.index === idx ? true : (o.default || now.some(r => r.index === o.index && r.def) ? false : undefined)}));
}







export function trkWarnings(f, info, plan) {
  const w = [], audio = plan.tracks.filter(r => r.type === 'audio');
  if (audio.length && audio.every(r => !r.kept)) w.push('Alle Tonspuren werden entfernt – die Datei hätte keinen Ton.');
  const forcedSub = plan.tracks.some(r => r.type === 'subtitle' && r.kept && r.forced && trkEdit(f, r.index).forced === true);
  if (forcedSub && $('#vContainer').value === 'mp4') w.push('„Forced“ (erzwungene Untertitel) erkennt Plex nur in MKV-Dateien. Bei MP4 bitte als Container MKV wählen.');
  return w;
}



// Promise-Ergebnisse zwischenspeichern (damit die Auswertung ohne await auskommt)
export async function trkLoadAll(files) {
  TRK.probing = files.length; TRK.probeDone = 0;
  await trkProbeAll(files, (d) => { TRK.probeDone = d; trkProgress(); });
  for (const f of files) { try { const v = await trkProbe(f); const p = TRK.probe[f.path]; if (p) p.__v = v; TRK.bad.delete(f.path); } catch (e) { TRK.bad.add(f.path); /* nicht lesbar */ } }
  TRK.probing = 0;
}
function trkProgress() {
  const el = $('#trkProgress'); if (el && TRK.probing) el.textContent = `Lese die Spuren aller Dateien … ${TRK.probeDone} von ${TRK.probing}`;
}
export const trkSum = a => a.reduce((n, x) => { const s = TP.summarize(x.plan); Object.keys(s).forEach(k => { n[k] = (n[k] || 0) + s[k]; }); return n; }, {});
export function trkSumText(n, files) {
  const t = [];
  if (n.dropLang) t.push(`${n.dropLang} Spuren wegen deiner Sprach-Liste entfernt`);
  if (n.dropRule) t.push(`${n.dropRule} Spuren durch Regeln entfernt`);
  if (n.dropOwn) t.push(`${n.dropOwn} Spuren von dir abgewählt`);
  if (n.encode) t.push(`${n.encode} Tonspuren umgewandelt`);
  if (n.defaults) t.push(`Standard-Spur bei ${n.defaults} Spuren nach deiner Rangliste gesetzt`);
  return t.length ? t.join(' · ') : 'Alles bleibt unverändert';
}



// ---------- Sprach-Wünsche (aus den Einstellungen) ----------
export function trkPrefLine() {
  const p = trkPrefs(), r = trkRules();
  if (!trkHasPrefs()) return h('div', {class: 'trkpref none'}, icon('info'), ' ', h('span', {}, 'Tipp: In Einstellungen → Audio & Untertitel legst du fest, welche Sprachen du behalten willst und welche Spur Standard sein soll. Dann schlägt das Programm das hier automatisch vor. '),
    h('button', {type: 'button', class: 'small', onclick: () => { location.hash = '#settings/tracks'; }}, 'Einstellungen öffnen'));
  const names = a => a.map(l => langName(l)).join(', ');
  const subs = p.subDefault.map(x => langName(x.lang) + (x.forced ? ' (Forced)' : '')).join(' → ');
  const parts = [p.audioKeep.length ? 'Ton behalten: ' + names(p.audioKeep) : null, p.audioDefault.length ? 'Standard-Ton: ' + p.audioDefault.map(langName).join(' → ') : null,
    p.subKeep.length ? 'Untertitel behalten: ' + names(p.subKeep) : null, p.subDefault.length ? 'Standard-Untertitel: ' + subs : null].filter(Boolean);
  const cb = h('input', {type: 'checkbox', checked: r.usePrefs, onchange: ev => { const rr = trkRules(); rr.usePrefs = ev.target.checked; trkRulesSave(rr); trkRender(); }});
  return h('div', {class: 'trkpref'}, h('label', {class: 'check'}, cb, h('span', {}, h('b', {}, 'Meine Sprach-Wünsche anwenden'))), h('div', {class: 'muted small'}, parts.join(' · ')),
    h('button', {type: 'button', class: 'small ghost', onclick: () => { location.hash = '#settings/tracks'; }}, 'Ändern'));
}

// ---------- Hauptdarstellung ----------
// Die Konvertieren-Seite (convert.js) zeichnet alles; Änderungen an Spuren und Regeln lösen nur noch das Neuzeichnen aus
export function trkRender() { if (typeof cvRender === 'function') cvRender(); trkRuleHint(); }

// Empfehlung unter den Regeln für alle Dateien (Bitrate je Stereo-Paar → was Surround bekommt)
export function trkRuleHint() {
  const el = $('#vAudioHint'); if (!el) return;
  const codec = $('#vAudioCodec').value, kbps = +$('#vAudioKbps').value || REC_KBPS[codec] || 160;
  el.textContent = $('#vAudioMode').value !== 'encode' ? '' : codec === 'flac' ? 'FLAC ist verlustfrei – die Datei wird dadurch meist größer.'
    : `Empfohlen: AAC mit 160 kbit/s. Die Bitrate gilt je Stereo-Paar: Stereo bekommt ${targetKbps(kbps, 2)}, eine 5.1-Spur automatisch ${targetKbps(kbps, 6)} und eine 7.1-Spur ${targetKbps(kbps, 8)} kbit/s.`;
}
