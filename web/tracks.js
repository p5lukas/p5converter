'use strict';
/* Schritt „Audio & Untertitel“ (Videowelt), Variante C: Alles bleibt unverändert (Passthrough), solange man nichts anfasst.
   Oben Regeln für alle Dateien, darunter die Spuren der gewählten Datei als einfache Karten (Behalten ☑, Klartext-Beschreibung,
   bei Ton „So lassen / Kleiner machen“) und je Spur ein aufklappbares „Erweitert“ (Titel, Sprache, Forced, Standard, Codec/Bitrate).
   Ein Assistent weist auf Auffälliges hin (viele Fremdsprachen, Forced-Untertitel ohne Markierung, fehlende Sprache …).
   Änderungen je Datei: f.tracks = {streamIndex: {…}} → overrides.tracks (internal/build/video.go: TrackEdit).
   Nutzt S, $, h(), fill(), api(), icon() usw. aus app.js/settings.js (nur zur Laufzeit). */

const TRK = {probe: {}, cur: 0, busy: false, open: new Set()};

// Sprachen: Code (ISO 639-2, wie Plex sie liest) → Name; die häufigsten stehen zuerst
const LANGS = [['ger', 'Deutsch'], ['eng', 'Englisch'], ['fre', 'Französisch'], ['spa', 'Spanisch'], ['ita', 'Italienisch'], ['jpn', 'Japanisch'], ['kor', 'Koreanisch'],
  ['chi', 'Chinesisch'], ['rus', 'Russisch'], ['por', 'Portugiesisch'], ['dut', 'Niederländisch'], ['pol', 'Polnisch'], ['tur', 'Türkisch'], ['swe', 'Schwedisch'],
  ['dan', 'Dänisch'], ['nor', 'Norwegisch'], ['fin', 'Finnisch'], ['cze', 'Tschechisch'], ['hun', 'Ungarisch'], ['gre', 'Griechisch'], ['ara', 'Arabisch'], ['hin', 'Hindi']];
// gleiche Zuordnung wie im Server (langAlias in video.go): 2-Buchstaben- und Bibliothekscodes → ein Code
const LANG_ALIAS = {de: 'ger', deu: 'ger', en: 'eng', fr: 'fre', fra: 'fre', es: 'spa', it: 'ita', ja: 'jpn', ru: 'rus', pt: 'por', nl: 'dut', nld: 'dut', pl: 'pol', tr: 'tur',
  zh: 'chi', zho: 'chi', ko: 'kor', sv: 'swe', da: 'dan', no: 'nor', nb: 'nor', nob: 'nor', fi: 'fin', cs: 'cze', ces: 'cze', hu: 'hun', el: 'gre', ell: 'gre', ar: 'ara', hi: 'hin'};
const normLang = l => { l = String(l || '').trim().toLowerCase(); return LANG_ALIAS[l] || l; };
const noLang = l => { l = normLang(l); return !l || l === 'und'; };
const langName = l => noLang(l) ? 'Sprache unbekannt' : ((LANGS.find(x => x[0] === normLang(l)) || [])[1] || normLang(l).toUpperCase());

// Klartext für Codecs
const CODEC_TXT = {ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', truehd: 'Dolby TrueHD', dts: 'DTS', aac: 'AAC', flac: 'FLAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis',
  alac: 'ALAC', pcm_s16le: 'PCM (unkomprimiert)', pcm_s24le: 'PCM (unkomprimiert)', pcm_s32le: 'PCM (unkomprimiert)', pcm_bluray: 'PCM (unkomprimiert)',
  subrip: 'SRT (Text)', srt: 'SRT (Text)', ass: 'ASS (Text mit Stil)', ssa: 'ASS (Text mit Stil)', webvtt: 'WebVTT (Text)', mov_text: 'MP4-Text', hdmv_pgs_subtitle: 'PGS (Bild)', dvd_subtitle: 'VobSub (Bild)', dvb_subtitle: 'DVB (Bild)'};
const LOSSLESS = ['truehd', 'flac', 'alac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_bluray'];
const isLossless = s => LOSSLESS.includes(s.codec) || (s.codec === 'dts' && /ma|hd/i.test(s.profile || ''));
const codecTxt = s => CODEC_TXT[s.codec] || (s.codec || '?').toUpperCase();
const chTxt = n => ({1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1'}[n] || (n ? n + ' Kanäle' : ''));

// Empfehlung beim Neu-Kodieren: Bitrate gilt je Stereo-Paar; mehr Kanäle bekommen automatisch mehr (Kanäle ÷ 2, höchstens 640)
const REC_KBPS = {aac: 160, opus: 96, ac3: 192, eac3: 192, mp3: 192};
const REC_NAME = {aac: 'AAC (läuft überall, empfohlen)', opus: 'Opus (sehr klein, modern)', ac3: 'AC-3 (Dolby Digital, für TV/AV-Receiver)', eac3: 'E-AC-3 (Dolby Digital Plus)', flac: 'FLAC (verlustfrei, groß)', mp3: 'MP3'};
const targetKbps = (perStereo, ch) => Math.min(640, ch > 2 ? Math.round(perStereo * ch / 2) : perStereo);

function trkEdit(f, idx) { return (f.tracks && f.tracks[idx]) || {}; }
function trkSet(f, idx, patch) {
  f.tracks = f.tracks || {};
  const e = {...(f.tracks[idx] || {}), ...patch};
  Object.keys(e).forEach(k => { if (e[k] === undefined || e[k] === null) delete e[k]; });
  if (Object.keys(e).length) f.tracks[idx] = e; else delete f.tracks[idx];
}
const trkCount = f => Object.keys(f.tracks || {}).length;
// was an den Server geht (leer = Regeln für alle Dateien gelten)
function trackOverrides(f) { return trkCount(f) ? {tracks: f.tracks} : {}; }

async function trkProbe(f) {
  if (!TRK.probe[f.path]) TRK.probe[f.path] = api('/api/probe?path=' + encodeURIComponent(f.path)).catch(e => { delete TRK.probe[f.path]; throw e; });
  return TRK.probe[f.path];
}
const trkStreams = (info, type) => (info.streams || []).filter(s => s.type === type && !s.attachedPic);
const langList = id => ($('#' + id).value || '').split(',').map(x => normLang(x)).filter(Boolean);

// Bleibt die Spur im Ergebnis? Eigene Wahl vor den Regeln oben (wie im Server)
function trkKept(s, e) {
  if (e.action === 'drop') return false;
  if (e.action === 'copy' || e.action === 'encode') return true;
  if (s.type === 'audio') { const w = langList('vAudioLangs'); return !w.length || noLang(s.lang) || w.includes(normLang(s.lang)); }
  if ($('#vSubMode').value === 'none') return false;
  const w = langList('vSubLangs'); return !w.length || noLang(s.lang) || w.includes(normLang(s.lang));
}
const trkRuleDrop = (s, e) => !e.action && !trkKept(s, e);

function trkLangSelect(f, s, e) {
  const val = e.lang !== undefined ? normLang(e.lang) : normLang(s.lang);
  const known = LANGS.some(x => x[0] === val);
  const opts = [h('option', {value: '', selected: noLang(val) && !val}, 'Unbekannt (keine Angabe)')];
  LANGS.forEach(([c, n]) => opts.push(h('option', {value: c, selected: c === val}, n + ' (' + c + ')')));
  if (val && !known && val !== 'und') opts.push(h('option', {value: val, selected: true}, val.toUpperCase() + ' (' + val + ')'));
  const sel = h('select', {'aria-label': 'Sprache', onchange: ev => {
    const v = ev.target.value;
    trkSet(f, s.index, {lang: v === normLang(s.lang) || (!v && noLang(s.lang)) ? undefined : v}); trkRender();
  }}, opts);
  return sel;
}

function trkBadges(s, e, kept, ruleDrop, forced, def) {
  const b = [];
  if (!kept) b.push(h('span', {class: 'chip warn'}, ruleDrop ? 'wird durch die Regel oben entfernt' : 'wird entfernt'));
  if (kept && def) b.push(h('span', {class: 'chip acc', title: 'Diese Spur startet der Player automatisch'}, 'Standard'));
  if (kept && forced) b.push(h('span', {class: 'chip acc', title: 'Wird nur bei fremdsprachigen Stellen gezeigt'}, 'Forced'));
  if (kept && e.action === 'encode') b.push(h('span', {class: 'chip ok'}, 'wird kleiner gemacht'));
  if (Object.keys(e).some(k => !['action', 'codec', 'kbps'].includes(k))) b.push(h('span', {class: 'chip'}, 'geändert'));
  return b;
}

function trkCard(f, info, s) {
  const e = trkEdit(f, s.index), isA = s.type === 'audio', kept = trkKept(s, e), ruleDrop = trkRuleDrop(s, e);
  const key = f.path + '#' + s.index, open = TRK.open.has(key);
  const lang = e.lang !== undefined ? e.lang : s.lang;
  const tit = e.title !== undefined ? e.title : (s.title || '');
  const forced = e.forced !== undefined ? e.forced : !!s.forced;
  let def = e.default !== undefined ? e.default : !!s.default;
  if (isA && e.default === undefined && Object.values(f.tracks || {}).some(x => x.default === true)) def = false;
  const enc = e.action === 'encode';
  const codec = e.codec || $('#vAudioCodec').value, perStereo = e.kbps || (e.codec ? REC_KBPS[codec] : +$('#vAudioKbps').value) || REC_KBPS[codec] || 160;
  const parts = [codecTxt(s), isA ? chTxt(s.channels) : '', isA && s.sampleRate ? s.sampleRate / 1000 + ' kHz' : ''].filter(Boolean);

  const keep = h('input', {type: 'checkbox', checked: kept, 'aria-label': 'Spur behalten', onchange: ev => {
    // Ein Häkchen gegen die Regel oben = ausdrücklich behalten; abwählen = entfernen
    if (ev.target.checked) trkSet(f, s.index, {action: trkKept(s, {}) ? undefined : 'copy'});
    else trkSet(f, s.index, {action: 'drop', codec: undefined, kbps: undefined});
    trkRender();
  }});
  const act = isA ? h('select', {class: 'trk-act', 'aria-label': 'Was soll mit dem Ton passieren?', disabled: !kept, onchange: ev => {
    trkSet(f, s.index, ev.target.value === 'encode' ? {action: 'encode'} : {action: undefined, codec: undefined, kbps: undefined}); if (ev.target.value === 'encode') TRK.open.add(key); trkRender();
  }},
    h('option', {value: '', selected: !enc}, 'So lassen (empfohlen)'),
    h('option', {value: 'encode', selected: enc}, 'Kleiner machen (neu kodieren)')) : null;

  const adv = h('div', {class: 'trkadv'},
    h('div', {class: 'trkgrid'},
      h('label', {}, h('span', {class: 'lt'}, 'Titel (so heißt die Spur im Player)'), h('input', {value: tit, placeholder: isA ? 'z. B. Deutsch 5.1' : 'z. B. Deutsch', disabled: !kept,
        onchange: ev => { trkSet(f, s.index, {title: ev.target.value === (s.title || '') ? undefined : ev.target.value}); trkRender(); }})),
      h('label', {}, h('span', {class: 'lt'}, 'Sprache'), trkLangSelect(f, s, e)),
      !isA ? h('label', {class: 'check'}, h('input', {type: 'checkbox', checked: forced, disabled: !kept,
        onchange: ev => { trkSet(f, s.index, {forced: ev.target.checked === !!s.forced ? undefined : ev.target.checked}); trkRender(); }}),
        h('span', {}, 'Nur bei fremdsprachigen Stellen zeigen (Forced)')) : null,
      isA ? h('label', {class: 'check'}, h('input', {type: 'radio', name: 'trkDefA', checked: def && kept, disabled: !kept, onchange: () => {
        // genau eine Standard-Tonspur: Änderungen an den anderen zurücknehmen
        trkStreams(info, 'audio').forEach(o => { if (o.index !== s.index) trkSet(f, o.index, {default: undefined}); });
        trkSet(f, s.index, {default: s.default ? undefined : true}); trkRender();
      }}), h('span', {}, 'Diese Tonspur startet automatisch'))
        : h('label', {class: 'check'}, h('input', {type: 'checkbox', checked: def && kept, disabled: !kept,
          onchange: ev => { trkSet(f, s.index, {default: ev.target.checked === !!s.default ? undefined : ev.target.checked}); trkRender(); }}), h('span', {}, 'Dieser Untertitel startet automatisch'))),
    enc ? h('div', {class: 'trkenc'},
      h('div', {class: 'trkgrid'},
        h('label', {}, h('span', {class: 'lt'}, 'Format'), h('select', {onchange: ev => { trkSet(f, s.index, {codec: ev.target.value, kbps: REC_KBPS[ev.target.value]}); trkRender(); }},
          Object.keys(REC_NAME).map(c => h('option', {value: c, selected: c === codec}, REC_NAME[c])))),
        codec !== 'flac' ? h('label', {}, h('span', {class: 'lt'}, 'Bitrate je Stereo-Paar (kbit/s)'), h('input', {type: 'number', min: 32, max: 640, value: perStereo,
          onchange: ev => { trkSet(f, s.index, {kbps: +ev.target.value > 0 ? +ev.target.value : undefined, codec: e.codec || codec}); trkRender(); }})) : null),
      h('p', {class: 'muted small'}, codec === 'flac' ? 'FLAC ist verlustfrei – die Datei wird dadurch meist größer, nicht kleiner.'
        : `Ergebnis für diese Spur: ${targetKbps(perStereo, s.channels || 2)} kbit/s` + ((s.channels || 2) > 2 ? ` (${chTxt(s.channels)}: ${perStereo} × ${s.channels} ÷ 2, höchstens 640)` : ' (Stereo)') +
        `. Empfehlung: ${REC_NAME[codec] ? REC_NAME[codec].split(' (')[0] : codec} mit ${REC_KBPS[codec] || perStereo} kbit/s.`),
      isLossless(s) ? h('p', {class: 'small warn'}, 'Diese Spur ist verlustfrei. Beim Kleinermachen geht ein Teil der Qualität unwiderruflich verloren; „So lassen“ ist verlustfrei und am schnellsten.') : null) : null);

  return h('div', {class: 'trkcard' + (kept ? '' : ' off') + (Object.keys(e).length ? ' edited' : '') + (open ? ' open' : '')},
    h('div', {class: 'trkkeep'}, keep),
    h('div', {class: 'trkmain'},
      h('div', {class: 'trkname'}, h('b', {}, langName(lang)), ' · ' + parts.join(' · '), ' ', trkBadges(s, e, kept, ruleDrop, forced, def)),
      h('div', {class: 'muted small'}, 'Spur ' + s.index + (tit ? ' · Titel „' + tit + '“' : ' · ohne Titel'))),
    h('div', {class: 'trkact'}, act),
    h('button', {type: 'button', class: 'small ghost trkmore', 'aria-expanded': open ? 'true' : 'false', onclick: () => { open ? TRK.open.delete(key) : TRK.open.add(key); trkRender(); }}, open ? 'Weniger ▴' : 'Erweitert ▾'),
    open ? adv : null);
}

function trkGroup(f, info, type, title) {
  const list = trkStreams(info, type);
  if (!list.length) return h('p', {class: 'muted small'}, 'Diese Datei hat keine ' + (type === 'audio' ? 'Tonspuren' : 'Untertitel') + '.');
  const setAll = keep => { list.forEach(s => trkSet(f, s.index, keep ? {action: trkKept(s, {}) ? undefined : 'copy'} : {action: 'drop', codec: undefined, kbps: undefined})); trkRender(); };
  return h('div', {class: 'trkgroup'},
    h('div', {class: 'trkhead'}, h('h4', {}, title + ' (' + list.length + ')'),
      h('div', {class: 'btns'}, h('button', {type: 'button', class: 'small', onclick: () => setAll(true)}, 'Alle auswählen'), h('button', {type: 'button', class: 'small', onclick: () => setAll(false)}, 'Alle abwählen'))),
    h('div', {class: 'trklist'}, list.map(s => trkCard(f, info, s))));
}

// ---------- Assistent: Hinweise zu dieser Datei ----------
function trkHints(f, info) {
  const out = [], KEEP = ['ger', 'eng'];
  [['audio', 'Tonspuren'], ['subtitle', 'Untertitel']].forEach(([type, noun]) => {
    const list = trkStreams(info, type), kept = list.filter(s => trkKept(s, trkEdit(f, s.index)));
    const foreign = kept.filter(s => !noLang(s.lang) && !KEEP.includes(normLang(s.lang)));
    const wanted = kept.filter(s => noLang(s.lang) || KEEP.includes(normLang(s.lang)));
    if (list.length >= 3 && foreign.length && wanted.length) {
      const langs = [...new Set(list.map(s => langName(s.lang)))];
      out.push({text: `Diese Datei hat ${list.length} ${noun} in ${langs.length} Sprachen (${langs.join(', ')}). Nur Deutsch und Englisch behalten?` + (type === 'audio' ? ' Prüfe vorher, ob die Originalsprache dabei ist.' : ''),
        btn: 'Nur Deutsch und Englisch behalten', fn: () => { foreign.forEach(s => trkSet(f, s.index, {action: 'drop', codec: undefined, kbps: undefined})); trkRender(); }});
    }
  });
  trkStreams(info, 'subtitle').forEach(s => {
    const e = trkEdit(f, s.index), t = e.title !== undefined ? e.title : s.title || '';
    if (trkKept(s, e) && /forced|erzwungen|narrative|nur fremd/i.test(t) && !(e.forced !== undefined ? e.forced : s.forced)) {
      out.push({text: `Der Untertitel „${t}“ (Spur ${s.index}) sieht wie ein Forced-Untertitel aus, ist aber nicht so markiert. Plex zeigt ihn dann nicht von selbst bei fremdsprachigen Stellen (nur in MKV).`,
        btn: 'Als Forced markieren', fn: () => { trkSet(f, s.index, {forced: true}); trkRender(); }});
    }
  });
  (info.streams || []).filter(s => (s.type === 'audio' || s.type === 'subtitle') && !s.attachedPic).forEach(s => {
    const e = trkEdit(f, s.index), l = e.lang !== undefined ? e.lang : s.lang;
    if (trkKept(s, e) && noLang(l)) {
      out.push({text: `${s.type === 'audio' ? 'Bei der Tonspur' : 'Beim Untertitel'} ${s.index} fehlt die Sprache. Ohne Sprache ordnet Plex sie nicht richtig zu.`,
        btn: 'Sprache festlegen', fn: () => { TRK.open.add(f.path + '#' + s.index); trkRender(); }});
    }
  });
  return out;
}

function trkWarnings(f, info) {
  const w = [], audio = trkStreams(info, 'audio');
  if (audio.length && audio.every(s => !trkKept(s, trkEdit(f, s.index)))) w.push('Alle Tonspuren werden entfernt – die Datei hätte keinen Ton.');
  const forcedSub = trkStreams(info, 'subtitle').some(s => trkEdit(f, s.index).forced === true);
  if (forcedSub && $('#vContainer').value === 'mp4') w.push('„Forced“ erkennt Plex nur in MKV-Dateien. Bei MP4 bitte als Container MKV wählen.');
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

async function trkRender() {
  const box = $('#trackEditor'); if (!box) return;
  const files = S.files.video;
  if (!files.length) { fill(box, h('div', {class: 'empty'}, 'Noch keine Dateien. Füge zuerst im Schritt „Dateien“ Videos hinzu – danach siehst du hier die Spuren jeder Datei.')); return; }
  if (TRK.cur >= files.length) TRK.cur = 0;
  const f = files[TRK.cur];
  let info;
  try { info = await trkProbe(f); } catch (e) { fill(box, h('div', {class: 'empty warn'}, 'Die Spuren konnten nicht gelesen werden: ' + e.message)); return; }
  if (files[TRK.cur] !== f) return;
  const sel = h('select', {id: 'trkFile', 'aria-label': 'Datei wählen', onchange: ev => { TRK.cur = +ev.target.value; trkRender(); }},
    files.map((x, i) => h('option', {value: i, selected: i === TRK.cur}, (x.rel || x.path.split(/[\\/]/).pop()) + (trkCount(x) ? ' ●' : ''))));
  const warns = trkWarnings(f, info), hints = trkHints(f, info);
  fill(box,
    h('div', {class: 'trkbar'},
      files.length > 1 ? h('label', {class: 'inline'}, h('span', {class: 'lt'}, 'Datei'), sel) : h('b', {}, f.rel || f.path.split(/[\\/]/).pop()),
      h('div', {class: 'btns'},
        files.length > 1 ? h('button', {type: 'button', class: 'small', disabled: TRK.busy || !trkCount(f), title: 'Überträgt deine Änderungen an dieser Datei auf alle anderen Dateien (gleiche Art und Reihenfolge der Spur).', onclick: () => trkApplyAll(f, info)}, TRK.busy ? 'Übertrage …' : 'Auf alle Dateien anwenden') : null,
        h('button', {type: 'button', class: 'small ghost', disabled: !trkCount(f), onclick: () => { delete f.tracks; trkRender(); }}, 'Änderungen zurücknehmen'))),
    warns.length ? h('div', {class: 'banner warn'}, warns.map(x => h('div', {}, icon('warn'), ' ' + x))) : null,
    hints.length ? h('div', {class: 'trkhints'}, h('div', {class: 'trkhintshead'}, icon('bolt'), ' Tipps zu dieser Datei'),
      hints.map(x => h('div', {class: 'trkhint2'}, h('span', {}, x.text), h('button', {type: 'button', class: 'small', onclick: x.fn}, x.btn)))) : null,
    trkGroup(f, info, 'audio', 'Tonspuren'),
    trkGroup(f, info, 'subtitle', 'Untertitel'),
    h('p', {class: 'muted small trkfoot'}, 'Plex liest Sprache und „Forced“ aus der Datei. Danach in Plex die Bibliothek bzw. das Element neu analysieren („Analysieren“), sonst bleiben die alten Angaben stehen.'));
}

// Für Zusammenfassung und Hinweise: wie viele Dateien haben eigene Spuränderungen
const trkEditedFiles = () => S.files.video.filter(f => trkCount(f)).length;

// Empfehlung unter den Regeln für alle Dateien (Bitrate je Stereo-Paar → was Surround bekommt)
function trkRuleHint() {
  const el = $('#vAudioHint'); if (!el) return;
  const codec = $('#vAudioCodec').value, kbps = +$('#vAudioKbps').value || REC_KBPS[codec] || 160;
  el.textContent = codec === 'flac' ? 'FLAC ist verlustfrei – die Datei wird dadurch meist größer.'
    : `Empfohlen: AAC mit 160 kbit/s. Die Bitrate gilt je Stereo-Paar: Stereo bekommt ${targetKbps(kbps, 2)}, eine 5.1-Spur automatisch ${targetKbps(kbps, 6)} und eine 7.1-Spur ${targetKbps(kbps, 8)} kbit/s.`;
}
