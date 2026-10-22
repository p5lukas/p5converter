'use strict';
/* Bibliothek-Scan „Was lohnt sich?“ (Video, Schritt 1): ein Ordner wird auf dem Server rekursiv gelesen und ORDNERWEISE zusammengefasst
   (/api/library/scan). Es werden nie einzelne Dateien vorgeschlagen und nichts geschätzt: die Zeilen zeigen nur Fakten (Dateien, Größe, Codec-Mix,
   Bitrate, schwere Tonformate, Bild-Untertitel); die Hinweise „lohnt sich eher“ entstehen aus diesen Fakten (LIB.hints, mit Node getestet:
   tools/test-library.js). „Übernehmen“ legt den ganzen Ordner (rekursiv) in Schritt 1 ab.
   Nutzt S, $, h(), fill(), api(), icon(), toast(), fmtSize(), pathLabel(), openBrowser(), addScanned() aus den anderen Dateien (nur zur Laufzeit). */

const LIB = (() => {
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

  // Hinweise zu einem Ordner: [{id, text, good}]; good = spricht für „lohnt sich“. Nichts davon ist eine Größenschätzung.
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

  // Reihenfolge: „tree“ = wie im Dateibaum (Sammelordner vor ihren Ordnern), sonst flach nach Größe, Bitrate oder Name
  function sortRows(rows, key) {
    const r = rows.slice();
    if (key === 'size') r.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
    else if (key === 'bitrate') r.sort((a, b) => b.avgBitrate - a.avgBitrate || a.path.localeCompare(b.path));
    else if (key === 'name') r.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.path.localeCompare(b.path));
    return r;
  }
  return {hints, worth, mix, sortRows, codecName, mbit, highLimit, nf, seasonLike, clean, title, sourceFacts, sourceLine, convertHint, FILTERS, FILTER_DEFAULT, filterIds, matches, filterCounts};
})();
if (typeof module !== 'undefined') module.exports = LIB;

// ---------- Oberfläche (nur im Browser) ----------
const LIBUI = {id: null, state: '', root: '', total: 0, done: 0, current: '', rows: [], sel: new Set(), onlyHints: true, fil: new Set(LIB.FILTER_DEFAULT), sort: 'tree', sortUser: false, timer: 0, err: ''};
const libLow = typeof Q !== 'undefined' ? Q.lowBitrate : null;

// Ordner wählen, der geprüft werden soll (der Datei-Browser öffnet im zuletzt benutzten Ordner)
async function libPick() {
  const r = await openBrowser('dir', S.lastDir); if (!r) return;
  S.lastDir = r.dir;
  await libStart(r.dir);
}
async function libStart(dir) {
  clearTimeout(LIBUI.timer);
  if (LIBUI.id && LIBUI.state === 'running') api('/api/library/scan/' + LIBUI.id + '/cancel', {}).catch(() => {});
  try {
    const r = await api('/api/library/scan', {path: dir});
    Object.assign(LIBUI, {id: r.id, state: 'running', root: dir, total: 0, done: 0, cached: 0, current: '', rows: [], sel: new Set(), err: ''});
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
function libClose() { clearTimeout(LIBUI.timer); if (LIBUI.state === 'running') libCancel(); LIBUI.id = null; LIBUI.state = ''; if (typeof cvLayout === 'function') cvLayout(); }

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

function libRowEl(r, groups) {
  const hs = LIB.hints(r, libLow), checked = LIBUI.sel.has(r.path), flat = LIBUI.flat;
  const t = LIB.title(r, groups, !flat), up = t.up ? pathLabel(t.up) : '';
  return h('label', {class: 'librow' + (r.group ? ' group' : '') + (checked ? ' on' : ''), style: flat ? null : '--d:' + Math.min(r.depth, 4), 'data-path': r.path},
    h('input', {type: 'checkbox', checked, 'aria-label': 'Ordner ' + (t.series ? t.series + ' ' : '') + t.name + ' übernehmen', onchange: ev => { ev.target.checked ? LIBUI.sel.add(r.path) : LIBUI.sel.delete(r.path); libRender(); }}),
    h('span', {class: 'libmain'},
      h('span', {class: 'libname', title: pathLabel(r.path)}, icon('folder'),
        t.series ? [h('span', {class: 'libpar'}, t.series), h('span', {class: 'libsep', 'aria-hidden': 'true'}, '›')] : null,
        h('b', {}, t.name), r.group ? h('span', {class: 'chip'}, 'ganzer Ordner · ' + LIB.nf(r.folders) + ' Ordner') : null,
        flat && up ? h('small', {class: 'muted'}, 'in ' + up) : null),
      h('span', {class: 'libfacts muted small'}, num0(r.files) + ' · ' + fmtSize(r.bytes) + ' · ' + LIB.mix(r.codecs) + (r.avgBitrate ? ' · Ø ' + LIB.mbit(r.avgBitrate) : '') + (r.maxHeight ? ' · ' + r.maxHeight + 'p' : '')),
      hs.length ? h('span', {class: 'libhints'}, hs.map(x => h('span', {class: 'chip ' + (x.good ? 'acc' : ''), title: x.good ? 'Spricht dafür, dass sich das Umwandeln lohnt' : 'Spricht eher dagegen'}, x.text))) : null));
}

function libRender() {
  const box = document.getElementById('cvScan'); if (!box) return;
  if (!LIBUI.id) { fill(box); return; }
  const running = LIBUI.state === 'running', ready = LIBUI.state === 'done' || LIBUI.state === 'canceled';
  const head = h('div', {class: 'cvchead'}, h('span', {class: 'cvico'}, icon('chip')), h('h2', {}, 'Ergebnis: Wo lohnt sich das Umwandeln?', infoBtn('libScan')),
    h('span', {class: 'cvsum muted small'}, pathLabel(LIBUI.root)), h('button', {type: 'button', class: 'small ghost', title: 'Ergebnis schließen', 'aria-label': 'Schließen', onclick: libClose}, '✕'));
  let body;
  if (running) {
    const pct = LIBUI.total ? Math.round(LIBUI.done / LIBUI.total * 100) : 0;
    body = [h('div', {class: 'libprog'}, h('div', {class: 'bar'}, h('i', {style: 'width:' + pct + '%'})),
      h('div', {class: 'job-m'}, h('span', {}, LIBUI.total ? LIBUI.done + ' von ' + num0(LIBUI.total) + ' gelesen' + (LIBUI.cached ? ' (' + LIBUI.cached + ' aus dem Merker)' : '') : 'Suche Videos …'), h('span', {class: 'muted'}, LIBUI.current ? LIBUI.current.split(/[\\/]/).pop() : '')),
      h('div', {class: 'btns'}, h('button', {type: 'button', class: 'small', onclick: libCancel}, 'Abbrechen'))),
      h('p', {class: 'muted small'}, 'Die Dateien werden nur gelesen (ffprobe, zwei gleichzeitig), nichts wird verändert. Bereits gelesene, unveränderte Dateien kommen beim nächsten Mal aus dem Merker.')];
  } else if (LIBUI.state === 'error') body = [h('p', {class: 'warn'}, LIBUI.err || 'Die Prüfung ist fehlgeschlagen.')];
  else if (ready) {
    const all = LIBUI.rows, counts = LIB.filterCounts(all, libLow);
    // nur „Hohe Bitrate“ gewählt und nicht von Hand sortiert: nach Bitrate sortieren
    const sortKey = !LIBUI.sortUser && LIBUI.onlyHints && LIBUI.fil.size === 1 && LIBUI.fil.has('high') ? 'bitrate' : LIBUI.sort;
    const shown = LIB.sortRows(LIBUI.onlyHints ? all.filter(r => LIB.matches(r, LIBUI.fil, libLow)) : all, sortKey);
    // im Dateibaum: ein Ordner mit Hinweisen zeigt auch seine Sammelordner darüber nur, wenn diese selbst Hinweise haben
    const ctl = h('div', {class: 'liberctl'},
      h('label', {class: 'check', style: 'margin:0'}, h('input', {type: 'checkbox', checked: LIBUI.onlyHints, onchange: ev => { LIBUI.onlyHints = ev.target.checked; libRender(); }}), h('span', {}, 'Nur Ordner mit Hinweisen')),
      h('label', {class: 'inline small'}, h('span', {}, 'Sortieren'), h('select', {'aria-label': 'Sortieren', onchange: ev => { LIBUI.sort = ev.target.value; LIBUI.sortUser = true; libRender(); }},
        [['tree', 'wie im Ordnerbaum'], ['size', 'nach Größe'], ['bitrate', 'nach Bitrate'], ['name', 'nach Name']].map(([v, t]) => h('option', {value: v, selected: v === sortKey}, t)))),
      h('span', {class: 'muted small'}, LIBUI.state === 'canceled' ? 'Abgebrochen: ' + shown.length + ' Ordner bis hierher' : shown.length + ' von ' + all.length + (all.length === 1 ? ' Ordner' : ' Ordnern')));
    LIBUI.flat = sortKey !== 'tree';
    const groups = new Set(shown.filter(r => r.group).map(r => r.path));
    const fil = h('div', {class: 'libfilters', role: 'group', 'aria-label': 'Hinweise als Filter'}, LIB.FILTERS.map(([id, t]) => {
      const on = LIBUI.fil.has(id);
      return h('button', {type: 'button', class: 'chip libfil' + (on ? ' on' : '') + (id === 'small' ? '' : ' acc'), 'data-fil': id, 'aria-pressed': on ? 'true' : 'false', disabled: !LIBUI.onlyHints, title: (on ? 'Abwählen: ' : 'Anwählen: ') + 'Ordner mit diesem Hinweis ' + (on ? 'nicht mehr zeigen' : 'zeigen'),
        onclick: () => { on ? LIBUI.fil.delete(id) : LIBUI.fil.add(id); libRender(); }}, t + ' · ' + counts[id]);
    }));
    const legend = h('p', {class: 'liblegend muted small'}, 'Jede Zeile ist ein Ordner. Die grünen Kärtchen sagen, was sich dort eher lohnt; grau spricht eher dagegen. ' + (LIBUI.flat ? 'Die Liste ist nicht nach dem Ordnerbaum geordnet, deshalb steht bei Staffeln die Serie davor.' : 'Eingerückte Ordner liegen im Ordner darüber.') + ' Hake an, was du übernehmen willst.');
    const list = shown.length ? h('div', {class: 'liblist'}, shown.map(r => libRowEl(r, groups)))
      : h('div', {class: 'cvempty'}, all.length ? (LIBUI.fil.size ? 'Keine Ordner mit den gewählten Hinweisen. Wähle weitere Kärtchen an oder schalte „Nur Ordner mit Hinweisen“ aus: dann siehst du alle ' + all.length + '.' : 'Kein Hinweis gewählt: wähle oben mindestens ein Kärtchen an oder schalte „Nur Ordner mit Hinweisen“ aus.') : 'Keine Videos gefunden.');
    body = [ctl, fil, legend, list, h('div', {class: 'btns libfoot'}, h('button', {type: 'button', class: 'primary', disabled: !LIBUI.sel.size, onclick: libAdopt},
      LIBUI.sel.size ? 'Ausgewählte Ordner übernehmen (' + LIBUI.sel.size + ')' : 'Ordner übernehmen'), h('span', {class: 'muted small'}, 'Übernommen wird immer der ganze Ordner mit allen Unterordnern.'), LIBUI.cached ? h('span', {class: 'muted small libcached'}, LIBUI.cached + ' von ' + num0(LIBUI.total) + ' kamen aus dem Merker (unverändert seit dem letzten Mal).') : null)];
  } else body = [];
  fill(box, head, h('div', {class: 'cvcbody'}, body));
}
