'use strict';
/* Details → „Audio & Untertitel“ (Video; die Tabelle in der Konvertieren-Ansicht arbeitet mit denselben Daten). Alles bleibt unverändert (Passthrough), solange man nichts festlegt.
   Drei Ansichten: „Gruppen“ (Dateien mit gleichen Sprachen zusammengefasst, eine Entscheidung je Gruppe), „Tabelle“ (alle Dateien × Sprachen mit Häkchen)
   und „Einzelne Dateien“ (Spurkarten mit Erweitert). Darüber: Regeln nach Codec (z. B. nur DTS umwandeln) und die Sprach-Wünsche aus den Einstellungen.
   Berechnet wird alles in web/trkplan.js (reine Logik, mit Node getestet). Eigene Änderungen je Datei: f.tracks = {streamIndex: {…}} (gehen vor),
   zum Server geht pro Datei overrides.tracks (internal/build/video.go: TrackEdit).
   Nutzt S, $, h(), fill(), api(), icon() usw. aus app.js/settings.js (nur zur Laufzeit). */

const TRK = {probe: {}, bad: new Set(), cur: 0, busy: false, open: new Set(), view: 'groups', probing: 0, probeDone: 0, openGroups: new Set()};
const {normLang, noLang, REC_KBPS} = TP;

// Sprachen: Code (ISO 639-2, wie Plex sie liest) → Name; die häufigsten stehen zuerst
const LANGS = [['ger', 'Deutsch'], ['eng', 'Englisch'], ['fre', 'Französisch'], ['spa', 'Spanisch'], ['ita', 'Italienisch'], ['jpn', 'Japanisch'], ['kor', 'Koreanisch'],
  ['chi', 'Chinesisch'], ['rus', 'Russisch'], ['por', 'Portugiesisch'], ['dut', 'Niederländisch'], ['pol', 'Polnisch'], ['tur', 'Türkisch'], ['swe', 'Schwedisch'],
  ['dan', 'Dänisch'], ['nor', 'Norwegisch'], ['fin', 'Finnisch'], ['cze', 'Tschechisch'], ['hun', 'Ungarisch'], ['gre', 'Griechisch'], ['ara', 'Arabisch'], ['hin', 'Hindi']];
// Reihenfolge der Anzeige: häufige Sprachen zuerst (wie LANGS), unbekannte am Ende
const langRank = l => { const i = LANGS.findIndex(x => x[0] === normLang(l)); return l === 'und' ? 999 : i < 0 ? 500 : i; };
const byLang = (a, b) => langRank(a) - langRank(b) || (a < b ? -1 : 1);
const langName = l => noLang(l) ? 'Sprache unbekannt' : ((LANGS.find(x => x[0] === normLang(l)) || [])[1] || normLang(l).toUpperCase());

// Codec-Kennung zuerst, der Markenname in Klammern (ist beides gleich, steht es nur einmal): „E-AC-3 (Dolby Digital Plus)“
const CODEC_TXT = {ac3: 'AC-3 (Dolby Digital)', eac3: 'E-AC-3 (Dolby Digital Plus)', truehd: 'TrueHD (Dolby TrueHD)', dts: 'DTS', aac: 'AAC', flac: 'FLAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis',
  alac: 'ALAC', pcm_s16le: 'PCM (unkomprimiert)', pcm_s24le: 'PCM (unkomprimiert)', pcm_s32le: 'PCM (unkomprimiert)', pcm_bluray: 'PCM (unkomprimiert)',
  subrip: 'SRT (Text)', srt: 'SRT (Text)', ass: 'ASS (Text mit Stil)', ssa: 'ASS (Text mit Stil)', webvtt: 'WebVTT (Text)', mov_text: 'MP4-Text', hdmv_pgs_subtitle: 'PGS (Bild)', dvd_subtitle: 'VobSub (Bild)', dvb_subtitle: 'DVB (Bild)'};
const LOSSLESS = ['truehd', 'flac', 'alac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_bluray'];
const isLossless = s => LOSSLESS.includes(s.codec) || (s.codec === 'dts' && /ma|hd/i.test(s.profile || ''));
function codecTxt(s) {
  const p = s.profile || '';
  if (s.codec === 'dts') return /ma/i.test(p) ? 'DTS-HD MA' : /hra|high res/i.test(p) ? 'DTS-HD HRA' : /hd/i.test(p) ? 'DTS-HD' : /es/i.test(p) ? 'DTS-ES' : 'DTS';
  const base = CODEC_TXT[s.codec] || (s.codec || '?').toUpperCase();
  return /atmos/i.test(p) ? base + ' · Atmos' : base;
}
// Bitrate der Spur („640 kbit/s“); fehlt sie in der Datei, bleibt es leer
const kbpsTxt = s => s && s.bitRate > 0 ? Math.round(s.bitRate / 1000) + ' kbit/s' : '';
// Beschreibung einer Spur: „E-AC-3 (Dolby Digital Plus) 5.1 · 640 kbit/s“ (bei Untertiteln nur die Kennung)
const trkDesc = s => { const a = s.type === 'audio', main = [codecTxt(s), a ? chTxt(s.channels) : ''].filter(Boolean).join(' '); return a && kbpsTxt(s) ? main + ' · ' + kbpsTxt(s) : main; };
const chTxt = n => ({1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1'}[n] || (n ? n + ' Kanäle' : ''));

// Empfehlung beim Neu-Kodieren: Bitrate gilt je Stereo-Paar; mehr Kanäle bekommen automatisch mehr (Kanäle ÷ 2, höchstens 640)
const REC_NAME = {aac: 'AAC (läuft überall, empfohlen)', opus: 'Opus (sehr klein, modern)', ac3: 'AC-3 (Dolby Digital, für TV/AV-Receiver)', eac3: 'E-AC-3 (Dolby Digital Plus)', flac: 'FLAC (verlustfrei, groß)', mp3: 'MP3'};
const targetKbps = (perStereo, ch) => Math.min(640, ch > 2 ? Math.round(perStereo * ch / 2) : perStereo);
// Ziel einer umzuwandelnden Tonspur: Format, Kanäle und Bitrate (je Stereo-Paar eingestellt, bei Surround entsprechend mehr, höchstens 640)
const TARGET_NAME = {aac: 'AAC', opus: 'Opus', ac3: 'AC-3 (Dolby Digital)', eac3: 'E-AC-3 (Dolby Digital Plus)', flac: 'FLAC', mp3: 'MP3'};
function trkEncInfo(r) {
  const s = r.s, c = r.codec || $('#vAudioCodec').value, ch = s.channels || 2;
  const per = r.kbps || (r.codec ? REC_KBPS[c] : +$('#vAudioKbps').value) || REC_KBPS[c] || 160;
  const raw = ch > 2 ? Math.round(per * ch / 2) : per, flac = c === 'flac';
  return {c, ch, per, raw, kbps: flac ? 0 : Math.min(640, raw), capped: !flac && raw > 640};
}
const trkTargetDesc = r => { const e = trkEncInfo(r); return [TARGET_NAME[e.c] || e.c, chTxt(e.ch)].filter(Boolean).join(' ') + (e.kbps ? ' · ' + e.kbps + ' kbit/s' + (e.capped ? ' (Maximum)' : '') : ''); };
// Rechnung zur Bitrate in Worten (für Fenster und Karten)
function trkEncExplain(r) {
  const e = trkEncInfo(r);
  if (e.c === 'flac') return 'FLAC ist verlustfrei – die Datei wird dadurch meist größer, nicht kleiner.';
  return `Ergebnis für diese Spur: ${e.kbps} kbit/s` + (e.ch > 2 ? ` (${chTxt(e.ch)}: ${e.per} × ${e.ch} ÷ 2 = ${e.raw}` + (e.capped ? `, auf höchstens 640 gedeckelt – mehr schafft der Encoder bei AC-3 und E-AC-3 nicht` : '') + ')' : ' (Stereo)') +
    `. Empfehlung: ${(TARGET_NAME[e.c] || e.c).split(' (')[0]} mit ${REC_KBPS[e.c] || e.per} kbit/s je Stereo-Paar.`;
}
const fileLabel = f => f.rel || f.path.split(/[\\/]/).pop();

// ---------- Regeln (Codec → umwandeln/entfernen) und Sprach-Wünsche ----------
// Regeln dieses Laufs liegen im versteckten Feld #vTrkRules (und damit in Voreinstellungen): {audio, sub, usePrefs, off}.
// „off“ = Schlüssel der allgemeinen Regeln (Einstellungen → Regeln), die für diesen Lauf abgewählt sind.
function trkRules() {
  let r = {}; try { r = JSON.parse($('#vTrkRules').value || '{}') || {}; } catch (e) { r = {}; }
  return {audio: Array.isArray(r.audio) ? r.audio : [], sub: [] /* Untertitel-Regeln gibt es seit 0.3.6 nicht mehr; gespeicherte werden ignoriert */, usePrefs: r.usePrefs !== false, off: Array.isArray(r.off) ? r.off : []};
}
function trkRulesSave(r) {
  const o = {audio: r.audio, sub: r.sub};
  if (r.usePrefs === false) o.usePrefs = false;
  if (r.off && r.off.length) o.off = r.off;
  $('#vTrkRules').value = (r.audio.length || r.usePrefs === false || (r.off && r.off.length)) ? JSON.stringify(o) : '';
  saveSettings();
}
const trkRuleKey = (type, x) => type === 'audio' ? ['a', x.codec || 'any', x.ch || 'any', x.action || 'copy', x.to || '', x.kbps || ''].join('/') : ['s', x.kind || 'any', x.action || 'copy'].join('/');
// allgemeine Regeln aus den Einstellungen: [{type, rule, key, on}] (on = für diesen Lauf nicht abgewählt)
function trkGlobalList() {
  const g = cfg().trackRules || {}, off = new Set(trkRules().off);
  return [...(g.audio || []).map(rule => ({type: 'audio', rule})), ].map(e => { e.key = trkRuleKey(e.type, e.rule); e.on = !off.has(e.key); return e; });
}
const trkPrefs = () => { const p = cfg().trackPrefs || {}; return {audioKeep: p.audioKeep || [], subKeep: p.subKeep || [], audioDefault: p.audioDefault || [], subDefault: p.subDefault || []}; };
const trkHasPrefs = () => { const p = trkPrefs(); return !!(p.audioKeep.length || p.subKeep.length || p.audioDefault.length || p.subDefault.length); };
function trkCfg() {
  const r = trkRules(), g = trkGlobalList().filter(e => e.on);
  // eigene Regeln dieses Laufs gehen vor, danach die allgemeinen (die erste passende gewinnt)
  return {audioRules: [...r.audio, ...g.filter(e => e.type === 'audio').map(e => e.rule)], subRules: [...r.sub, ...g.filter(e => e.type === 'sub').map(e => e.rule)], audioMode: $('#vAudioMode').value, audioCodec: $('#vAudioCodec').value, audioKbps: +$('#vAudioKbps').value,
    subMode: $('#vSubMode').value, usePrefs: r.usePrefs, prefs: trkPrefs()};
}
const trkPlan = (f, info) => TP.plan(info, f.tracks, trkCfg());
const trkPlanAuto = info => TP.plan(info, {}, trkCfg());

// ---------- eigene Änderungen je Datei ----------
function trkEdit(f, idx) { return (f.tracks && f.tracks[idx]) || {}; }
function trkSet(f, idx, patch) {
  f.tracks = f.tracks || {};
  const e = {...(f.tracks[idx] || {}), ...patch};
  Object.keys(e).forEach(k => { if (e[k] === undefined || e[k] === null) delete e[k]; });
  if (Object.keys(e).length) f.tracks[idx] = e; else delete f.tracks[idx];
  if (!Object.keys(f.tracks).length) delete f.tracks;
}
const trkCount = f => Object.keys(f.tracks || {}).length;
const trkEditedFiles = () => S.files.video.filter(f => trkCount(f)).length;

async function trkProbe(f) {
  if (!TRK.probe[f.path]) TRK.probe[f.path] = api('/api/probe?path=' + encodeURIComponent(f.path)).catch(e => { delete TRK.probe[f.path]; throw e; });
  return TRK.probe[f.path];
}
// alle Dateien lesen (höchstens 6 gleichzeitig); fn(done, total) meldet den Fortschritt
async function trkProbeAll(files, fn) {
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
async function trackOverridesFor(f) {
  let info; try { info = await trkProbe(f); } catch (e) { return trkCount(f) ? {tracks: f.tracks} : {}; }
  const p = trkPlan(f, info);
  return Object.keys(p.edits).length ? {tracks: p.edits} : {};
}
const trkStreams = (info, type) => (info.streams || []).filter(s => s.type === type && !s.attachedPic);

// Genau eine Standard-Tonspur: Klick auf eine andere Spur setzt sie und nimmt allen übrigen den Standard (auch dem aus der Quelldatei oder der Rangliste);
// Klick auf die gesetzte Spur nimmt eine eigene Wahl zurück (dann gelten Rangliste bzw. Quelldatei wieder), sonst bleibt keine Spur Standard.
function trkToggleAudioDefault(f, info, idx) {
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







function trkWarnings(f, info, plan) {
  const w = [], audio = plan.tracks.filter(r => r.type === 'audio');
  if (audio.length && audio.every(r => !r.kept)) w.push('Alle Tonspuren werden entfernt – die Datei hätte keinen Ton.');
  const forcedSub = plan.tracks.some(r => r.type === 'subtitle' && r.kept && r.forced && trkEdit(f, r.index).forced === true);
  if (forcedSub && $('#vContainer').value === 'mp4') w.push('„Forced“ (erzwungene Untertitel) erkennt Plex nur in MKV-Dateien. Bei MP4 bitte als Container MKV wählen.');
  return w;
}



// Promise-Ergebnisse zwischenspeichern (damit die Auswertung ohne await auskommt)
async function trkLoadAll(files) {
  TRK.probing = files.length; TRK.probeDone = 0;
  await trkProbeAll(files, (d) => { TRK.probeDone = d; trkProgress(); });
  for (const f of files) { try { const v = await trkProbe(f); const p = TRK.probe[f.path]; if (p) p.__v = v; TRK.bad.delete(f.path); } catch (e) { TRK.bad.add(f.path); /* nicht lesbar */ } }
  TRK.probing = 0;
}
function trkProgress() {
  const el = $('#trkProgress'); if (el && TRK.probing) el.textContent = `Lese die Spuren aller Dateien … ${TRK.probeDone} von ${TRK.probing}`;
}
const trkSum = a => a.reduce((n, x) => { const s = TP.summarize(x.plan); Object.keys(s).forEach(k => { n[k] = (n[k] || 0) + s[k]; }); return n; }, {});
function trkSumText(n, files) {
  const t = [];
  if (n.dropLang) t.push(`${n.dropLang} Spuren wegen deiner Sprach-Liste entfernt`);
  if (n.dropRule) t.push(`${n.dropRule} Spuren durch Regeln entfernt`);
  if (n.dropOwn) t.push(`${n.dropOwn} Spuren von dir abgewählt`);
  if (n.encode) t.push(`${n.encode} Tonspuren umgewandelt`);
  if (n.defaults) t.push(`Standard-Spur bei ${n.defaults} Spuren nach deiner Rangliste gesetzt`);
  return t.length ? t.join(' · ') : 'Alles bleibt unverändert';
}



// ---------- Regel-Vorschläge aus den gelesenen Dateien ----------
// Ein Vorschlag lässt sich nur für diesen Lauf anlegen oder dauerhaft (Einstellungen → Regeln, gilt künftig überall)
function trkAddRule(type, rule, always) {
  if (always) { saveCfg(x => { x.trackRules = x.trackRules || {audio: [], sub: []}; (type === 'audio' ? x.trackRules.audio : x.trackRules.sub).push(rule); }, 'Regel in Einstellungen → Regeln gespeichert ✓').then(() => { trkRender(); }); return; }
  const r = trkRules(); (type === 'audio' ? r.audio : r.sub).push(rule); trkRulesSave(r); TRK.rulesOpen = true; trkRender();
}
function trkRuleSuggestionList(all) {
  const r = trkRules(), g = trkGlobalList(), out = [];
  const count = fn => all.filter(x => x.info.streams.some(fn)).length;
  const hasAudioRule = codec => [...r.audio, ...g.filter(e => e.type === 'audio' && e.on).map(e => e.rule)].some(x => x.codec === codec || x.codec === 'any');
  const nDts = count(s => s.type === 'audio' && ['dts', 'dtshd'].includes(TP.codecKey(s)));
  if (nDts && !hasAudioRule('dts') && !hasAudioRule('dtshd')) out.push({text: `${nDts} ${nDts === 1 ? 'Datei hat' : 'Dateien haben'} DTS-Tonspuren. Viele Fernseher und Player können DTS nicht. Alle DTS-Spuren in E-AC-3 (Dolby Digital Plus, 256 kbit/s je Stereo-Paar) umwandeln, den Rest unverändert lassen?`,
    label: 'DTS → E-AC-3', type: 'audio', rule: {codec: 'dts', ch: 'any', action: 'encode', to: 'eac3', kbps: 256}});
  const nTh = count(s => s.type === 'audio' && TP.codecKey(s) === 'truehd');
  if (nTh && !hasAudioRule('truehd')) out.push({text: `${nTh} ${nTh === 1 ? 'Datei hat' : 'Dateien haben'} TrueHD-Tonspuren (sehr groß). Mit E-AC-3 wären sie deutlich kleiner und überall abspielbar.`,
    label: 'TrueHD → E-AC-3', type: 'audio', rule: {codec: 'truehd', ch: 'any', action: 'encode', to: 'eac3', kbps: 256}});
  return out;
}
function trkRuleSuggestions(all) {
  const out = trkRuleSuggestionList(all);
  return out.length ? h('div', {class: 'trkhints'}, h('div', {class: 'trkhintshead'}, icon('bolt'), ' Vorschläge für Regeln'),
    out.map(x => h('div', {class: 'trkhint2'}, h('span', {}, x.text),
      h('span', {class: 'btns'}, h('button', {type: 'button', class: 'small', title: 'Die Regel gilt nur für diesen Lauf', onclick: () => trkAddRule(x.type, x.rule, false)}, 'Regel: ' + x.label),
        h('button', {type: 'button', class: 'small', title: 'Die Regel wird in Einstellungen → Regeln gespeichert und gilt künftig immer', onclick: () => trkAddRule(x.type, x.rule, true)}, 'Immer anwenden'))))) : null;
}

// Voreingestellte (allgemeine) Regeln mit Haken je Regel; mit „all“ (gelesene Dateien) zusätzlich „betrifft N Dateien“
function trkGlobalRules(all, withTitle) {
  const list = trkGlobalList(), off = () => trkRules();
  const toggle = (e, on) => { const r = trkRules(); r.off = r.off.filter(k => k !== e.key); if (!on) r.off.push(e.key); trkRulesSave(r); trkRender(); };
  const aff = e => all ? all.filter(x => (x.info.streams || []).some(s => !s.attachedPic && (e.type === 'audio' ? s.type === 'audio' && TP.audioRuleMatches(e.rule, s) : s.type === 'subtitle' && TP.subRuleMatches(e.rule, s)))).length : null;
  return h('div', {class: 'trkglobal'},
    h('div', {class: 'trkghead'}, withTitle ? [h('b', {}, 'Voreingestellte Regeln'), infoBtn('trkGlobal')] : null, h('span', {class: 'spacer'}), h('button', {type: 'button', class: 'small ghost', onclick: () => { location.hash = '#settings/rules'; }}, icon('gear'), ' In den Einstellungen ändern')),
    list.length ? list.map(e => { const n = aff(e);
      return h('label', {class: 'check trkgrule' + (e.on ? '' : ' off')}, h('input', {type: 'checkbox', checked: e.on, onchange: ev => toggle(e, ev.target.checked), 'aria-label': 'Regel anwenden'}),
        h('span', {class: 'trkgtxt'}, e.type === 'audio' ? TP.describeAudioRule(e.rule) : TP.describeSubRule(e.rule)),
        n != null ? h('span', {class: 'chip' + (n ? ' acc' : '')}, n ? 'betrifft ' + n + (n === 1 ? ' Datei' : ' Dateien') : 'betrifft keine Datei') : null); })
      : h('p', {class: 'muted small'}, 'Keine voreingestellten Regeln. Allgemeine Regeln legst du in den Einstellungen unter „Regeln“ an, sie gelten dann bei jedem Lauf.'));
}

// ---------- Regel-Editor ----------
// Eine Regelliste {audio: [...], sub: [...]} bearbeiten: für die Regeln dieses Laufs (#vTrkRules) und für die allgemeinen Regeln in den Einstellungen.
// save() speichert, redraw() zeichnet neu; withModes bettet „Alle übrigen Tonspuren/Untertitel“ ein (nur im Fenster Details).
const NEW_AUDIO_RULE = () => ({codec: 'dts', ch: 'any', action: 'encode', to: 'eac3', kbps: 256});
function trkRulesBody(r, save, redraw, withModes) {
  const cfgA = TP.RULE_CODECS, change = fn => { fn(); save(); redraw(); }, move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; change(() => { [arr[i], arr[j]] = [arr[j], arr[i]]; }); };
  const sel = (opts, val, on, aria) => h('select', {'aria-label': aria, onchange: ev => on(ev.target.value)}, opts.map(([v, t]) => h('option', {value: v, selected: v === val}, t)));
  const ctl = (arr, i) => h('div', {class: 'rulectl'}, h('button', {type: 'button', class: 'small ghost', title: 'Nach oben', disabled: i === 0, onclick: () => move(arr, i, -1)}, '↑'),
    h('button', {type: 'button', class: 'small ghost', title: 'Nach unten', disabled: i === arr.length - 1, onclick: () => move(arr, i, 1)}, '↓'),
    h('button', {type: 'button', class: 'small ghost', title: 'Regel entfernen', onclick: () => change(() => arr.splice(i, 1))}, '✕'));
  const audioRows = r.audio.map((x, i) => h('div', {class: 'trkrule'},
    h('span', {class: 'rn'}, i + 1),
    h('span', {class: 'rtxt'}, 'Wenn die Spur'),
    sel(cfgA, x.codec || 'any', v => change(() => { x.codec = v; }), 'Codec'),
    sel([['any', 'mit beliebig vielen Kanälen'], ['multi', 'Surround (mehr als 2 Kanäle)'], ['stereo', 'Stereo oder Mono']], x.ch || 'any', v => change(() => { x.ch = v; }), 'Kanäle'),
    h('span', {class: 'rtxt'}, 'ist →'),
    sel([['copy', 'unverändert lassen'], ['encode', 'umwandeln in'], ['drop', 'entfernen']], x.action || 'copy', v => change(() => { x.action = v; if (v === 'encode' && !x.to) x.to = 'ac3'; }), 'Aktion'),
    x.action === 'encode' ? sel(TP.RULE_TARGETS, x.to || 'aac', v => change(() => { x.to = v; x.kbps = TP.REC_KBPS[v]; }), 'Zielformat') : null,
    x.action === 'encode' && x.to !== 'flac' ? h('label', {class: 'rkbps'}, h('input', {type: 'number', min: 32, max: 640, value: x.kbps || TP.REC_KBPS[x.to || 'aac'] || 160, 'aria-label': 'Bitrate je Stereo-Paar',
      onchange: ev => change(() => { x.kbps = +ev.target.value > 0 ? +ev.target.value : undefined; })}), ' kbit/s je Stereo-Paar') : null,
    x.action === 'encode' && x.to !== 'flac' && (x.kbps || 0) * 3 > 640 ? h('span', {class: 'rtxt small'}, '5.1 wird dabei auf höchstens 640 kbit/s gedeckelt') : null,
    ctl(r.audio, i)));
  return [h('h4', {}, 'Ton'), audioRows.length ? audioRows : h('p', {class: 'muted small'}, 'Noch keine Regel.'),
    h('div', {class: 'btns'}, h('button', {type: 'button', class: 'small', onclick: () => change(() => r.audio.push(NEW_AUDIO_RULE()))}, '+ Regel für Ton')),
    withModes ? h('div', {class: 'grid2', style: 'margin-top:12px'}, $('#vAudioModeRow'), $('#vAudioCodecRow')) : null, withModes ? $('#vAudioHint') : null,
    withModes ? [h('h4', {}, 'Untertitel'), h('div', {class: 'grid2'}, $('#vSubModeRow'))] : null];
}

// ---------- Sprach-Wünsche (aus den Einstellungen) ----------
function trkPrefLine() {
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
function trkRender() { if (typeof cvRender === 'function') cvRender(); trkRuleHint(); }

// Empfehlung unter den Regeln für alle Dateien (Bitrate je Stereo-Paar → was Surround bekommt)
function trkRuleHint() {
  const el = $('#vAudioHint'); if (!el) return;
  const codec = $('#vAudioCodec').value, kbps = +$('#vAudioKbps').value || REC_KBPS[codec] || 160;
  el.textContent = $('#vAudioMode').value !== 'encode' ? '' : codec === 'flac' ? 'FLAC ist verlustfrei – die Datei wird dadurch meist größer.'
    : `Empfohlen: AAC mit 160 kbit/s. Die Bitrate gilt je Stereo-Paar: Stereo bekommt ${targetKbps(kbps, 2)}, eine 5.1-Spur automatisch ${targetKbps(kbps, 6)} und eine 7.1-Spur ${targetKbps(kbps, 8)} kbit/s.`;
}
