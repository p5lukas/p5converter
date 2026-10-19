'use strict';
/* Details → „Audio & Untertitel“ (Videowelt; die Tabelle in der Konvertieren-Ansicht arbeitet mit denselben Daten). Alles bleibt unverändert (Passthrough), solange man nichts festlegt.
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

// Klartext für Codecs
const CODEC_TXT = {ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', truehd: 'Dolby TrueHD', dts: 'DTS', aac: 'AAC', flac: 'FLAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis',
  alac: 'ALAC', pcm_s16le: 'PCM (unkomprimiert)', pcm_s24le: 'PCM (unkomprimiert)', pcm_s32le: 'PCM (unkomprimiert)', pcm_bluray: 'PCM (unkomprimiert)',
  subrip: 'SRT (Text)', srt: 'SRT (Text)', ass: 'ASS (Text mit Stil)', ssa: 'ASS (Text mit Stil)', webvtt: 'WebVTT (Text)', mov_text: 'MP4-Text', hdmv_pgs_subtitle: 'PGS (Bild)', dvd_subtitle: 'VobSub (Bild)', dvb_subtitle: 'DVB (Bild)'};
const LOSSLESS = ['truehd', 'flac', 'alac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_bluray'];
const isLossless = s => LOSSLESS.includes(s.codec) || (s.codec === 'dts' && /ma|hd/i.test(s.profile || ''));
const codecTxt = s => (s.codec === 'dts' && /ma|hd/i.test(s.profile || '')) ? 'DTS-HD' : (CODEC_TXT[s.codec] || (s.codec || '?').toUpperCase());
const chTxt = n => ({1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1'}[n] || (n ? n + ' Kanäle' : ''));

// Empfehlung beim Neu-Kodieren: Bitrate gilt je Stereo-Paar; mehr Kanäle bekommen automatisch mehr (Kanäle ÷ 2, höchstens 640)
const REC_NAME = {aac: 'AAC (läuft überall, empfohlen)', opus: 'Opus (sehr klein, modern)', ac3: 'AC-3 (Dolby Digital, für TV/AV-Receiver)', eac3: 'E-AC-3 (Dolby Digital Plus)', flac: 'FLAC (verlustfrei, groß)', mp3: 'MP3'};
const targetKbps = (perStereo, ch) => Math.min(640, ch > 2 ? Math.round(perStereo * ch / 2) : perStereo);
const fileLabel = f => f.rel || f.path.split(/[\\/]/).pop();

// ---------- Regeln (Codec → umwandeln/entfernen) und Sprach-Wünsche ----------
function trkRules() {
  let r = {}; try { r = JSON.parse($('#vTrkRules').value || '{}') || {}; } catch (e) { r = {}; }
  return {audio: Array.isArray(r.audio) ? r.audio : [], sub: Array.isArray(r.sub) ? r.sub : [], usePrefs: r.usePrefs !== false};
}
function trkRulesSave(r) { $('#vTrkRules').value = (r.audio.length || r.sub.length || r.usePrefs === false) ? JSON.stringify(r) : ''; saveSettings(); }
const trkPrefs = () => { const p = cfg().trackPrefs || {}; return {audioKeep: p.audioKeep || [], subKeep: p.subKeep || [], audioDefault: p.audioDefault || [], subDefault: p.subDefault || []}; };
const trkHasPrefs = () => { const p = trkPrefs(); return !!(p.audioKeep.length || p.subKeep.length || p.audioDefault.length || p.subDefault.length); };
function trkCfg() {
  const r = trkRules();
  return {audioRules: r.audio, subRules: r.sub, audioMode: $('#vAudioMode').value, audioCodec: $('#vAudioCodec').value, audioKbps: +$('#vAudioKbps').value,
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

// Behalten/Entfernen so setzen, dass nur dann eine eigene Änderung entsteht, wenn sie vom Vorschlag abweicht
function trkSetKeep(f, info, s, keep, auto) {
  auto = auto || trkPlanAuto(info);
  const a = auto.tracks.find(r => r.index === s.index);
  if (keep) trkSet(f, s.index, {action: a && a.kept ? undefined : 'copy', codec: undefined, kbps: undefined});
  else trkSet(f, s.index, {action: a && !a.kept ? undefined : 'drop', codec: undefined, kbps: undefined});
}
// alle Spuren einer Sprache in mehreren Dateien behalten/entfernen
async function trkSetLang(files, type, lang, keep) {
  for (const f of files) {
    let info; try { info = await trkProbe(f); } catch (e) { continue; }
    const auto = trkPlanAuto(info);
    trkStreams(info, type).filter(s => (noLang(s.lang) ? 'und' : normLang(s.lang)) === lang).forEach(s => trkSetKeep(f, info, s, keep, auto));
  }
  trkRender();
}

// ---------- Spurkarte (Einzelne Dateien) ----------
function trkLangSelect(f, s, e) {
  const val = e.lang !== undefined ? normLang(e.lang) : normLang(s.lang);
  const known = LANGS.some(x => x[0] === val);
  const opts = [h('option', {value: '', selected: noLang(val) && !val}, 'Unbekannt (keine Angabe)')];
  LANGS.forEach(([c, n]) => opts.push(h('option', {value: c, selected: c === val}, n + ' (' + c + ')')));
  if (val && !known && val !== 'und') opts.push(h('option', {value: val, selected: true}, val.toUpperCase() + ' (' + val + ')'));
  return h('select', {'aria-label': 'Sprache', onchange: ev => {
    const v = ev.target.value;
    trkSet(f, s.index, {lang: v === normLang(s.lang) || (!v && noLang(s.lang)) ? undefined : v}); trkRender();
  }}, opts);
}

function trkBadges(r, e) {
  const b = [];
  const why = r.why.length ? r.why[0] : '';
  if (!r.kept) b.push(h('span', {class: 'chip warn', title: why}, r.own ? 'wird entfernt' : (why ? 'wird entfernt (' + why.replace(/^Regel: /, '') + ')' : 'wird entfernt')));
  if (r.kept && r.def) b.push(h('span', {class: 'chip acc', title: 'Diese Spur startet der Player automatisch'}, 'Standard'));
  if (r.kept && r.forced && r.type === 'subtitle') b.push(h('span', {class: 'chip acc', title: 'Erzwungene Untertitel: werden nur bei fremdsprachigen Stellen gezeigt'}, 'Forced'));
  if (r.kept && r.type === 'subtitle' && r.guess) b.push(h('span', {class: 'chip', title: `Nur ${r.guess.n} statt ${r.guess.of} ${r.guess.unit}: wahrscheinlich Forced`}, 'Forced?'));
  if (r.kept && r.action === 'encode' && r.type === 'audio') b.push(h('span', {class: 'chip ok', title: why}, r.own ? 'wird kleiner gemacht' : 'wird umgewandelt' + (r.codec ? ' (' + r.codec.toUpperCase() + ')' : '')));
  if (Object.keys(e).some(k => !['action', 'codec', 'kbps'].includes(k))) b.push(h('span', {class: 'chip'}, 'geändert'));
  return b;
}

function trkCard(f, info, r, auto) {
  const s = r.s, e = trkEdit(f, s.index), isA = s.type === 'audio', kept = r.kept;
  const a0 = auto.tracks.find(x => x.index === s.index);
  const key = f.path + '#' + s.index, open = TRK.open.has(key);
  const lang = r.lang;
  const tit = e.title !== undefined ? e.title : (s.title || '');
  const enc = r.action === 'encode' && isA;
  const codec = r.codec || $('#vAudioCodec').value, perStereo = r.kbps || (r.codec ? REC_KBPS[codec] : +$('#vAudioKbps').value) || REC_KBPS[codec] || 160;
  const parts = [codecTxt(s), isA ? chTxt(s.channels) : '', isA && s.sampleRate ? s.sampleRate / 1000 + ' kHz' : ''].filter(Boolean);

  const keep = h('input', {type: 'checkbox', checked: kept, 'aria-label': 'Spur behalten', onchange: ev => { trkSetKeep(f, info, s, ev.target.checked, auto); trkRender(); }});
  const act = isA ? h('select', {class: 'trk-act', 'aria-label': 'Was soll mit dem Ton passieren?', disabled: !kept, onchange: ev => {
    const want = ev.target.value || 'copy';
    if (want === a0.action && !(a0.action === 'encode' && r.own && e.codec)) trkSet(f, s.index, {action: undefined, codec: undefined, kbps: undefined});
    else trkSet(f, s.index, want === 'encode' ? {action: 'encode', codec: undefined, kbps: undefined} : {action: 'copy', codec: undefined, kbps: undefined});
    if (want === 'encode') TRK.open.add(key);
    trkRender();
  }},
    h('option', {value: '', selected: !enc}, 'So lassen (empfohlen)'),
    h('option', {value: 'encode', selected: enc}, 'Kleiner machen (neu kodieren)')) : null;

  const adv = h('div', {class: 'trkadv'},
    h('div', {class: 'trkgrid'},
      h('label', {}, h('span', {class: 'lt'}, 'Titel (so heißt die Spur im Player)'), h('input', {value: tit, placeholder: isA ? 'z. B. Deutsch 5.1' : 'z. B. Deutsch', disabled: !kept,
        onchange: ev => { trkSet(f, s.index, {title: ev.target.value === (s.title || '') ? undefined : ev.target.value}); trkRender(); }})),
      h('label', {}, h('span', {class: 'lt'}, 'Sprache'), trkLangSelect(f, s, e)),
      !isA ? h('label', {class: 'check'}, h('input', {type: 'checkbox', checked: r.forced, disabled: !kept,
        onchange: ev => { trkSet(f, s.index, {forced: ev.target.checked === !!s.forced ? undefined : ev.target.checked}); trkRender(); }}),
        h('span', {}, 'Forced (erzwungene Untertitel)')) : null,
      isA ? h('label', {class: 'check'}, h('input', {type: 'radio', name: 'trkDefA', checked: r.def && kept, disabled: !kept, onchange: () => {
        // genau eine Standard-Tonspur: Änderungen an den anderen zurücknehmen
        trkStreams(info, 'audio').forEach(o => { if (o.index !== s.index) trkSet(f, o.index, {default: undefined}); });
        trkSet(f, s.index, {default: s.default ? undefined : true}); trkRender();
      }}), h('span', {}, 'Diese Tonspur startet automatisch'))
        : h('label', {class: 'check'}, h('input', {type: 'checkbox', checked: r.def && kept, disabled: !kept,
          onchange: ev => { trkSet(f, s.index, {default: ev.target.checked === !!s.default ? undefined : ev.target.checked}); trkRender(); }}), h('span', {}, 'Dieser Untertitel startet automatisch'))),
    enc ? h('div', {class: 'trkenc'},
      h('div', {class: 'trkgrid'},
        h('label', {}, h('span', {class: 'lt'}, 'Format'), h('select', {onchange: ev => { trkSet(f, s.index, {action: 'encode', codec: ev.target.value, kbps: REC_KBPS[ev.target.value]}); trkRender(); }},
          Object.keys(REC_NAME).map(c => h('option', {value: c, selected: c === codec}, REC_NAME[c])))),
        codec !== 'flac' ? h('label', {}, h('span', {class: 'lt'}, 'Bitrate je Stereo-Paar (kbit/s)'), h('input', {type: 'number', min: 32, max: 640, value: perStereo,
          onchange: ev => { trkSet(f, s.index, {action: 'encode', kbps: +ev.target.value > 0 ? +ev.target.value : undefined, codec: e.codec || codec}); trkRender(); }})) : null),
      h('p', {class: 'muted small'}, codec === 'flac' ? 'FLAC ist verlustfrei – die Datei wird dadurch meist größer, nicht kleiner.'
        : `Ergebnis für diese Spur: ${targetKbps(perStereo, s.channels || 2)} kbit/s` + ((s.channels || 2) > 2 ? ` (${chTxt(s.channels)}: ${perStereo} × ${s.channels} ÷ 2, höchstens 640)` : ' (Stereo)') +
        `. Empfehlung: ${REC_NAME[codec] ? REC_NAME[codec].split(' (')[0] : codec} mit ${REC_KBPS[codec] || perStereo} kbit/s.`),
      isLossless(s) ? h('p', {class: 'small warn'}, 'Diese Spur ist verlustfrei. Beim Kleinermachen geht ein Teil der Qualität unwiderruflich verloren; „So lassen“ ist verlustfrei und am schnellsten.') : null) : null);

  return h('div', {class: 'trkcard' + (kept ? '' : ' off') + (Object.keys(e).length ? ' edited' : '') + (open ? ' open' : '')},
    h('div', {class: 'trkkeep'}, keep),
    h('div', {class: 'trkmain'},
      h('div', {class: 'trkname'}, h('b', {}, langName(lang)), ' · ' + parts.join(' · '), ' ', trkBadges(r, e)),
      h('div', {class: 'muted small'}, 'Spur ' + s.index + (tit ? ' · Titel „' + tit + '“' : ' · ohne Titel'))),
    h('div', {class: 'trkact'}, act),
    h('button', {type: 'button', class: 'small ghost trkmore', 'aria-expanded': open ? 'true' : 'false', onclick: () => { open ? TRK.open.delete(key) : TRK.open.add(key); trkRender(); }}, open ? 'Weniger ▴' : 'Erweitert ▾'),
    open ? adv : null);
}

function trkGroup(f, info, plan, auto, type, title) {
  const list = plan.tracks.filter(r => r.type === type);
  if (!list.length) return h('p', {class: 'muted small'}, 'Diese Datei hat keine ' + (type === 'audio' ? 'Tonspuren' : 'Untertitel') + '.');
  const setAll = keep => { list.forEach(r => trkSetKeep(f, info, r.s, keep, auto)); trkRender(); };
  return h('div', {class: 'trkgroup'},
    h('div', {class: 'trkhead'}, h('h4', {}, title + ' (' + list.length + ')'),
      h('div', {class: 'btns'}, h('button', {type: 'button', class: 'small', onclick: () => setAll(true)}, 'Alle auswählen'), h('button', {type: 'button', class: 'small', onclick: () => setAll(false)}, 'Alle abwählen'))),
    h('div', {class: 'trklist'}, list.map(r => trkCard(f, info, r, auto))));
}

// ---------- Assistent: Hinweise zu dieser Datei ----------
function trkHints(f, info, plan) {
  const out = [], pr = trkPrefs();
  // keine Sprach-Wünsche festgelegt: der bisherige Tipp „nur Deutsch und Englisch“ (getrennt für Ton und Untertitel)
  [['audio', 'Tonspuren', pr.audioKeep], ['subtitle', 'Untertitel', pr.subKeep]].forEach(([type, noun, keepList]) => {
    if (trkRules().usePrefs && keepList.length) return;
    const KEEP = ['ger', 'eng'], list = plan.tracks.filter(r => r.type === type), kept = list.filter(r => r.kept);
    const foreign = kept.filter(r => !noLang(r.s.lang) && !KEEP.includes(normLang(r.s.lang)));
    const wanted = kept.filter(r => noLang(r.s.lang) || KEEP.includes(normLang(r.s.lang)));
    if (list.length >= 3 && foreign.length && wanted.length) {
      const langs = [...new Set(list.map(r => langName(r.s.lang)))];
      out.push({text: `Diese Datei hat ${list.length} ${noun} in ${langs.length} Sprachen (${langs.join(', ')}). Nur Deutsch und Englisch behalten?` + (type === 'audio' ? ' Prüfe vorher, ob die Originalsprache dabei ist.' : '') + ' (Dauerhaft festlegen: Einstellungen → Audio & Untertitel.)',
        btn: 'Nur Deutsch und Englisch behalten', fn: () => { foreign.forEach(r => trkSetKeep(f, info, r.s, false)); trkRender(); }});
    }
  });
  if (plan.guard.audio) out.push({text: 'Diese Datei hat keine der Tonsprachen aus deiner Liste. Deshalb wurde hier nichts entfernt.', btn: null});
  if (plan.guard.sub) out.push({text: 'Diese Datei hat keine der Untertitelsprachen aus deiner Liste. Deshalb wurden hier keine Untertitel entfernt.', btn: null});
  trkStreams(info, 'subtitle').forEach(s => {
    const e = trkEdit(f, s.index), t = e.title !== undefined ? e.title : s.title || '', r = plan.tracks.find(x => x.index === s.index);
    if (r && r.kept && /forced|erzwungen|narrative|nur fremd/i.test(t) && !r.forced) {
      out.push({text: `Der Untertitel „${t}“ (Spur ${s.index}) sieht wie ein Forced-Untertitel (erzwungene Untertitel) aus, ist aber nicht so markiert. Plex zeigt ihn dann nicht von selbst bei fremdsprachigen Stellen (nur in MKV).`,
        btn: 'Als Forced markieren', fn: () => { trkSet(f, s.index, {forced: true}); trkRender(); }});
    }
  });
  plan.tracks.forEach(r => {
    if (r.kept && r.type === 'subtitle' && r.guess) {
      out.push({text: `Der Untertitel ${langName(r.s.lang)} (Spur ${r.index}) hat nur ${r.guess.n} statt ${r.guess.of} ${r.guess.unit} wie die vollständige Spur und ist deshalb wahrscheinlich ein Forced-Untertitel (erzwungene Untertitel, nur bei fremdsprachigen Stellen). Er ist nicht so markiert.`,
        btn: 'Als Forced markieren', fn: () => { trkSet(f, r.index, {forced: true}); trkRender(); }});
    }
  });
  plan.tracks.forEach(r => {
    if (r.kept && noLang(r.lang)) {
      out.push({text: `${r.type === 'audio' ? 'Bei der Tonspur' : 'Beim Untertitel'} ${r.index} fehlt die Sprache. Ohne Sprache ordnet Plex sie nicht richtig zu.`,
        btn: 'Sprache festlegen', fn: () => { TRK.open.add(f.path + '#' + r.index); trkRender(); }});
    }
  });
  return out;
}

function trkWarnings(f, info, plan) {
  const w = [], audio = plan.tracks.filter(r => r.type === 'audio');
  if (audio.length && audio.every(r => !r.kept)) w.push('Alle Tonspuren werden entfernt – die Datei hätte keinen Ton.');
  const forcedSub = plan.tracks.some(r => r.type === 'subtitle' && r.kept && r.forced && trkEdit(f, r.index).forced === true);
  if (forcedSub && $('#vContainer').value === 'mp4') w.push('„Forced“ (erzwungene Untertitel) erkennt Plex nur in MKV-Dateien. Bei MP4 bitte als Container MKV wählen.');
  return w;
}

// überträgt die Änderungen an f auf alle anderen Dateien (gleiche Art, gleiche Reihenfolge: 2. Tonspur → 2. Tonspur)
async function trkApplyAll(f, info) {
  const others = S.files.video.filter(x => x !== f);
  if (!others.length) return;
  TRK.busy = true; trkRender();
  let skipped = 0;
  try {
    const ord = (inf, s) => trkStreams(inf, s.type).findIndex(x => x.index === s.index);
    for (const o of others) {
      let oi; try { oi = await trkProbe(o); } catch (e) { skipped++; continue; }
      o.tracks = {};
      Object.entries(f.tracks || {}).forEach(([k, e]) => {
        const s = info.streams.find(x => x.index === +k); if (!s) return;
        const t = trkStreams(oi, s.type)[ord(info, s)]; if (!t) return;
        o.tracks[t.index] = {...e};
      });
      if (!Object.keys(o.tracks).length) delete o.tracks;
    }
  } finally { TRK.busy = false; }
  toast(skipped ? `Übernommen, ${skipped} Datei(en) ließen sich nicht lesen.` : 'Änderungen auf ' + others.length + (others.length === 1 ? ' weitere Datei' : ' weitere Dateien') + ' übertragen.', skipped ? 'bad' : 'ok');
  trkRender();
}

// ---------- Ansicht „Einzelne Dateien“ ----------
async function trkSingleView(files) {
  if (TRK.cur >= files.length) TRK.cur = 0;
  const f = files[TRK.cur];
  let info;
  try { info = await trkProbe(f); } catch (e) { return h('div', {class: 'empty warn'}, 'Die Spuren konnten nicht gelesen werden: ' + e.message); }
  const plan = trkPlan(f, info), auto = trkPlanAuto(info);
  const sel = h('select', {id: 'trkFile', 'aria-label': 'Datei wählen', onchange: ev => { TRK.cur = +ev.target.value; trkRender(); }},
    files.map((x, i) => h('option', {value: i, selected: i === TRK.cur}, fileLabel(x) + (trkCount(x) ? ' ●' : ''))));
  const warns = trkWarnings(f, info, plan), hints = trkHints(f, info, plan);
  return h('div', {},
    h('div', {class: 'trkbar'},
      files.length > 1 ? h('label', {class: 'inline'}, h('span', {class: 'lt'}, 'Datei'), sel) : h('b', {}, fileLabel(f)),
      h('div', {class: 'btns'},
        files.length > 1 ? h('button', {type: 'button', class: 'small', disabled: TRK.busy || !trkCount(f), title: 'Überträgt deine Änderungen an dieser Datei auf alle anderen Dateien (gleiche Art und Reihenfolge der Spur).', onclick: () => trkApplyAll(f, info)}, TRK.busy ? 'Übertrage …' : 'Auf alle Dateien anwenden') : null,
        h('button', {type: 'button', class: 'small ghost', disabled: !trkCount(f), onclick: () => { delete f.tracks; trkRender(); }}, 'Änderungen zurücknehmen'))),
    warns.length ? h('div', {class: 'banner warn'}, warns.map(x => h('div', {}, icon('warn'), ' ' + x))) : null,
    hints.length ? h('div', {class: 'trkhints'}, h('div', {class: 'trkhintshead'}, icon('bolt'), ' Tipps zu dieser Datei'),
      hints.map(x => h('div', {class: 'trkhint2'}, h('span', {}, x.text), x.btn ? h('button', {type: 'button', class: 'small', onclick: x.fn}, x.btn) : null))) : null,
    trkGroup(f, info, plan, auto, 'audio', 'Tonspuren'),
    trkGroup(f, info, plan, auto, 'subtitle', 'Untertitel'));
}

// ---------- Auswertung aller Dateien (Gruppen, Tabelle, Gesamtwirkung) ----------
// {f, info, plan, auto, sig} für alle schon gelesenen Dateien
function trkAnalyze(files) {
  const out = [];
  for (const f of files) {
    const p = TRK.probe[f.path]; if (!p || !p.__v) continue;
    const info = p.__v, plan = trkPlan(f, info);
    out.push({f, info, plan, sig: TP.signature(info)});
  }
  return out;
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
// eine Zeile je Spur: „Deutsch · DTS 5.1 → AC-3 640 kbit/s · Standard“
function trkResultLine(r) {
  const s = r.s, isA = r.type === 'audio', nm = langName(r.lang) + ' · ' + [codecTxt(s), isA ? chTxt(s.channels) : ''].filter(Boolean).join(' ');
  let res;
  if (!r.kept) res = 'entfernt' + (r.why.length && !r.own ? ' (' + r.why[0].replace(/^Regel: /, 'Regel: ') + ')' : r.own ? ' (von dir abgewählt)' : '');
  else if (isA && r.action === 'encode') { const c = r.codec || $('#vAudioCodec').value, k = c === 'flac' ? '' : ' ' + targetKbps(r.kbps || (r.codec ? REC_KBPS[c] : +$('#vAudioKbps').value) || REC_KBPS[c] || 160, s.channels || 2) + ' kbit/s'; res = '→ ' + (REC_NAME[c] || c).split(' (')[0] + k; }
  else res = 'unverändert';
  return {text: nm, res, cls: !r.kept ? 'warn' : r.action === 'encode' && isA ? 'ok' : '', def: r.kept && r.def && r.why.some(w => w.startsWith('Standard')), forced: r.kept && r.forced && r.type === 'subtitle'};
}

// ---------- Ansicht „Gruppen“ ----------
function trkGroupsView(files) {
  const all = trkAnalyze(files);
  if (!all.length) return h('div', {class: 'empty'}, 'Keine Datei ließ sich lesen.');
  const groups = new Map();
  all.forEach(x => { if (!groups.has(x.sig.key)) groups.set(x.sig.key, {key: x.sig.key, sig: x.sig, items: []}); groups.get(x.sig.key).items.push(x); });
  const list = [...groups.values()].sort((a, b) => b.items.length - a.items.length);
  const total = trkSum(all);
  const langChips = (type, sig, g) => sig[type].slice().sort(byLang).map(l => {
    const tracks = g.items.flatMap(x => x.plan.tracks.filter(r => r.type === (type === 'audio' ? 'audio' : 'subtitle') && (noLang(r.s.lang) ? 'und' : normLang(r.s.lang)) === l));
    const nKept = tracks.filter(r => r.kept).length, state = nKept === tracks.length ? 'all' : nKept === 0 ? 'none' : 'some';
    const cb = h('input', {type: 'checkbox', checked: state === 'all', 'aria-label': (type === 'audio' ? 'Ton ' : 'Untertitel ') + langName(l) + ' behalten',
      onchange: ev => trkSetLang(g.items.map(x => x.f), type === 'audio' ? 'audio' : 'subtitle', l, ev.target.checked)});
    cb.indeterminate = state === 'some';
    return h('label', {class: 'langchip ' + state, title: state === 'all' ? 'wird behalten' : state === 'none' ? 'wird entfernt' : 'in einem Teil der Dateien entfernt'}, cb, langName(l));
  });
  const cards = list.map((g, gi) => {
    const ex = g.items[0], n = g.items.length, sum = trkSum(g.items), openList = TRK.openGroups.has(g.key);
    const lines = ex.plan.tracks.map(trkResultLine);
    const odd = list.length > 1 && gi > 0;
    return h('div', {class: 'trkgrp' + (odd ? ' odd' : '')},
      h('div', {class: 'trkgrphead'}, h('b', {}, n === 1 ? '1 Datei' : n + ' Dateien'), odd ? h('span', {class: 'chip warn', title: 'Diese Dateien sind anders aufgebaut als die größte Gruppe'}, 'Abweichung') : null,
        h('span', {class: 'muted small'}, trkSumText(sum, g.items))),
      h('div', {class: 'trkgrprow'}, h('span', {class: 'lt'}, 'Ton'), h('div', {class: 'langchips'}, g.sig.audio.length ? langChips('audio', g.sig, g) : h('span', {class: 'muted small'}, 'keine Tonspur'))),
      h('div', {class: 'trkgrprow'}, h('span', {class: 'lt'}, 'Untertitel'), h('div', {class: 'langchips'}, g.sig.sub.length ? langChips('sub', g.sig, g) : h('span', {class: 'muted small'}, 'keine Untertitel'))),
      h('div', {class: 'trkex'}, h('div', {class: 'muted small'}, 'Was passiert (Beispiel: ' + fileLabel(ex.f) + '):'),
        lines.map(l => h('div', {class: 'trkexline ' + l.cls}, h('span', {}, l.text), h('span', {class: 'trkexres'}, l.res), l.def ? h('span', {class: 'chip acc'}, 'Standard') : null, l.forced ? h('span', {class: 'chip acc'}, 'Forced') : null))),
      h('div', {class: 'btns'},
        h('button', {type: 'button', class: 'small', onclick: () => { openList ? TRK.openGroups.delete(g.key) : TRK.openGroups.add(g.key); trkRender(); }}, openList ? 'Dateien ausblenden ▴' : 'Dateien anzeigen ▾')),
      openList ? h('div', {class: 'trkfiles'}, g.items.map(x => h('div', {class: 'trkfilerow'}, h('span', {title: x.f.path}, fileLabel(x.f) + (trkCount(x.f) ? ' ●' : '')),
        h('button', {type: 'button', class: 'small ghost', onclick: () => { TRK.cur = files.indexOf(x.f); TRK.view = 'single'; trkRender(); }}, 'Bearbeiten')))) : null);
  });
  return h('div', {},
    h('div', {class: 'trktotal'}, icon('bolt'), ' ', h('b', {}, files.length === 1 ? '1 Datei: ' : files.length + ' Dateien in ' + list.length + (list.length === 1 ? ' Gruppe: ' : ' Gruppen: ')), trkSumText(total, all)),
    trkRuleSuggestions(all),
    h('p', {class: 'muted small'}, 'Dateien mit denselben Sprachen sind zusammengefasst. Ein Haken bei einer Sprache gilt für die ganze Gruppe. Für einzelne Spuren: „Bearbeiten“ oder die Ansicht „Einzelne Dateien“.'),
    cards);
}

// ---------- Ansicht „Tabelle“ ----------
function trkMatrixView(files) {
  const all = trkAnalyze(files);
  if (!all.length) return h('div', {class: 'empty'}, 'Keine Datei ließ sich lesen.');
  const cols = type => {
    const cnt = new Map();
    all.forEach(x => x.sig[type === 'audio' ? 'audio' : 'sub'].forEach(l => cnt.set(l, (cnt.get(l) || 0) + 1)));
    return [...cnt.entries()].sort((a, b) => b[1] - a[1] || byLang(a[0], b[0])).map(e => e[0]);
  };
  const ac = cols('audio'), sc = cols('sub');
  const tracksOf = (x, type, l) => x.plan.tracks.filter(r => r.type === type && (noLang(r.s.lang) ? 'und' : normLang(r.s.lang)) === l);
  const head = (type, l) => {
    const t = all.flatMap(x => tracksOf(x, type, l)), nk = t.filter(r => r.kept).length;
    const cb = h('input', {type: 'checkbox', checked: nk === t.length, 'aria-label': 'Alle ' + langName(l) + ' behalten', onchange: ev => trkSetLang(all.filter(x => tracksOf(x, type, l).length).map(x => x.f), type, l, ev.target.checked)});
    cb.indeterminate = nk > 0 && nk < t.length;
    return h('th', {class: 'mxcol ' + type}, h('label', {title: langName(l)}, cb, h('span', {}, langName(l))));
  };
  const cell = (x, type, l) => {
    const t = tracksOf(x, type, l);
    if (!t.length) return h('td', {class: 'mxno'}, '–');
    const nk = t.filter(r => r.kept).length;
    const cb = h('input', {type: 'checkbox', checked: nk === t.length, 'aria-label': fileLabel(x.f) + ': ' + langName(l), onchange: ev => trkSetLang([x.f], type, l, ev.target.checked)});
    cb.indeterminate = nk > 0 && nk < t.length;
    const det = t.map(r => [codecTxt(r.s), type === 'audio' ? chTxt(r.s.channels) : '', r.action === 'encode' && r.kept && type === 'audio' ? '→ ' + (r.codec || $('#vAudioCodec').value).toUpperCase() : ''].filter(Boolean).join(' ')).join(', ');
    return h('td', {class: 'mxcell' + (nk === 0 ? ' off' : '') + (t.some(r => r.def && r.kept) ? ' def' : ''), title: det}, h('label', {}, cb, h('small', {}, det)));
  };
  return h('div', {},
    h('div', {class: 'trktotal'}, icon('bolt'), ' ', trkSumText(trkSum(all), all)),
    trkRuleSuggestions(all),
    h('p', {class: 'muted small'}, 'Zeilen sind Dateien, Spalten sind Sprachen. Ein Haken heißt „behalten“; der Haken in der Spaltenüberschrift gilt für alle Dateien. Fett = Standard-Spur.'),
    h('div', {class: 'mxwrap'}, h('table', {class: 'mx'},
      h('thead', {}, h('tr', {}, h('th', {class: 'mxfile'}, 'Datei'), ac.length ? h('th', {colspan: ac.length, class: 'mxgrp'}, 'Ton') : null, sc.length ? h('th', {colspan: sc.length, class: 'mxgrp'}, 'Untertitel') : null, h('th', {}, '')),
        h('tr', {}, h('th', {class: 'mxfile'}, ''), ac.map(l => head('audio', l)), sc.map(l => head('subtitle', l)), h('th', {}, ''))),
      h('tbody', {}, all.map(x => h('tr', {}, h('td', {class: 'mxfile', title: x.f.path}, fileLabel(x.f) + (trkCount(x.f) ? ' ●' : '')),
        ac.map(l => cell(x, 'audio', l)), sc.map(l => cell(x, 'subtitle', l)),
        h('td', {}, h('button', {type: 'button', class: 'small ghost', onclick: () => { TRK.cur = files.indexOf(x.f); TRK.view = 'single'; trkRender(); }}, 'Bearbeiten'))))))));
}

// ---------- Regel-Vorschläge aus den gelesenen Dateien ----------
function trkRuleSuggestions(all) {
  const r = trkRules(), out = [];
  const count = fn => all.filter(x => x.info.streams.some(fn)).length;
  const hasAudioRule = codec => r.audio.some(x => x.codec === codec || x.codec === 'any');
  const nDts = count(s => s.type === 'audio' && ['dts', 'dtshd'].includes(TP.codecKey(s)));
  if (nDts && !hasAudioRule('dts') && !r.audio.some(x => x.codec === 'dtshd')) out.push({text: `${nDts} ${nDts === 1 ? 'Datei hat' : 'Dateien haben'} DTS-Tonspuren. Viele Fernseher und Player können DTS nicht. Alle DTS-Spuren in AC-3 umwandeln, den Rest unverändert lassen?`,
    btn: 'Regel anlegen: DTS → AC-3', fn: () => { r.audio.push({codec: 'dts', ch: 'any', action: 'encode', to: 'ac3', kbps: 192}); trkRulesSave(r); TRK.rulesOpen = true; trkRender(); }});
  const nTh = count(s => s.type === 'audio' && TP.codecKey(s) === 'truehd');
  if (nTh && !hasAudioRule('truehd')) out.push({text: `${nTh} ${nTh === 1 ? 'Datei hat' : 'Dateien haben'} TrueHD-Tonspuren (sehr groß). Mit AC-3 wären sie deutlich kleiner und überall abspielbar.`,
    btn: 'Regel anlegen: TrueHD → AC-3', fn: () => { r.audio.push({codec: 'truehd', ch: 'any', action: 'encode', to: 'ac3', kbps: 192}); trkRulesSave(r); TRK.rulesOpen = true; trkRender(); }});
  const nImg = count(s => s.type === 'subtitle' && TP.subKind(s) === 'image');
  if (nImg && !r.sub.some(x => x.kind === 'image' || x.kind === 'any')) out.push({text: `${nImg} ${nImg === 1 ? 'Datei hat' : 'Dateien haben'} Bild-Untertitel (PGS/VobSub). Sie sind groß und manche Player zeigen sie nicht. Bild-Untertitel entfernen?`,
    btn: 'Regel anlegen: Bild-Untertitel entfernen', fn: () => { r.sub.push({kind: 'image', action: 'drop'}); trkRulesSave(r); TRK.rulesOpen = true; trkRender(); }});
  return out.length ? h('div', {class: 'trkhints'}, h('div', {class: 'trkhintshead'}, icon('bolt'), ' Vorschläge für Regeln'),
    out.map(x => h('div', {class: 'trkhint2'}, h('span', {}, x.text), h('button', {type: 'button', class: 'small', onclick: x.fn}, x.btn)))) : null;
}

// ---------- Regel-Editor ----------
function trkRulesEditor() {
  const r = trkRules(), cfgA = TP.RULE_CODECS, move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; trkRulesSave(r); trkRender(); };
  const sel = (opts, val, on, aria) => h('select', {'aria-label': aria, onchange: ev => on(ev.target.value)}, opts.map(([v, t]) => h('option', {value: v, selected: v === val}, t)));
  const ctl = (arr, i) => h('div', {class: 'rulectl'}, h('button', {type: 'button', class: 'small ghost', title: 'Nach oben', disabled: i === 0, onclick: () => move(arr, i, -1)}, '↑'),
    h('button', {type: 'button', class: 'small ghost', title: 'Nach unten', disabled: i === arr.length - 1, onclick: () => move(arr, i, 1)}, '↓'),
    h('button', {type: 'button', class: 'small ghost', title: 'Regel entfernen', onclick: () => { arr.splice(i, 1); trkRulesSave(r); trkRender(); }}, '✕'));
  const audioRows = r.audio.map((x, i) => h('div', {class: 'trkrule'},
    h('span', {class: 'rn'}, i + 1),
    h('span', {class: 'rtxt'}, 'Wenn die Spur'),
    sel(cfgA, x.codec || 'any', v => { x.codec = v; trkRulesSave(r); trkRender(); }, 'Codec'),
    sel([['any', 'mit beliebig vielen Kanälen'], ['multi', 'Surround (mehr als 2 Kanäle)'], ['stereo', 'Stereo oder Mono']], x.ch || 'any', v => { x.ch = v; trkRulesSave(r); trkRender(); }, 'Kanäle'),
    h('span', {class: 'rtxt'}, 'ist →'),
    sel([['copy', 'unverändert lassen'], ['encode', 'umwandeln in'], ['drop', 'entfernen']], x.action || 'copy', v => { x.action = v; if (v === 'encode' && !x.to) x.to = 'ac3'; trkRulesSave(r); trkRender(); }, 'Aktion'),
    x.action === 'encode' ? sel(TP.RULE_TARGETS, x.to || 'aac', v => { x.to = v; x.kbps = TP.REC_KBPS[v]; trkRulesSave(r); trkRender(); }, 'Zielformat') : null,
    x.action === 'encode' && x.to !== 'flac' ? h('label', {class: 'rkbps'}, h('input', {type: 'number', min: 32, max: 640, value: x.kbps || TP.REC_KBPS[x.to || 'aac'] || 160, 'aria-label': 'Bitrate je Stereo-Paar',
      onchange: ev => { x.kbps = +ev.target.value > 0 ? +ev.target.value : undefined; trkRulesSave(r); trkRender(); }}), ' kbit/s je Stereo-Paar') : null,
    ctl(r.audio, i)));
  const subRows = r.sub.map((x, i) => h('div', {class: 'trkrule'},
    h('span', {class: 'rn'}, i + 1),
    h('span', {class: 'rtxt'}, 'Wenn der Untertitel'), sel(TP.SUB_KINDS, x.kind || 'any', v => { x.kind = v; trkRulesSave(r); trkRender(); }, 'Art'),
    h('span', {class: 'rtxt'}, 'ist →'), sel([['copy', 'behalten'], ['drop', 'entfernen']], x.action || 'copy', v => { x.action = v; trkRulesSave(r); trkRender(); }, 'Aktion'),
    ctl(r.sub, i)));
  const open = TRK.rulesOpen || r.audio.length || r.sub.length;
  return h('details', {class: 'trkrules', open: !!open, ontoggle: ev => { TRK.rulesOpen = ev.target.open; }},
    h('summary', {}, 'Regeln nach Format ', h('span', {class: 'muted small'}, r.audio.length + r.sub.length ? '(' + (r.audio.length + r.sub.length) + ' aktiv)' : '(keine – alles bleibt unverändert)'), ' ', infoBtn('trkRules')),
    h('p', {class: 'muted small'}, 'Die Regeln gelten für alle Dateien und laufen von oben nach unten: die erste passende gewinnt. Eigene Änderungen an einer Spur gehen immer vor. Beispiel: „DTS → umwandeln in AC-3“, alles andere bleibt unverändert. Speichern: im letzten Schritt mit „Als Voreinstellung speichern“ (Diskette); laden: über die Voreinstellungen im Schritt „Video“.'),
    h('h4', {}, 'Ton'), audioRows.length ? audioRows : h('p', {class: 'muted small'}, 'Noch keine Regel.'),
    h('div', {class: 'btns'}, h('button', {type: 'button', class: 'small', onclick: () => { r.audio.push({codec: 'dts', ch: 'any', action: 'encode', to: 'ac3', kbps: 192}); trkRulesSave(r); TRK.rulesOpen = true; trkRender(); }}, '+ Regel für Ton')),
    h('div', {class: 'grid2', style: 'margin-top:12px'}, $('#vAudioModeRow'), $('#vAudioCodecRow')),
    $('#vAudioHint'),
    h('h4', {}, 'Untertitel'), subRows.length ? subRows : h('p', {class: 'muted small'}, 'Noch keine Regel.'),
    h('div', {class: 'btns'}, h('button', {type: 'button', class: 'small', onclick: () => { r.sub.push({kind: 'image', action: 'drop'}); trkRulesSave(r); TRK.rulesOpen = true; trkRender(); }}, '+ Regel für Untertitel')),
    h('div', {class: 'grid2', style: 'margin-top:12px'}, $('#vSubModeRow')));
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
let trkRenderId = 0;
async function trkRender() {
  const box = $('#trackEditor'); if (!box) return;
  if (typeof cvRender === 'function') cvRender(); // die Tabelle in der Konvertieren-Ansicht folgt jeder Änderung
  const my = ++trkRenderId;
  if (!TRK.viewInit) { TRK.viewInit = true; const v = lsGet('p5trkview'); if (['groups', 'matrix', 'single'].includes(v)) TRK.view = v; }
  const files = S.files.video;
  fill($('#trkTop'), trkPrefLine(), trkRulesEditor());
  trkRuleHint();
  if (!files.length) { fill(box, h('div', {class: 'empty'}, 'Noch keine Dateien. Füge zuerst im Konverter Videos hinzu – danach siehst du hier die Spuren jeder Datei.')); return; }
  const views = [['groups', 'Gruppen'], ['matrix', 'Tabelle'], ['single', 'Einzelne Dateien']];
  const sw = h('div', {class: 'trkviews', role: 'tablist'}, views.map(([id, t]) => h('button', {type: 'button', role: 'tab', 'aria-selected': TRK.view === id ? 'true' : 'false', class: TRK.view === id ? 'on' : '',
    onclick: () => { TRK.view = id; lsSet('p5trkview', id); trkRender(); }}, t)), infoBtn('trkViews'));
  if (TRK.view !== 'single' && files.some(f => !(TRK.probe[f.path] && TRK.probe[f.path].__v) && !TRK.bad.has(f.path))) {
    fill(box, sw, h('div', {class: 'empty', id: 'trkProgress'}, 'Lese die Spuren aller Dateien …'));
    await trkLoadAll(files);
    if (my !== trkRenderId) return;
  }
  const body = TRK.view === 'single' ? await trkSingleView(files) : TRK.view === 'matrix' ? trkMatrixView(files) : trkGroupsView(files);
  if (my !== trkRenderId) return;
  fill(box, sw, body, h('p', {class: 'muted small trkfoot'}, 'Plex liest Sprache und „Forced“ (erzwungene Untertitel) aus der Datei. Danach in Plex die Bibliothek bzw. das Element neu analysieren („Analysieren“), sonst bleiben die alten Angaben stehen.'));
}

// Für die Zusammenfassung: was passiert insgesamt? (liest bei Bedarf alle Dateien)
async function trkSummaryLines() {
  const files = S.files.video;
  if (!files.length) return [];
  if (files.some(f => !(TRK.probe[f.path] && TRK.probe[f.path].__v) && !TRK.bad.has(f.path))) await trkLoadAll(files);
  const all = trkAnalyze(files);
  return [trkSumText(trkSum(all), all)];
}

// Empfehlung unter den Regeln für alle Dateien (Bitrate je Stereo-Paar → was Surround bekommt)
function trkRuleHint() {
  const el = $('#vAudioHint'); if (!el) return;
  const codec = $('#vAudioCodec').value, kbps = +$('#vAudioKbps').value || REC_KBPS[codec] || 160;
  el.textContent = $('#vAudioMode').value !== 'encode' ? '' : codec === 'flac' ? 'FLAC ist verlustfrei – die Datei wird dadurch meist größer.'
    : `Empfohlen: AAC mit 160 kbit/s. Die Bitrate gilt je Stereo-Paar: Stereo bekommt ${targetKbps(kbps, 2)}, eine 5.1-Spur automatisch ${targetKbps(kbps, 6)} und eine 7.1-Spur ${targetKbps(kbps, 8)} kbit/s.`;
}
