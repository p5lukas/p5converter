import { S, addScanned, api, fmtSize, infoBtn, openBrowser, pathLabel, toast } from './app.js';
import { cvLayout } from './convert.js';
import { icon } from './icons.js';
import { Q } from './quality.js';
import { fill, h } from './settings.js';

'use strict';
/* Bibliothek-Scan „Was lohnt sich?“ (Video, Schritt 1): ein Ordner wird auf dem Server rekursiv gelesen und ORDNERWEISE zusammengefasst
   (/api/library/scan). Es werden nie einzelne Dateien vorgeschlagen: die Zeilen zeigen Fakten (Dateien, Größe, Codec-Mix, Bitrate, schwere Tonformate,
   Bild-Untertitel); die Hinweise „lohnt sich eher“ entstehen aus diesen Fakten (LIB.hints, mit Node getestet: tools/test-library.js). Einzige Schätzung:
   „spart ≈ …“ (saveBytes vom Server, H.265 „Gut“, nur Bild) – immer mit „≈“ gekennzeichnet. „Übernehmen“ legt den ganzen Ordner (rekursiv) in Schritt 1 ab.
   Nutzt S, $, h(), fill(), api(), icon(), toast(), fmtSize(), pathLabel(), openBrowser(), addScanned() aus den anderen Dateien (nur zur Laufzeit). */

export const LIB = (() => {
  const CODEC = {h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9', mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2', vc1: 'VC-1', wmv3: 'WMV', msmpeg4v3: 'MPEG-4', '?': '?'};
  const MODERN = ['hevc', 'av1', 'vp9'];
  const codecName = c => CODEC[c] || String(c).toUpperCase();
  // „hohe Bitrate“ (gesamte Datei mit Ton, Bit/s): Schwelle je nach Bildhöhe
  const highLimit = h => h >= 2000 ? 25e6 : h >= 1000 ? 8e6 : h >= 700 ? 5e6 : 2.5e6;
  const mbit = b => (b / 1e6).toFixed(b >= 1e7 ? 0 : 1).replace('.', ',') + ' Mbit/s';
  const nf = n => Number(n).toLocaleString('de-DE'); // 15360 → 15.360
  const num = (n, one, many) => nf(n) + ' ' + (n === 1 ? one : many);

  // „H.264 ×3 · H.265 ×2“, die häufigsten zuerst
  const mix = codecs => Object.entries(codecs || {}).sort((a, b) => b[1] - a[1]).map(([c, n]) => codecName(c) + ' ×' + n).join(' · ');

  // Hinweise zu einem Ordner: [{id, text, good}]; good = spricht für „lohnt sich“. Nichts davon ist eine Größenschätzung (die steht getrennt in gainText).
  function hints(r, lowBitrate) {
    const out = [], files = r.files || 0;
    const olds = Object.entries(r.codecs || {}).filter(([c]) => c !== '?' && !MODERN.includes(c));
    const nOld = olds.reduce((a, [, n]) => a + n, 0);
    if (nOld) out.push({id: 'old', good: true, text: nOld === files ? 'Älterer Codec (' + olds.map(([c]) => codecName(c)).join(', ') + ')' : nf(nOld) + ' von ' + nf(files) + ' mit älterem Codec (' + olds.map(([c]) => codecName(c)).join(', ') + ')'});
    if (r.avgBitrate > highLimit(r.maxHeight || 0)) out.push({id: 'high', good: true, text: 'Hohe Bitrate (Ø ' + mbit(r.avgBitrate) + ')'});
    const hv = r.heavy || {};
    if (hv.truehd || hv.dtshd) out.push({id: 'heavy', good: true, text: 'Schwerer Ton (' + [hv.dtshd ? 'DTS-HD' : '', hv.truehd ? 'TrueHD' : ''].filter(Boolean).join(', ') + ')'});
    if (hv.dts) out.push({id: 'dts', good: true, text: 'DTS (viele Player können es nicht)'});
    if (r.imageSubs) out.push({id: 'img', good: true, text: 'Bild-Untertitel (' + num(r.imageSubs, 'Datei', 'Dateien') + ')'});
    if (lowBitrate && r.avgBitrate > 0 && lowBitrate(r.avgBitrate, r.maxHeight)) out.push({id: 'small', good: false, text: 'Schon klein (Ø ' + mbit(r.avgBitrate) + ')'});
    if (r.unreadable) out.push({id: 'bad', good: false, text: num(r.unreadable, 'Datei', 'Dateien') + ' nicht lesbar'});
    return out;
  }
  // lohnt sich ein Blick? (mindestens ein Hinweis, der dafür spricht)
  const worth = (r, lowBitrate) => hints(r, lowBitrate).some(x => x.good);

  // Filter-Kärtchen über der Liste: einzeln an- und abwählbar; ein Ordner bleibt sichtbar, wenn MINDESTENS EIN gewählter Hinweis zutrifft
  const FILTERS = [['old', 'Älterer Codec'], ['high', 'Hohe Bitrate'], ['heavy', 'Schwerer Ton / DTS'], ['img', 'Bild-Untertitel'], ['small', 'Schon klein']];
  const FILTER_DEFAULT = ['old', 'high', 'heavy', 'img']; // „Schon klein“ ist ein Hinweis dagegen und standardmäßig aus
  const filterOf = id => id === 'dts' ? 'heavy' : id;
  const filterIds = (r, lowBitrate) => new Set(hints(r, lowBitrate).map(x => filterOf(x.id)));
  const matches = (r, on, lowBitrate) => { const f = filterIds(r, lowBitrate); return [...on].some(id => f.has(id)); };
  const filterCounts = (rows, lowBitrate) => { const c = Object.fromEntries(FILTERS.map(([id]) => [id, 0])); rows.forEach(r => filterIds(r, lowBitrate).forEach(id => { if (id in c) c[id]++; })); return c; };

  // Anzeigename eines Ordners. Staffelordner („Season 01“, „Staffel 2“, „Specials“) heißen überall gleich, deshalb steht die Serie davor
  // (Serie › Season 01), außer im Ordnerbaum steht die Sammelzeile der Serie direkt darüber. Zusätze wie {tvdb-123} fallen weg (Tooltip: voller Pfad).
  const SEASON = /^(season|staffel|series|serie|s)[\s._-]*\d{1,3}$/i, EXTRA = /^(specials?|extras?|featurettes?)$/i;
  const seasonLike = n => SEASON.test(String(n).trim()) || EXTRA.test(String(n).trim());
  const clean = n => String(n).replace(/\s*[{\[](?:tvdb|tmdb|imdb)[-=: ]?[^}\]]*[}\]]/ig, '').replace(/\s{2,}/g, ' ').trim() || String(n);
  const parts = p => String(p).split(/[\\/]/).filter(Boolean);
  const parentDir = p => String(p).replace(/[\\/][^\\/]*$/, '');
  // groups: Pfade der gezeigten Sammelzeilen; tree: Ordnerbaum (eingerückt) oder flache Liste
  function title(r, groups, tree) {
    const a = parts(r.path), name = clean(r.name);
    if (r.group || !seasonLike(r.name) || a.length < 2) return {series: '', name, up: parentDir(r.path)};
    const parent = parentDir(r.path);
    if (tree && groups && groups.has(parent)) return {series: '', name, up: ''};
    return {series: clean(a[a.length - 2]), name, up: parentDir(parent)};
  }


  // ---------- Quelle der Dateien (Schritte „Regeln“ und „Wie umwandeln?“) ----------
  // list: [{info, size}] (info wie von /api/info: streams mit type, codec, height, bitDepth); name: {audio(s), sub(s)} liefern Kurznamen
  function sourceFacts(list, name) {
    name = name || {};
    const an = name.audio || (s => String(s.codec).toUpperCase()), sn = name.sub || an;
    const f = {files: list.length, bytes: 0, v: {}, heights: [], ten: 0, a: {}, s: {}, img: 0};
    for (const {info, size} of list) {
      f.bytes += size || info.size || 0;
      const vs = (info.streams || []).find(x => x.type === 'video' && !x.attachedPic), vc = vs ? vs.codec : '?';
      f.v[vc] = (f.v[vc] || 0) + 1;
      if (vs && vs.height) f.heights.push(vs.height);
      if (vs && vs.bitDepth > 8) f.ten++;
      const as = new Set(), ss = new Set();
      let img = false;
      for (const x of info.streams || []) {
        if (x.type === 'audio') as.add(an(x));
        else if (x.type === 'subtitle') { ss.add(sn(x)); if (['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'].includes(x.codec)) img = true; }
      }
      as.forEach(k => { f.a[k] = (f.a[k] || 0) + 1; }); ss.forEach(k => { f.s[k] = (f.s[k] || 0) + 1; });
      if (img) f.img++;
    }
    return f;
  }
  // „H.264 ×3 · H.265 ×2“; wenn alle Dateien dasselbe haben, steht nur der Name
  const mixAll = (map, total, label) => {
    const e = Object.entries(map || {}).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, n]) => [label ? label(k) : k, n]);
    return e.length === 1 && e[0][1] === total ? e[0][0] : e.map(([k, n]) => k + ' ×' + n).join(', ');
  };
  function sourceLine(f) {
    const parts = [num(f.files, 'Datei', 'Dateien'), fmtSizeLib(f.bytes)];
    parts.push('Video: ' + mixAll(f.v, f.files, codecName));
    const hs = f.heights.length ? [Math.min(...f.heights), Math.max(...f.heights)] : null;
    if (hs) parts.push(hs[0] === hs[1] ? hs[0] + 'p' : hs[0] + 'p–' + hs[1] + 'p');
    if (f.ten) parts.push(f.ten === f.files ? '10 Bit' : f.ten + '× 10 Bit');
    parts.push('Ton: ' + (Object.keys(f.a).length ? mixAll(f.a, f.files) : 'keiner'));
    parts.push('Untertitel: ' + (Object.keys(f.s).length ? mixAll(f.s, f.files) : 'keine'));
    return parts.join(' · ');
  }
  const fmtSizeLib = b => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = b; while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; } return v.toFixed(i > 1 ? 1 : 0).replace('.', ',') + ' ' + u[i]; };
  // Hinweis zur Quelle an der Codec-Wahl in Schritt „Wie umwandeln?“: nur Fakten und Hinweise, keine Schätzung der Ersparnis. → {text, tone} oder null
  function convertHint(f, target) {
    if (!f || !f.files) return null;
    const n = f.files, names = mixAll(f.v, n, codecName), known = Object.entries(f.v).filter(([c]) => c !== '?');
    if (!known.length) return null;
    const nNew = known.filter(([c]) => MODERN.includes(c)).reduce((a, [, k]) => a + k, 0), nOld = known.reduce((a, [, k]) => a + k, 0) - nNew;
    const T = {hevc: 'H.265', av1: 'AV1', h264: 'H.264', vp9: 'VP9'}[target];
    if (target === 'copy') return {text: 'Das Video bleibt, wie es ist (' + names + '): es wird nur neu verpackt. Geändert werden höchstens Tonspuren und Untertitel nach deinen Regeln.', tone: ''};
    if (target === 'hevc' || target === 'av1') {
      if (nNew === n && known.length === 1 && known[0][0] === target) return {text: 'Deine Quelle ist schon ' + T + '. Neu kodieren spart kaum Platz, kostet Zeit und etwas Qualität: eher „Kopieren“ wählen.', tone: 'warn'};
      if (nNew === n) return {text: 'Deine Quelle ist schon ' + names + ' (modern). Mit ' + T + ' sparst du hier kaum Platz.', tone: 'warn'};
      if (nOld === n) return {text: 'Deine Quelle: ' + names + ' → ' + T + '. Das spart meist Platz.', tone: 'good'};
      return {text: 'Deine Quelle: ' + names + '. Bei den ' + num(nOld, 'Datei', 'Dateien') + ' mit älterem Codec spart ' + T + ' meist Platz, die übrigen sind schon modern.', tone: 'good'};
    }
    if (target === 'h264') {
      if (nNew > 0) return {text: 'Deine Quelle: ' + names + '. H.264 läuft fast überall, wird aus H.265/AV1 aber meist größer.', tone: 'warn'};
      return {text: 'Deine Quelle: ' + names + '. H.264 läuft fast überall; Platz sparst du eher mit H.265.', tone: ''};
    }
    return null;
  }

  // geschätzte Ersparnis eines Ordners („≈ 9 GB sparen“); unter 5 % der Größe oder unter 50 MB ist es keine Rede wert
  const gainText = (save, bytes) => !save || save < Math.max(50e6, (bytes || 0) * 0.05) ? 'kaum Ersparnis' : '≈ ' + fmtSizeLib(save) + ' sparen';
  // Summe über alle Ordner ohne die Sammelzeilen (die fassen nur die Ordner darunter zusammen)
  const totalSave = rows => (rows || []).filter(r => !r.group).reduce((a, r) => a + (r.saveBytes || 0), 0);
  const totalBytes = rows => (rows || []).filter(r => !r.group).reduce((a, r) => a + (r.bytes || 0), 0);

  // ---------- Facetten: Auflösung, Video-Codec, Ton, Quelle (vom Server als Zähler je Ordner) ----------
  const RES = [['sd', 'SD'], ['720', '720p'], ['1080', '1080p'], ['2160', '4K']];
  const VCODECS = [['h264', 'H.264'], ['hevc', 'H.265'], ['av1', 'AV1'], ['other', 'Andere']];
  const AUDIOS = [['dts', 'DTS'], ['dtshd', 'DTS-HD'], ['truehd', 'TrueHD'], ['eac3', 'E-AC-3'], ['ac3', 'AC-3'], ['aac', 'AAC'], ['other', 'Andere']];
  const SOURCES = [['remux', 'Remux'], ['bluray', 'Bluray'], ['web', 'WEB'], ['hdtv', 'HDTV'], ['dvd', 'DVD'], ['unknown', 'Unbekannt']];
  const RES_LABEL = Object.fromEntries(RES), AUDIO_LABEL = {...Object.fromEntries(AUDIOS), flac: 'FLAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis', pcm_s16le: 'PCM', pcm_s24le: 'PCM', alac: 'ALAC'};
  const SRC_LABEL = {remux: 'Remux', bluray: 'Bluray', webdl: 'WEB-DL', webrip: 'WEBRip', web: 'WEB', hdtv: 'HDTV', dvd: 'DVD', '': 'unbekannt'};
  const vcodecOf = c => c === 'h264' || c === 'hevc' || c === 'av1' ? c : 'other';
  const audioOf = a => AUDIOS.some(([id]) => id === a) ? a : 'other';
  const srcOf = s => s === 'webdl' || s === 'webrip' || s === 'web' ? 'web' : s || 'unknown';
  // Klassen eines Ordners je Facette (ein Ordner kann mehrere haben, wenn seine Dateien gemischt sind)
  const keysOf = (map, f) => Object.entries(map || {}).filter(([, n]) => n > 0).map(([k]) => f(k));
  const FACETS = {
    res: r => keysOf(r.heights, k => k),
    vc: r => keysOf(r.codecs, k => k === '?' ? null : vcodecOf(k)).filter(Boolean),
    au: r => keysOf(r.audio, audioOf),
    src: r => keysOf(r.sources, srcOf),
  };
  // „gemischt“: bei mehreren Werten steht die Aufschlüsselung, die häufigsten zuerst („8× 1080p · 2× 720p“)
  function mixOf(map, label) {
    const e = Object.entries(map || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    if (!e.length) return {text: '–', mixed: false};
    if (e.length === 1) return {text: label(e[0][0]), mixed: false};
    return {text: e.slice(0, 3).map(([k, n]) => n + '× ' + label(k)).join(' · ') + (e.length > 3 ? ' …' : ''), mixed: true};
  }
  // Profil eines Ordners für die Staffel-Übersicht: Quelle, Auflösung, Codec, Ton
  const profile = r => ({
    src: mixOf(r.sources, k => SRC_LABEL[k] || k), res: mixOf(r.heights, k => RES_LABEL[k] || k),
    codec: mixOf(Object.fromEntries(Object.entries(r.codecs || {}).filter(([k]) => k !== '?')), codecName), audio: mixOf(r.audio, k => AUDIO_LABEL[k] || k.toUpperCase()),
  });

  // Alle Filter eines Zustands F = {worth, hints, res, vc, au, src, minSave, minPct, q}; zwischen den Gruppen gilt UND, innerhalb einer Gruppe ODER
  const FILTER_NONE = () => ({worth: false, hints: new Set(FILTER_DEFAULT), res: new Set(), vc: new Set(), au: new Set(), src: new Set(), minSave: 0, minPct: 0, q: ''});
  function matchesAll(r, F, lowBitrate) {
    if (F.worth && !matches(r, F.hints, lowBitrate)) return false;
    for (const g of ['res', 'vc', 'au', 'src']) if (F[g].size) { const k = FACETS[g](r); if (!k.some(x => F[g].has(x))) return false; }
    if (F.minSave && !((r.saveBytes || 0) >= F.minSave)) return false;
    if (F.minPct && !((r.bytes || 0) > 0 && (r.saveBytes || 0) / r.bytes * 100 >= F.minPct)) return false;
    const q = (F.q || '').trim().toLowerCase();
    if (q) { const hay = (r.path + ' ' + r.name).toLowerCase(); if (!q.split(/\s+/).every(t => hay.includes(t))) return false; }
    return true;
  }
  // Zähler an den Kärtchen: so viele Ordner blieben übrig, wenn man NUR diesen Wert in seiner Gruppe wählt (die anderen Filter bleiben)
  function facetCounts(rows, F, lowBitrate) {
    const out = {};
    for (const [g, opts] of [['res', RES], ['vc', VCODECS], ['au', AUDIOS], ['src', SOURCES]]) {
      out[g] = {};
      for (const [id] of opts) out[g][id] = rows.filter(r => matchesAll(r, {...F, [g]: new Set([id])}, lowBitrate)).length;
    }
    return out;
  }
  // Wie viele Filter weichen vom Anfangszustand ab (Zahl am Filter-Knopf)?
  const filterCount = F => F.res.size + F.vc.size + F.au.size + F.src.size + (F.minSave ? 1 : 0) + (F.minPct ? 1 : 0) +
    (F.worth && (F.hints.size !== FILTER_DEFAULT.length || FILTER_DEFAULT.some(x => !F.hints.has(x))) ? 1 : 0);

  // Reihenfolge: „tree“ = wie im Dateibaum (Sammelordner vor ihren Ordnern), sonst flach. Standardrichtung je Schlüssel in SORT_DIR; dir = 'asc' | 'desc'
  const SORTS = [['tree', 'wie im Ordnerbaum'], ['save', 'nach Ersparnis'], ['savepct', 'nach Ersparnis in %'], ['size', 'nach Größe'], ['files', 'nach Dateizahl'],
    ['bitrate', 'nach Bitrate'], ['height', 'nach Auflösung'], ['date', 'nach Änderungsdatum'], ['name', 'nach Name']];
  const SORT_DIR = {tree: 'asc', save: 'desc', savepct: 'desc', size: 'desc', files: 'desc', bitrate: 'desc', height: 'desc', date: 'desc', name: 'asc'};
  const pct = r => (r.bytes > 0 ? (r.saveBytes || 0) / r.bytes : 0);
  function sortRows(rows, key, dir) {
    const r = rows.slice();
    if (key === 'tree') return r;
    const val = {save: x => x.saveBytes || 0, savepct: pct, size: x => x.bytes || 0, files: x => x.files || 0, bitrate: x => x.avgBitrate || 0, height: x => x.maxHeight || 0, date: x => x.newest || 0}[key];
    const sign = (dir || SORT_DIR[key] || 'desc') === 'desc' ? -1 : 1;
    if (key === 'name') r.sort((a, b) => sign * a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.path.localeCompare(b.path));
    else if (val) r.sort((a, b) => sign * (val(a) - val(b)) || a.path.localeCompare(b.path));
    return r;
  }
  // Staffeln einer Serie (Sammelzeile): die Ordner mit Videos darunter, mit dem Pfad ab der Serie als Name
  function seasons(rows, series) {
    const pre = series.path.replace(/[\\/]+$/, '') + '/';
    const norm = p => String(p).replace(/\\/g, '/');
    return rows.filter(r => !r.group && norm(r.path).startsWith(norm(pre))).map(r => ({r, rel: norm(r.path).slice(norm(pre).length)}))
      .sort((a, b) => a.rel.localeCompare(b.rel, 'de', {numeric: true}));
  }
  return {hints, worth, mix, sortRows, SORTS, SORT_DIR, parentDir, RES, VCODECS, AUDIOS, SOURCES, FILTER_NONE, matchesAll, facetCounts, filterCount, profile, mixOf, seasons, FACETS, gainText, fmtSizeLib, totalSave, totalBytes, codecName, mbit, highLimit, nf, seasonLike, clean, title, sourceFacts, sourceLine, convertHint, FILTERS, FILTER_DEFAULT, filterIds, matches, filterCounts};
})();
if (typeof module !== 'undefined') module.exports = LIB;

// ---------- Oberfläche (nur im Browser) ----------
// Aufbau: Kopfzeile (Suche, Filter-Knopf mit Zahl, Sortierung mit Richtung), darunter die gesetzten Filter als entfernbare Kärtchen, die Summe, die Liste.
// Die Filter öffnen sich in einem Fenster (am Handy als Blatt von unten). Ein Klick auf eine Serie öffnet die Staffel-Übersicht („Fokus“): nur noch diese Serie.
export const LIBUI = {id: null, state: '', root: '', total: 0, done: 0, current: '', rows: [], sel: new Set(), F: LIB.FILTER_NONE(), sort: 'tree', dir: 'asc', focus: null, timer: 0, err: ''};
LIBUI.F.worth = true; // Anfangszustand wie bisher: nur Ordner mit Hinweisen
const libLow = typeof Q !== 'undefined' ? Q.lowBitrate : null;
// Sortierung merken (nur Bequemlichkeit je Gerät; ohne Speicher läuft alles weiter)
try { const v = JSON.parse(localStorage.getItem('p5conv.libview') || 'null'); if (v && LIB.SORT_DIR[v.sort]) { LIBUI.sort = v.sort; LIBUI.dir = v.dir === 'asc' ? 'asc' : 'desc'; } } catch (e) { /* ohne Speicher */ }
const libSaveView = () => { try { localStorage.setItem('p5conv.libview', JSON.stringify({sort: LIBUI.sort, dir: LIBUI.dir})); } catch (e) { /* ohne Speicher */ } };

// Ordner wählen, der geprüft werden soll (der Datei-Browser öffnet im zuletzt benutzten Ordner)
export async function libPick() {
  const r = await openBrowser('dir', S.lastDir); if (!r) return;
  S.lastDir = r.dir;
  await libStart(r.dir);
}
export async function libStart(dir) {
  clearTimeout(LIBUI.timer);
  if (LIBUI.id && LIBUI.state === 'running') api('/api/library/scan/' + LIBUI.id + '/cancel', {}).catch(() => {});
  try {
    const r = await api('/api/library/scan', {path: dir});
    const keep = LIBUI.F; // gewählte Filter bleiben bei einer neuen Prüfung; die Suche nicht
    Object.assign(LIBUI, {id: r.id, state: 'running', root: dir, total: 0, done: 0, cached: 0, current: '', rows: [], sel: new Set(), err: '', focus: null, F: Object.assign(keep, {q: ''})});
  } catch (e) { toast(e.message, 'bad'); return; }
  if (typeof cvLayout === 'function') cvLayout();
  libRender(); libPoll();
  document.getElementById('cvScan').scrollIntoView({behavior: 'smooth', block: 'nearest'});
}
async function libPoll() {
  clearTimeout(LIBUI.timer);
  if (!LIBUI.id) return;
  try {
    const d = await api('/api/library/scan/' + LIBUI.id);
    Object.assign(LIBUI, {state: d.state, total: d.total, done: d.done, cached: d.cached || 0, current: d.current || '', rows: d.rows || LIBUI.rows});
  } catch (e) { LIBUI.state = 'error'; LIBUI.err = e.message; }
  libRender();
  if (LIBUI.state === 'running') LIBUI.timer = setTimeout(libPoll, 700);
}
function libCancel() { if (LIBUI.id) api('/api/library/scan/' + LIBUI.id + '/cancel', {}).then(libPoll).catch(() => {}); }
function libClose() { clearTimeout(LIBUI.timer); if (LIBUI.state === 'running') libCancel(); closeFilterDlg(); LIBUI.id = null; LIBUI.state = ''; LIBUI.focus = null; if (typeof cvLayout === 'function') cvLayout(); }

// ausgewählte Ordner (rekursiv) in Schritt 1 ablegen
async function libAdopt() {
  const paths = [...LIBUI.sel]; if (!paths.length) return;
  try {
    const d = await api('/api/scan', {paths, kind: 'video'});
    const before = S.files.video.length; addScanned(d.files);
    const n = S.files.video.length - before;
    toast(n ? num0(n) + ' aus ' + paths.length + (paths.length === 1 ? ' Ordner' : ' Ordnern') + ' übernommen' : 'Diese Dateien waren schon dabei', n ? 'ok' : '');
    LIBUI.sel.clear(); libRender();
  } catch (e) { toast(e.message, 'bad'); }
}
const num0 = n => LIB.nf(n) + (n === 1 ? ' Datei' : ' Dateien');
const nOrd = n => LIB.nf(n) + ' Ordner';
const gainOk = r => r.saveBytes >= Math.max(50e6, r.bytes * 0.05);

// ---------- Filter-Fenster ----------
const MIN_SAVE = [[0, 'egal'], [1e9, 'ab 1 GB'], [5e9, 'ab 5 GB'], [10e9, 'ab 10 GB'], [25e9, 'ab 25 GB'], [50e9, 'ab 50 GB']];
const MIN_PCT = [[0, 'egal'], [20, 'ab 20 %'], [30, 'ab 30 %'], [40, 'ab 40 %'], [50, 'ab 50 %']];
const GROUPS = [['res', 'Auflösung', () => LIB.RES], ['vc', 'Video-Codec', () => LIB.VCODECS], ['au', 'Ton', () => LIB.AUDIOS], ['src', 'Quelle', () => LIB.SOURCES]];
function closeFilterDlg() { const d = document.getElementById('libDlg'); if (d && d.open) d.close(); }
function openFilterDlg() { const d = document.getElementById('libDlg'); if (!d) return; filterDlgRender(); if (!d.open) d.showModal(); }
function toggleSet(set, id) { set.has(id) ? set.delete(id) : set.add(id); }
function filterDlgRender() {
  const box = document.getElementById('libDlgBox'); if (!box) return;
  const F = LIBUI.F, all = LIBUI.rows, counts = LIB.facetCounts(all, F, libLow), shown = all.filter(r => LIB.matchesAll(r, F, libLow)).length;
  const chip = (text, on, count, onclick, attrs) => h('button', Object.assign({type: 'button', class: 'chip libfil' + (on ? ' on' : '') + (count === 0 && !on ? ' none' : ''), 'aria-pressed': on ? 'true' : 'false', onclick}, attrs || {}), text, count != null ? h('small', {}, ' ' + count) : null);
  const redraw = () => { filterDlgRender(); libRender(); };
  const hintCounts = LIB.filterCounts(all, libLow);
  const sec = (title, ...kids) => h('section', {class: 'libsec'}, h('h3', {}, title), h('div', {class: 'libchips'}, kids));
  const sel = (id, opts, cur, onchange, label) => h('label', {class: 'libsel small'}, h('span', {}, label), h('select', {id, onchange: ev => onchange(+ev.target.value)}, opts.map(([v, t]) => h('option', {value: v, selected: v === cur}, t))));
  fill(box,
    h('div', {class: 'dlg-h libdlgh'}, h('h2', {}, 'Filter'), h('div', {class: 'spacer'}), h('button', {type: 'button', class: 'small ghost', 'aria-label': 'Schließen', onclick: closeFilterDlg}, '✕')),
    h('div', {class: 'libdlgbody'},
      h('section', {class: 'libsec'}, h('h3', {}, 'Lohnt sich?'),
        h('label', {class: 'check', style: 'margin:0 0 8px'}, h('input', {type: 'checkbox', id: 'libWorth', checked: F.worth, onchange: ev => { F.worth = ev.target.checked; redraw(); }}), h('span', {}, 'Nur Ordner mit Hinweisen zeigen')),
        h('div', {class: 'libchips'}, LIB.FILTERS.map(([id, t]) => chip(t, F.hints.has(id), hintCounts[id], () => { toggleSet(F.hints, id); redraw(); }, {'data-fil': id, disabled: !F.worth})))),
      GROUPS.map(([g, title, opts]) => sec(title, opts().map(([id, t]) => chip(t, F[g].has(id), counts[g][id], () => { toggleSet(F[g], id); redraw(); }, {'data-g': g, 'data-v': id})))),
      h('section', {class: 'libsec'}, h('h3', {}, 'Ersparnis (geschätzt)'),
        h('div', {class: 'libsels'}, sel('libMinSave', MIN_SAVE, F.minSave, v => { F.minSave = v; redraw(); }, 'mindestens'), sel('libMinPct', MIN_PCT, F.minPct, v => { F.minPct = v; redraw(); }, 'oder in Prozent der Größe')))),
    h('div', {class: 'dlg-f libdlgf'}, h('button', {type: 'button', class: 'ghost', id: 'libReset', onclick: () => { LIBUI.F = Object.assign(LIB.FILTER_NONE(), {worth: true, q: F.q}); redraw(); }}, 'Zurücksetzen'),
      h('button', {type: 'button', class: 'primary', id: 'libDone', onclick: closeFilterDlg}, 'Fertig · ' + nOrd(shown))));
}

// ---------- Zeilen ----------
function chipsFor(r) { // Auflösung, Ton und Quelle als Kurzinfo hinter den Fakten
  const pr = LIB.profile(r);
  return [pr.src.text !== '–' && pr.src.text !== 'unbekannt' ? pr.src.text : '', pr.res.text !== '–' ? pr.res.text : '', pr.audio.text !== '–' ? pr.audio.text : ''].filter(Boolean).join(' · ');
}
// Gruppen, unter denen Staffelordner liegen (Season 01, Staffel 2 …): dort heißt der Knopf „Staffeln ansehen“, sonst „Unterordner ansehen“
const seasonParents = rows => new Set(rows.filter(r => !r.group && LIB.seasonLike(r.name)).map(r => LIB.parentDir(r.path)));
function libRowEl(r, groups, sp) {
  const hs = LIB.hints(r, libLow), checked = LIBUI.sel.has(r.path), flat = LIBUI.flat;
  const t = LIB.title(r, groups, !flat), up = t.up ? pathLabel(t.up) : '';
  const prof = chipsFor(r);
  return h('label', {class: 'librow' + (r.group ? ' group' : '') + (checked ? ' on' : ''), style: flat ? null : '--d:' + Math.min(r.depth, 4), 'data-path': r.path},
    h('input', {type: 'checkbox', checked, 'aria-label': 'Ordner ' + (t.series ? t.series + ' ' : '') + t.name + ' übernehmen', onchange: ev => { ev.target.checked ? LIBUI.sel.add(r.path) : LIBUI.sel.delete(r.path); libRender(); }}),
    h('span', {class: 'libmain'},
      h('span', {class: 'libname', title: pathLabel(r.path)}, icon('folder'),
        t.series ? [h('span', {class: 'libpar'}, t.series), h('span', {class: 'libsep', 'aria-hidden': 'true'}, '›')] : null,
        h('b', {}, t.name), r.group ? h('span', {class: 'chip'}, 'ganze Serie · ' + LIB.nf(r.folders) + ' Ordner') : null,
        flat && up ? h('small', {class: 'muted'}, 'in ' + up) : null),
      h('span', {class: 'libfacts muted small'}, num0(r.files) + ' · ' + fmtSize(r.bytes) + ' · ' + LIB.mix(r.codecs) + (r.avgBitrate ? ' · Ø ' + LIB.mbit(r.avgBitrate) : '') + (r.maxHeight ? ' · ' + r.maxHeight + 'p' : '')),
      prof ? h('span', {class: 'libprof muted small'}, prof) : null,
      hs.length ? h('span', {class: 'libhints'}, hs.map(x => h('span', {class: 'chip ' + (x.good ? 'acc' : ''), title: x.good ? 'Spricht dafür, dass sich das Umwandeln lohnt' : 'Spricht eher dagegen'}, x.text))) : null,
      r.group ? h('button', {type: 'button', class: 'small libfocusbtn', onclick: ev => { ev.preventDefault(); LIBUI.focus = r.path; libRender(); document.getElementById('cvScan').scrollIntoView({block: 'nearest'}); }}, (sp && sp.has(r.path) ? 'Staffeln ansehen ›' : 'Unterordner ansehen ›')) : null),
    h('span', {class: 'libgain' + (gainOk(r) ? ' good' : ''), title: 'Schätzung für H.265 „Gut“ (nur das Bild, aus Codec und Bitrate)'}, LIB.gainText(r.saveBytes, r.bytes)));
}

// ---------- Fokus: eine Serie, Staffel für Staffel ----------
function libFocusEl(series) {
  const ss = LIB.seasons(LIBUI.rows, series), t = LIB.title(series, null, false), pr = LIB.profile(series);
  const seasonish = ss.some(x => LIB.seasonLike(x.rel.split('/').pop())), noun = seasonish ? 'Staffel' : 'Ordner';
  const cell = (label, m) => h('span', {class: 'libcell', 'data-l': label}, m.text);
  const total = ss.reduce((a, x) => a + (x.r.saveBytes || 0), 0);
  return h('div', {class: 'libfocus'},
    h('div', {class: 'libfocushead'},
      h('button', {type: 'button', class: 'small', id: 'libBack', onclick: () => { LIBUI.focus = null; libRender(); }}, '‹ Alle Ordner'),
      h('b', {class: 'libfocustitle'}, icon('folder'), ' ' + t.name),
      h('span', {class: 'muted small'}, num0(series.files) + ' · ' + fmtSize(series.bytes) + ' · ' + (gainOk(series) ? LIB.gainText(series.saveBytes, series.bytes) : 'kaum Ersparnis'))),
    h('div', {class: 'libtable', role: 'table', 'aria-label': noun === 'Staffel' ? 'Staffeln' : 'Ordner'},
      h('div', {class: 'libtr libth', role: 'row'}, [noun, 'Dateien', 'Quelle', 'Auflösung', 'Codec', 'Ton', 'Größe', 'spart ≈'].map(x => h('span', {role: 'columnheader'}, x))),
      ss.map(({r, rel}) => { const p = LIB.profile(r), checked = LIBUI.sel.has(r.path);
        return h('label', {class: 'libtr librow libseason' + (checked ? ' on' : ''), role: 'row', 'data-path': r.path},
          h('span', {class: 'libcell libcname'}, h('input', {type: 'checkbox', checked, 'aria-label': noun + ' ' + rel + ' übernehmen', onchange: ev => { ev.target.checked ? LIBUI.sel.add(r.path) : LIBUI.sel.delete(r.path); libRender(); }}), h('b', {}, LIB.clean(rel))),
          cell('Dateien', {text: LIB.nf(r.files)}), cell('Quelle', p.src), cell('Auflösung', p.res), cell('Codec', p.codec), cell('Ton', p.audio), cell('Größe', {text: fmtSize(r.bytes)}),
          h('span', {class: 'libcell libgain' + (gainOk(r) ? ' good' : ''), 'data-l': 'spart ≈'}, gainOk(r) ? '≈ ' + LIB.fmtSizeLib(r.saveBytes) : 'kaum'));
      })),
    h('p', {class: 'muted small libfocusnote'}, ss.length + (seasonish ? (ss.length === 1 ? ' Staffel' : ' Staffeln') : ' Ordner') + ' · zusammen ' + (total >= 50e6 ? '≈ ' + LIB.fmtSizeLib(total) + ' sparen' : 'kaum Ersparnis') +
      ' · Die Quelle (WEB-DL, Bluray …) steht im Dateinamen, Auflösung, Codec und Ton kommen aus den Dateien. Mehrere Werte mit Zahl heißen: gemischt. ' + (pr.src.mixed || pr.res.mixed ? 'Hier sind die Qualitäten unterschiedlich.' : '')),
    h('div', {class: 'btns libfoot'}, h('button', {type: 'button', class: 'small', id: 'libSeasonAll', onclick: () => { ss.forEach(x => LIBUI.sel.add(x.r.path)); libRender(); }}, seasonish ? 'Alle Staffeln auswählen' : 'Alle auswählen'),
      h('button', {type: 'button', class: 'small ghost', onclick: () => { ss.forEach(x => LIBUI.sel.delete(x.r.path)); libRender(); }}, 'Keine')));
}

// ---------- Hauptansicht ----------
function activeChips(F) { // die vom Anfangszustand abweichenden Filter als entfernbare Kärtchen
  const out = [], rm = (text, fn) => out.push(h('button', {type: 'button', class: 'chip on libact', title: 'Filter entfernen', onclick: () => { fn(); libRender(); }}, text, h('span', {'aria-hidden': 'true'}, ' ✕')));
  const label = {res: Object.fromEntries(LIB.RES), vc: Object.fromEntries(LIB.VCODECS), au: Object.fromEntries(LIB.AUDIOS), src: Object.fromEntries(LIB.SOURCES)};
  for (const [g] of GROUPS) for (const id of F[g]) rm(label[g][id], () => F[g].delete(id));
  if (F.minSave) rm('Ersparnis ' + (MIN_SAVE.find(x => x[0] === F.minSave) || [0, ''])[1], () => { F.minSave = 0; });
  if (F.minPct) rm('Ersparnis ' + (MIN_PCT.find(x => x[0] === F.minPct) || [0, ''])[1], () => { F.minPct = 0; });
  if (F.worth && (F.hints.size !== LIB.FILTER_DEFAULT.length || LIB.FILTER_DEFAULT.some(x => !F.hints.has(x)))) rm('Hinweise: ' + (LIB.FILTERS.filter(([id]) => F.hints.has(id)).map(x => x[1]).join(', ') || 'keiner'), () => { F.hints = new Set(LIB.FILTER_DEFAULT); });
  return out;
}
function libToolbar(F) {
  const nf = LIB.filterCount(F);
  const dir = LIBUI.dir === 'asc' ? '↑' : '↓';
  const sortSel = h('select', {id: 'libSort', 'aria-label': 'Sortieren', onchange: ev => { LIBUI.sort = ev.target.value; LIBUI.dir = LIB.SORT_DIR[LIBUI.sort]; libSaveView(); libRender(); }},
    LIB.SORTS.map(([v, t]) => h('option', {value: v, selected: v === LIBUI.sort}, t)));
  const search = h('input', {type: 'search', id: 'libSearch', class: 'libsearch', placeholder: 'Ordner suchen …', 'aria-label': 'Ordner suchen', autocomplete: 'off', value: F.q});
  let t = 0; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { F.q = search.value; libRender({keepSearch: true}); }, 150); });
  return h('div', {class: 'libbar'}, search,
    h('button', {type: 'button', id: 'libFilterBtn', class: 'libfilbtn' + (nf ? ' on' : ''), 'aria-haspopup': 'dialog', onclick: openFilterDlg}, icon('chip'), ' Filter' + (nf ? ' (' + nf + ')' : '')),
    h('span', {class: 'libsortbox'}, sortSel, h('button', {type: 'button', id: 'libDir', class: 'small', disabled: LIBUI.sort === 'tree', title: LIBUI.dir === 'asc' ? 'Aufsteigend (zum Umkehren klicken)' : 'Absteigend (zum Umkehren klicken)', 'aria-label': 'Richtung umkehren',
      onclick: () => { LIBUI.dir = LIBUI.dir === 'asc' ? 'desc' : 'asc'; libSaveView(); libRender(); }}, dir)));
}

export function libRender(opt) {
  const box = document.getElementById('cvScan'); if (!box) return;
  if (!LIBUI.id) { fill(box); return; }
  const keepSearch = opt && opt.keepSearch && document.activeElement && document.activeElement.id === 'libSearch', caret = keepSearch ? document.activeElement.selectionStart : 0;
  const running = LIBUI.state === 'running', ready = LIBUI.state === 'done' || LIBUI.state === 'canceled';
  const head = h('div', {class: 'cvchead'}, h('span', {class: 'cvico'}, icon('chip')), h('h2', {}, 'Hier kannst du Platz sparen', infoBtn('libScan')),
    h('span', {class: 'cvsum muted small'}, pathLabel(LIBUI.root)), h('button', {type: 'button', class: 'small ghost', title: 'Ergebnis schließen', 'aria-label': 'Schließen', onclick: libClose}, '✕'));
  let body;
  if (running) {
    const pct = LIBUI.total ? Math.round(LIBUI.done / LIBUI.total * 100) : 0;
    body = [h('div', {class: 'libprog'}, h('div', {class: 'bar'}, h('i', {'data-w': pct})),
      h('div', {class: 'job-m'}, h('span', {}, LIBUI.total ? LIBUI.done + ' von ' + num0(LIBUI.total) + ' gelesen' + (LIBUI.cached ? ' (' + LIBUI.cached + ' aus dem Zwischenspeicher)' : '') : 'Suche Videos …'), h('span', {class: 'muted'}, LIBUI.current ? LIBUI.current.split(/[\\/]/).pop() : '')),
      h('div', {class: 'btns'}, h('button', {type: 'button', class: 'small', onclick: libCancel}, 'Abbrechen'))),
      h('p', {class: 'muted small'}, 'Die Dateien werden nur gelesen (ffprobe, zwei gleichzeitig), nichts wird verändert. Bereits gelesene, unveränderte Dateien kommen beim nächsten Mal aus dem Zwischenspeicher.')];
  } else if (LIBUI.state === 'error') body = [h('p', {class: 'warn'}, LIBUI.err || 'Die Prüfung ist fehlgeschlagen.')];
  else if (ready) {
    const focusRow = LIBUI.focus && LIBUI.rows.find(r => r.group && r.path === LIBUI.focus);
    if (LIBUI.focus && !focusRow) LIBUI.focus = null;
    const all = LIBUI.rows, F = LIBUI.F;
    const total = LIB.totalSave(all), tb = LIB.totalBytes(all);
    const big = h('div', {class: 'libtotal'}, total >= 50e6 ? [h('b', {}, '≈ ' + LIB.fmtSizeLib(total)), ' von ' + LIB.fmtSizeLib(tb) + ' ließen sich sparen ', h('span', {class: 'muted small'}, '(Schätzung für H.265 „Gut“, nur das Bild)')] : ['Hier ist kaum etwas zu holen: ', h('span', {class: 'muted small'}, 'geschätzt unter 50 MB bei H.265 „Gut“ (nur das Bild).')]);
    const foot = h('div', {class: 'btns libfoot'}, h('button', {type: 'button', class: 'primary', id: 'libAdopt', disabled: !LIBUI.sel.size, onclick: libAdopt},
      LIBUI.sel.size ? 'Ausgewählte Ordner übernehmen (' + LIBUI.sel.size + ')' : 'Ordner übernehmen'), h('span', {class: 'muted small'}, 'Übernommen wird immer der ganze Ordner mit allen Unterordnern.'),
      LIBUI.cached ? h('span', {class: 'muted small libcached'}, LIBUI.cached + ' von ' + num0(LIBUI.total) + ' aus dem Zwischenspeicher gelesen') : null);
    if (focusRow) body = [big, libFocusEl(focusRow), foot];
    else {
      const sortKey = LIBUI.sort, flat = sortKey !== 'tree';
      const shown = LIB.sortRows(all.filter(r => LIB.matchesAll(r, F, libLow)), sortKey, LIBUI.dir);
      LIBUI.flat = flat;
      const groups = new Set(shown.filter(r => r.group).map(r => r.path));
      const leaves = shown.filter(r => !r.group), sumShown = LIB.totalSave(shown);
      const hidden = all.length - shown.length;
      const summary = h('div', {class: 'libsum small'},
        h('span', {class: 'muted'}, (LIBUI.state === 'canceled' ? 'Abgebrochen: ' : '') + nOrd(leaves.length) + (leaves.length !== all.filter(r => !r.group).length ? ' von ' + LIB.nf(all.filter(r => !r.group).length) : '') + ' · ' + (sumShown >= 50e6 ? '≈ ' + LIB.fmtSizeLib(sumShown) + ' sparen' : 'kaum Ersparnis')),
        F.worth && hidden > 0 ? h('button', {type: 'button', class: 'linklike', id: 'libShowAll', onclick: () => { F.worth = false; libRender(); }}, 'Auch Ordner ohne Hinweise zeigen') : null,
        leaves.length ? h('button', {type: 'button', class: 'linklike', id: 'libSelAll', onclick: () => { leaves.forEach(r => LIBUI.sel.add(r.path)); libRender(); }}, 'Alle gezeigten auswählen') : null,
        LIB.filterCount(F) ? h('button', {type: 'button', class: 'linklike', id: 'libClear', onclick: () => { LIBUI.F = Object.assign(LIB.FILTER_NONE(), {worth: true, q: F.q}); libRender(); }}, 'Filter zurücksetzen') : null);
      const act = activeChips(F);
      const legend = h('p', {class: 'liblegend muted small'}, 'Jede Zeile ist ein Ordner. Die grünen Kärtchen sagen, was sich dort eher lohnt; grau spricht eher dagegen. ' + (flat ? 'Die Liste ist nicht nach dem Ordnerbaum geordnet, deshalb steht bei Staffeln die Serie davor.' : 'Eingerückte Ordner liegen im Ordner darüber; bei einer ganzen Serie zeigt „Staffeln ansehen“ jede Staffel einzeln, mit Quelle, Auflösung und Ton.'));
      const sp = seasonParents(all);
      const list = shown.length ? h('div', {class: 'liblist'}, shown.map(r => libRowEl(r, groups, sp)))
        : h('div', {class: 'cvempty'}, all.length ? 'Kein Ordner passt zu den Filtern. Entferne ein Filterkärtchen oder setze die Filter zurück: dann siehst du alle ' + all.length + '.' : 'In diesem Ordner liegen keine Videos.');
      body = [big, libToolbar(F), act.length ? h('div', {class: 'libactive'}, act) : null, summary, legend, list, foot];
    }
  } else body = [];
  fill(box, head, h('div', {class: 'cvcbody'}, body));
  if (keepSearch) { const s = document.getElementById('libSearch'); if (s) { s.focus(); try { s.setSelectionRange(caret, caret); } catch (e) { /* Suchfeld ohne Auswahl */ } } }
  const d = document.getElementById('libDlg'); if (d && d.open) filterDlgRender();
}
