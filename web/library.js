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
  const num = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  // „H.264 ×3 · H.265 ×2“, die häufigsten zuerst
  const mix = codecs => Object.entries(codecs || {}).sort((a, b) => b[1] - a[1]).map(([c, n]) => codecName(c) + ' ×' + n).join(' · ');

  // Hinweise zu einem Ordner: [{id, text, good}]; good = spricht für „lohnt sich“. Nichts davon ist eine Größenschätzung.
  function hints(r, lowBitrate) {
    const out = [], files = r.files || 0;
    const olds = Object.entries(r.codecs || {}).filter(([c]) => c !== '?' && !MODERN.includes(c));
    const nOld = olds.reduce((a, [, n]) => a + n, 0);
    if (nOld) out.push({id: 'old', good: true, text: nOld === files ? 'Älterer Codec (' + olds.map(([c]) => codecName(c)).join(', ') + ')' : nOld + ' von ' + files + ' mit älterem Codec (' + olds.map(([c]) => codecName(c)).join(', ') + ')'});
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

  // Reihenfolge: „tree“ = wie im Dateibaum (Sammelordner vor ihren Ordnern), sonst flach nach Größe, Bitrate oder Name
  function sortRows(rows, key) {
    const r = rows.slice();
    if (key === 'size') r.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
    else if (key === 'bitrate') r.sort((a, b) => b.avgBitrate - a.avgBitrate || a.path.localeCompare(b.path));
    else if (key === 'name') r.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.path.localeCompare(b.path));
    return r;
  }
  return {hints, worth, mix, sortRows, codecName, mbit, highLimit};
})();
if (typeof module !== 'undefined') module.exports = LIB;

// ---------- Oberfläche (nur im Browser) ----------
const LIBUI = {id: null, state: '', root: '', total: 0, done: 0, current: '', rows: [], sel: new Set(), onlyHints: true, sort: 'tree', timer: 0, err: ''};
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
    Object.assign(LIBUI, {id: r.id, state: 'running', root: dir, total: 0, done: 0, current: '', rows: [], sel: new Set(), err: ''});
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
    Object.assign(LIBUI, {state: d.state, total: d.total, done: d.done, current: d.current || '', rows: d.rows || LIBUI.rows});
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
const num0 = n => n + (n === 1 ? ' Datei' : ' Dateien');

function libRowEl(r) {
  const hs = LIB.hints(r, libLow), checked = LIBUI.sel.has(r.path), flat = LIBUI.sort !== 'tree';
  const rel = pathLabel(r.path);
  return h('label', {class: 'librow' + (r.group ? ' group' : '') + (checked ? ' on' : ''), style: flat ? null : '--d:' + Math.min(r.depth, 4), 'data-path': r.path},
    h('input', {type: 'checkbox', checked, 'aria-label': 'Ordner ' + r.name + ' übernehmen', onchange: ev => { ev.target.checked ? LIBUI.sel.add(r.path) : LIBUI.sel.delete(r.path); libRender(); }}),
    h('span', {class: 'libmain'},
      h('span', {class: 'libname', title: rel}, icon('folder'), h('b', {}, r.name), r.group ? h('span', {class: 'chip'}, 'ganzer Ordner · ' + r.folders + ' Ordner') : null, flat ? h('small', {class: 'muted'}, rel) : null),
      h('span', {class: 'libfacts muted small'}, num0(r.files) + ' · ' + fmtSize(r.bytes) + ' · ' + LIB.mix(r.codecs) + (r.avgBitrate ? ' · Ø ' + LIB.mbit(r.avgBitrate) : '') + (r.maxHeight ? ' · ' + r.maxHeight + 'p' : '')),
      hs.length ? h('span', {class: 'libhints'}, hs.map(x => h('span', {class: 'chip ' + (x.good ? 'acc' : ''), title: x.good ? 'Spricht dafür, dass sich das Umwandeln lohnt' : 'Spricht eher dagegen'}, x.text))) : null));
}

function libRender() {
  const box = document.getElementById('cvScan'); if (!box) return;
  if (!LIBUI.id) { fill(box); return; }
  const running = LIBUI.state === 'running', ready = LIBUI.state === 'done' || LIBUI.state === 'canceled';
  const head = h('div', {class: 'cvchead'}, h('span', {class: 'cvico'}, icon('chip')), h('h2', {}, 'Ordner prüfen', infoBtn('libScan')),
    h('span', {class: 'cvsum muted small'}, pathLabel(LIBUI.root)), h('button', {type: 'button', class: 'small ghost', title: 'Ergebnis schließen', 'aria-label': 'Schließen', onclick: libClose}, '✕'));
  let body;
  if (running) {
    const pct = LIBUI.total ? Math.round(LIBUI.done / LIBUI.total * 100) : 0;
    body = [h('div', {class: 'libprog'}, h('div', {class: 'bar'}, h('i', {style: 'width:' + pct + '%'})),
      h('div', {class: 'job-m'}, h('span', {}, LIBUI.total ? LIBUI.done + ' von ' + num0(LIBUI.total) + ' gelesen' : 'Suche Videos …'), h('span', {class: 'muted'}, LIBUI.current ? LIBUI.current.split(/[\\/]/).pop() : '')),
      h('div', {class: 'btns'}, h('button', {type: 'button', class: 'small', onclick: libCancel}, 'Abbrechen'))),
      h('p', {class: 'muted small'}, 'Die Dateien werden nur gelesen (ffprobe, zwei gleichzeitig), nichts wird verändert.')];
  } else if (LIBUI.state === 'error') body = [h('p', {class: 'warn'}, LIBUI.err || 'Die Prüfung ist fehlgeschlagen.')];
  else if (ready) {
    const all = LIBUI.rows, shown = LIB.sortRows(LIBUI.onlyHints ? all.filter(r => LIB.worth(r, libLow)) : all, LIBUI.sort);
    // im Dateibaum: ein Ordner mit Hinweisen zeigt auch seine Sammelordner darüber nur, wenn diese selbst Hinweise haben
    const ctl = h('div', {class: 'liberctl'},
      h('label', {class: 'check', style: 'margin:0'}, h('input', {type: 'checkbox', checked: LIBUI.onlyHints, onchange: ev => { LIBUI.onlyHints = ev.target.checked; libRender(); }}), h('span', {}, 'Nur Ordner mit Hinweisen')),
      h('label', {class: 'inline small'}, h('span', {}, 'Sortieren'), h('select', {'aria-label': 'Sortieren', onchange: ev => { LIBUI.sort = ev.target.value; libRender(); }},
        [['tree', 'wie im Ordnerbaum'], ['size', 'nach Größe'], ['bitrate', 'nach Bitrate'], ['name', 'nach Name']].map(([v, t]) => h('option', {value: v, selected: v === LIBUI.sort}, t)))),
      h('span', {class: 'muted small'}, LIBUI.state === 'canceled' ? 'Abgebrochen: ' + shown.length + ' Ordner bis hierher' : shown.length + ' von ' + all.length + (all.length === 1 ? ' Ordner' : ' Ordnern')));
    const list = shown.length ? h('div', {class: 'liblist'}, shown.map(libRowEl))
      : h('div', {class: 'cvempty'}, all.length ? 'Keine Ordner mit Hinweisen: alles sieht schon schlank aus. Mit „Nur Ordner mit Hinweisen“ aus siehst du alle ' + all.length + '.' : 'Keine Videos gefunden.');
    body = [ctl, list, h('div', {class: 'btns libfoot'}, h('button', {type: 'button', class: 'primary', disabled: !LIBUI.sel.size, onclick: libAdopt},
      LIBUI.sel.size ? 'Ausgewählte Ordner übernehmen (' + LIBUI.sel.size + ')' : 'Ordner übernehmen'), h('span', {class: 'muted small'}, 'Übernommen wird immer der ganze Ordner mit allen Unterordnern.'))];
  } else body = [];
  fill(box, head, h('div', {class: 'cvcbody'}, body));
}
