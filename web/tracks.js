'use strict';
/* Schritt „Audio & Untertitel“ (Videowelt): Regeln für alle Dateien plus Tabelle der einzelnen Spuren einer Datei.
   Alles bleibt Passthrough, solange nichts geändert wird. Die Änderungen je Datei liegen in f.tracks = {streamIndex: {…}}
   und gehen als overrides.tracks an den Server (internal/build/video.go: TrackEdit).
   Nutzt S, $, h(), fill(), api(), esc() usw. aus app.js/settings.js (nur zur Laufzeit). */

const TRK = {probe: {}, cur: 0, busy: false};
const LANGS = [['ger', 'Deutsch'], ['eng', 'Englisch'], ['fre', 'Französisch'], ['spa', 'Spanisch'], ['ita', 'Italienisch'], ['jpn', 'Japanisch'], ['kor', 'Koreanisch'],
  ['chi', 'Chinesisch'], ['rus', 'Russisch'], ['por', 'Portugiesisch'], ['dut', 'Niederländisch'], ['pol', 'Polnisch'], ['tur', 'Türkisch'], ['swe', 'Schwedisch'],
  ['dan', 'Dänisch'], ['nor', 'Norwegisch'], ['fin', 'Finnisch'], ['cze', 'Tschechisch'], ['hun', 'Ungarisch'], ['gre', 'Griechisch'], ['ara', 'Arabisch'], ['hin', 'Hindi'], ['und', 'Unbestimmt']];
const TRK_AUDIO_CODECS = [['aac', 'AAC'], ['opus', 'Opus'], ['ac3', 'AC-3'], ['eac3', 'E-AC-3'], ['flac', 'FLAC'], ['mp3', 'MP3']];

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

function trkDesc(s) {
  if (s.type === 'audio') return [s.channels ? s.channels + ' Kanäle' : '', s.layout || '', s.sampleRate ? s.sampleRate / 1000 + ' kHz' : ''].filter(Boolean).join(' · ');
  return s.forced ? 'als „Forced“ markiert' : '';
}

function trkLangInput(f, s, e) {
  const val = e.lang !== undefined ? e.lang : (s.lang || '');
  const inp = h('input', {class: 'trk-lang', value: val, maxlength: 3, placeholder: 'ger', list: 'trkLangs', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Sprache (drei Buchstaben)',
    onchange: ev => {
      const v = ev.target.value.trim().toLowerCase();
      trkSet(f, s.index, {lang: v === (s.lang || '') ? undefined : v}); trkRender();
    }});
  return inp;
}

function trkRow(f, info, s) {
  const e = trkEdit(f, s.index), drop = e.action === 'drop', isA = s.type === 'audio';
  const kept = !drop;
  const action = e.action && e.action !== 'drop' ? e.action : '';
  const tit = e.title !== undefined ? e.title : (s.title || '');
  const forced = e.forced !== undefined ? e.forced : !!s.forced;
  let def = e.default !== undefined ? e.default : !!s.default;
  if (isA && e.default === undefined && Object.values(f.tracks || {}).some(x => x.default === true)) def = false;
  const edited = Object.keys(e).length > 0;
  const actSel = h('select', {class: 'trk-act', 'aria-label': 'Aktion', disabled: !kept, onchange: ev => { trkSet(f, s.index, {action: ev.target.value || undefined}); trkRender(); }},
    h('option', {value: '', selected: !action}, 'Standard'),
    h('option', {value: 'copy', selected: action === 'copy'}, 'Unverändert kopieren'),
    isA ? h('option', {value: 'encode', selected: action === 'encode'}, 'Neu kodieren') : null);
  const enc = isA && action === 'encode' ? h('div', {class: 'trk-enc'},
    h('select', {'aria-label': 'Audio-Codec', onchange: ev => { trkSet(f, s.index, {codec: ev.target.value || undefined}); }},
      h('option', {value: ''}, 'Codec der Regel'), TRK_AUDIO_CODECS.map(([v, t]) => h('option', {value: v, selected: e.codec === v}, t))),
    h('input', {type: 'number', min: 32, max: 640, placeholder: 'kbit/s', value: e.kbps || '', 'aria-label': 'Bitrate in kbit/s', onchange: ev => { trkSet(f, s.index, {kbps: +ev.target.value > 0 ? +ev.target.value : undefined}); }}),
    h('span', {class: 'muted small'}, 'kbit/s')) : null;
  return h('tr', {class: 'trk' + (drop ? ' off' : '') + (edited ? ' edited' : '')},
    h('td', {'data-l': 'Behalten', class: 'c'}, h('input', {type: 'checkbox', checked: kept, 'aria-label': 'Spur behalten',
      onchange: ev => { trkSet(f, s.index, {action: ev.target.checked ? undefined : 'drop', codec: undefined, kbps: undefined}); trkRender(); }})),
    h('td', {'data-l': 'Spur', class: 'trk-id'}, h('b', {}, '#' + s.index), ' ', h('span', {class: 'chip'}, s.codec || '?'), h('div', {class: 'muted small'}, trkDesc(s))),
    h('td', {'data-l': 'Aktion'}, actSel, enc),
    h('td', {'data-l': 'Titel'}, h('input', {class: 'trk-title', value: tit, placeholder: 'ohne Titel', disabled: !kept, 'aria-label': 'Titel der Spur',
      onchange: ev => { trkSet(f, s.index, {title: ev.target.value === (s.title || '') ? undefined : ev.target.value}); trkRender(); }})),
    h('td', {'data-l': 'Sprache'}, trkLangInput(f, s, e)),
    h('td', {'data-l': 'Forced', class: 'c'}, isA ? h('span', {class: 'muted'}, '–') :
      h('input', {type: 'checkbox', checked: forced, disabled: !kept, 'aria-label': 'Forced (erzwungen)',
        onchange: ev => { trkSet(f, s.index, {forced: ev.target.checked === !!s.forced ? undefined : ev.target.checked}); trkRender(); }})),
    h('td', {'data-l': 'Standard', class: 'c'}, isA
      ? h('input', {type: 'radio', name: 'trkDefA', checked: def && kept, disabled: !kept, 'aria-label': 'Standard-Audiospur',
        onchange: () => {
          // genau eine Standard-Audiospur: Flag-Änderungen an den anderen Audiospuren zurücknehmen
          trkStreams(info, 'audio').forEach(o => { if (o.index !== s.index) trkSet(f, o.index, {default: undefined}); });
          trkSet(f, s.index, {default: s.default ? undefined : true}); trkRender();
        }})
      : h('input', {type: 'checkbox', checked: def && kept, disabled: !kept, 'aria-label': 'Standard-Untertitel',
        onchange: ev => { trkSet(f, s.index, {default: ev.target.checked === !!s.default ? undefined : ev.target.checked}); trkRender(); }})));
}

function trkGroup(f, info, type, title) {
  const list = trkStreams(info, type);
  if (!list.length) return h('p', {class: 'muted small'}, 'Diese Datei hat keine ' + (type === 'audio' ? 'Audiospuren' : 'Untertitel') + '.');
  const setAll = keep => { list.forEach(s => trkSet(f, s.index, {action: keep ? undefined : 'drop', codec: undefined, kbps: undefined})); trkRender(); };
  return h('div', {class: 'trkgroup'},
    h('div', {class: 'trkhead'}, h('h4', {}, title + ' (' + list.length + ')'),
      h('div', {class: 'btns'}, h('button', {type: 'button', class: 'small', onclick: () => setAll(true)}, 'Alle auswählen'), h('button', {type: 'button', class: 'small', onclick: () => setAll(false)}, 'Alle abwählen'))),
    h('div', {class: 'tablewrap'}, h('table', {class: 'trktable'},
      h('thead', {}, h('tr', {}, ['Behalten', 'Spur', 'Aktion', 'Titel', 'Sprache', 'Forced', 'Standard'].map(t => h('th', {}, t)))),
      h('tbody', {}, list.map(s => trkRow(f, info, s))))));
}

function trkWarnings(f, info) {
  const w = [], audio = trkStreams(info, 'audio');
  if (audio.length && audio.every(s => trkEdit(f, s.index).action === 'drop')) w.push('Alle Audiospuren sind abgewählt – die Datei hätte keinen Ton.');
  const forcedSub = trkStreams(info, 'subtitle').some(s => trkEdit(f, s.index).forced === true);
  if (forcedSub && $('#vContainer').value === 'mp4') w.push('„Forced“ erkennt Plex nur in MKV-Dateien. Bei MP4 bitte als Container MKV wählen.');
  Object.entries(f.tracks || {}).forEach(([k, e]) => {
    const l = (e.lang || '').trim();
    if (e.lang !== undefined && l && !/^[a-z]{2,3}$/i.test(l)) w.push('Spur #' + k + ': „' + l + '“ ist kein Sprachcode. Bitte drei Buchstaben, z. B. ger oder eng.');
  });
  return w;
}

// überträgt die Änderungen an f auf alle anderen Dateien (gleiche Art, gleiche Reihenfolge: 2. Audiospur → 2. Audiospur)
async function trkApplyAll(f, info) {
  const others = S.files.video.filter(x => x !== f);
  if (!others.length) return;
  TRK.busy = true; trkRender();
  let n = 0, skipped = 0;
  try {
    const ord = (inf, s) => trkStreams(inf, s.type).findIndex(x => x.index === s.index);
    for (const o of others) {
      let oi; try { oi = await trkProbe(o); } catch (e) { skipped++; continue; }
      o.tracks = {};
      Object.entries(f.tracks || {}).forEach(([k, e]) => {
        const s = info.streams.find(x => x.index === +k); if (!s) return;
        const t = trkStreams(oi, s.type)[ord(info, s)]; if (!t) return;
        o.tracks[t.index] = {...e}; n++;
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
  if (!files.length) { fill(box, h('div', {class: 'empty'}, 'Noch keine Dateien. Füge zuerst im Schritt „Dateien“ Videos hinzu – danach kannst du hier einzelne Spuren ändern.')); return; }
  if (TRK.cur >= files.length) TRK.cur = 0;
  const f = files[TRK.cur];
  let info;
  try { info = await trkProbe(f); } catch (e) { fill(box, h('div', {class: 'empty warn'}, 'Die Spuren konnten nicht gelesen werden: ' + e.message)); return; }
  if (files[TRK.cur] !== f) return;
  const sel = h('select', {id: 'trkFile', 'aria-label': 'Datei wählen', onchange: ev => { TRK.cur = +ev.target.value; trkRender(); }},
    files.map((x, i) => h('option', {value: i, selected: i === TRK.cur}, (x.rel || x.path.split(/[\\/]/).pop()) + (trkCount(x) ? ' ●' : ''))));
  const warns = trkWarnings(f, info);
  fill(box,
    h('datalist', {id: 'trkLangs'}, LANGS.map(([c, n]) => h('option', {value: c}, n))),
    h('div', {class: 'trkbar'},
      files.length > 1 ? h('label', {class: 'inline'}, h('span', {class: 'lt'}, 'Datei'), sel) : h('b', {}, f.rel || f.path.split(/[\\/]/).pop()),
      h('div', {class: 'btns'},
        files.length > 1 ? h('button', {type: 'button', class: 'small', disabled: TRK.busy || !trkCount(f), title: 'Überträgt die Änderungen dieser Datei auf alle anderen (gleiche Art und Reihenfolge der Spur).', onclick: () => trkApplyAll(f, info)}, TRK.busy ? 'Übertrage …' : 'Auf alle Dateien anwenden') : null,
        h('button', {type: 'button', class: 'small ghost', disabled: !trkCount(f), onclick: () => { delete f.tracks; trkRender(); }}, 'Änderungen dieser Datei verwerfen'))),
    warns.length ? h('div', {class: 'banner warn'}, warns.map(x => h('div', {}, icon('warn'), ' ' + x))) : null,
    trkGroup(f, info, 'audio', 'Audiospuren'),
    trkGroup(f, info, 'subtitle', 'Untertitel'),
    h('p', {class: 'muted small trkhint'}, 'Plex liest Sprache und „Forced“ aus der Datei. Danach in Plex die Bibliothek bzw. das Element neu analysieren („Analysieren“), sonst bleiben die alten Angaben stehen.'));
}

// Für Zusammenfassung und Hinweise: wie viele Dateien haben eigene Spuränderungen
const trkEditedFiles = () => S.files.video.filter(f => trkCount(f)).length;
