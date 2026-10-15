'use strict';
/* Namensmuster, Suchen & Ersetzen und Vorschau – gemeinsam für den Konverter (Ziel) und die Seite „Umbenennen“.
   Nutzt h(), fill(), api(), S, toast() aus settings.js/app.js (nur zur Laufzeit). */

const NAME_VARS = {
  audio: [['title', 'Titel'], ['artist', 'Interpret'], ['album', 'Album'], ['albumartist', 'Album-Interpret'], ['track', 'Track-Nr.'], ['disc', 'CD-Nr.'], ['year', 'Jahr'], ['genre', 'Genre'], ['filename', 'Dateiname'], ['date', 'Datum']],
  video: [['filename', 'Dateiname'], ['title', 'Titel'], ['year', 'Jahr'], ['res', 'Auflösung'], ['codec', 'Codec'], ['bit', 'Bit-Tiefe'], ['container', 'Container'], ['date', 'Datum']],
  media: [['filename', 'Dateiname'], ['title', 'Titel'], ['year', 'Jahr'], ['res', 'Auflösung'], ['codec', 'Codec'], ['bit', 'Bit-Tiefe'], ['artist', 'Interpret'], ['album', 'Album'], ['track', 'Track-Nr.'], ['date', 'Datum']],
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// Klick auf eine Variable fügt sie an der Cursorposition ein
function varChips(mount, input, vars, onChange) {
  fill(mount, h('span', {class: 'muted small'}, 'Variablen: '), vars.map(([k, t]) => h('button', {type: 'button', class: 'small ghost chipbtn', title: t,
    onclick: () => {
      const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a, ins = '{' + k + '}';
      input.value = input.value.slice(0, a) + ins + input.value.slice(b);
      input.focus(); input.setSelectionRange(a + ins.length, a + ins.length);
      onChange();
    }}, '{' + k + '}')));
}

// Liste der Ersetzungen: get() liefert das Array [{find, with, regex, case}], set(arr) speichert es.
// Jede Änderung liest die Liste frisch über get() (keine alten Kopien) – so tauchen gelöschte Zeilen nie wieder auf.
// Rückgabe: Funktion, die eine leere Ersetzung anhängt.
function ruleEditor(mount, get, set, onChange) {
  const edit = (i, fn) => { const cur = get(); if (cur[i]) { fn(cur[i]); set(cur); onChange(); } };
  const render = () => {
    fill(mount, get().map((r, i) => h('div', {class: 'rulerow'},
      h('input', {value: r.find || '', placeholder: 'Suchen', 'aria-label': 'Suchen', autocomplete: 'off', spellcheck: 'false', oninput: e => edit(i, x => { x.find = e.target.value; })}),
      h('input', {value: r.with || '', placeholder: 'Ersetzen durch', 'aria-label': 'Ersetzen durch', autocomplete: 'off', spellcheck: 'false', oninput: e => edit(i, x => { x.with = e.target.value; })}),
      h('label', {class: 'check', title: 'Suchtext ist ein regulärer Ausdruck ($1 … in „Ersetzen durch“)'}, h('input', {type: 'checkbox', checked: !!r.regex, onchange: e => edit(i, x => { x.regex = e.target.checked; })}), 'Regex'),
      h('label', {class: 'check', title: 'Groß-/Kleinschreibung beachten'}, h('input', {type: 'checkbox', checked: !!r.case, onchange: e => edit(i, x => { x.case = e.target.checked; })}), 'Aa'),
      h('button', {type: 'button', class: 'small ghost', title: 'Entfernen', onclick: () => { const cur = get(); cur.splice(i, 1); set(cur); render(); onChange(); }}, '✕'))));
  };
  render();
  return () => {
    const cur = get(); cur.push({find: '', with: '', regex: false, case: false}); set(cur); render(); onChange();
    const last = mount.querySelector('.rulerow:last-child input'); if (last) last.focus();
  };
}
const cleanRules = rows => (rows || []).filter(r => r && r.find);

function previewTable(items, withPath) {
  if (!items.length) return h('div', {class: 'empty'}, 'Noch keine Dateien.');
  return h('div', {class: 'rnrows'}, items.map(x => h('div', {class: 'rnrow' + (x.error ? ' bad' : '') + (x.done ? ' done' : '')},
    h('span', {class: 'old', title: x.path}, x.old),
    h('span', {class: 'arr'}, '→'),
    h('span', {class: 'new'}, x.error && !x.new ? '–' : x.new),
    x.error ? h('span', {class: 'err small'}, x.error) : (x.done ? h('span', {class: 'small ok'}, 'umbenannt') : null))));
}

// ---------- Konverter: Ziel-Panel ----------
function nameRules() { try { const r = JSON.parse($('#renRules').value || '[]'); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
let addRuleFn = null;
function syncNameUI() {
  const world = S.world;
  varChips($('#varChips'), $('#pattern'), NAME_VARS[world], () => { saveSettings(); refreshNamePreview(); });
  addRuleFn = ruleEditor($('#ruleRows'), nameRules, rows => { $('#renRules').value = JSON.stringify(rows); saveSettings(); }, refreshNamePreview);
  refreshNamePreview();
}
function outExt() {
  if (S.world === 'video') return $('#vContainer').value;
  const f = $('#aFormat').value;
  return ({m4a: 'm4a', ogg: 'ogg'})[f] || f;
}
let previewSeq = 0;
const refreshNamePreview = debounce(async () => {
  const box = $('#namePreview'), files = S.files[S.world].slice(0, 3), seq = ++previewSeq;
  if (!files.length) { fill(box); return; }
  try {
    const r = await api('/api/rename/preview', {items: files.map(f => f.path), pattern: $('#pattern').value.trim(), replace: cleanRules(nameRules()), suffix: $('#suffix').value,
      ext: outExt(), mode: 'convert', target: S.world === 'video' ? {codec: $('#vCodec').value, height: +$('#vHeight').value, bitDepth: +$('#vDepth').value, container: $('#vContainer').value} : {container: outExt()}});
    if (seq !== previewSeq) return;
    fill(box, h('div', {class: 'muted small'}, 'Vorschau (erste ' + files.length + ' Datei' + (files.length > 1 ? 'en' : '') + '):'), previewTable(r.items));
  } catch (e) { if (seq === previewSeq) fill(box, h('div', {class: 'small bad'}, e.message)); }
}, 300);

// ---------- Seite „Umbenennen“ ----------
const R = {files: [], rules: [], pattern: ''};
let rnAddRule = null;
function rnPick(r) { return {items: R.files.map(f => f.path), pattern: R.pattern.trim(), replace: cleanRules(R.rules), mode: 'rename'}; }
const rnRefresh = debounce(async () => {
  $('#rnSummary').textContent = R.files.length ? R.files.length + ' Datei(en)' : '';
  if (!R.files.length) { fill($('#rnPreview'), previewTable([])); $('#rnApply').disabled = true; return; }
  try {
    const r = await api('/api/rename/preview', rnPick());
    const changed = r.items.filter(x => !x.error && x.new !== x.old).length;
    fill($('#rnPreview'), previewTable(r.items));
    $('#rnApply').disabled = !changed;
    $('#rnApply').textContent = changed ? changed + ' Datei(en) umbenennen' : 'Umbenennen';
  } catch (e) { fill($('#rnPreview'), h('div', {class: 'small bad'}, e.message)); $('#rnApply').disabled = true; }
}, 250);
function renderRenamePage() {
  $('#rnPattern').value = R.pattern;
  varChips($('#rnChips'), $('#rnPattern'), NAME_VARS.media, () => { R.pattern = $('#rnPattern').value; rnRefresh(); });
  rnAddRule = ruleEditor($('#rnRules'), () => R.rules, rows => { R.rules = rows; }, rnRefresh);
  rnRefresh();
}
function wireRename() {
  $('#renameBtn').onclick = () => { location.hash = '#rename'; };
  $('#rnBack').onclick = () => { location.hash = ''; };
  $('#addRule').onclick = () => addRuleFn && addRuleFn();
  $('#rnAddRule').onclick = () => rnAddRule && rnAddRule();
  $('#rnPattern').addEventListener('input', () => { R.pattern = $('#rnPattern').value; rnRefresh(); });
  $('#pattern').addEventListener('input', () => { saveSettings(); refreshNamePreview(); });
  $('#suffix').addEventListener('input', () => { saveSettings(); refreshNamePreview(); });
  const add = files => { const have = new Set(R.files.map(f => f.path)); files.forEach(f => have.has(f.path) || R.files.push({path: f.path, size: f.size})); rnRefresh(); };
  $('#rnAddFiles').onclick = async () => {
    const r = await openBrowser('files', S.lastDir); if (!r) return;
    if (r.dir) S.lastDir = r.dir;
    add((await api('/api/scan', {paths: r.paths, kind: 'media'})).files);
  };
  $('#rnAddFolder').onclick = async () => {
    const r = await openBrowser('dir', S.lastDir); if (!r) return;
    S.lastDir = r.dir;
    add((await api('/api/scan', {paths: [r.dir], kind: 'media'})).files);
  };
  $('#rnClear').onclick = () => { R.files = []; rnRefresh(); };
  $('#rnApply').onclick = async () => {
    const n = R.files.length;
    if (!confirm('Dateien jetzt umbenennen? Das Umbenennen lässt sich nicht automatisch rückgängig machen (Vorschau prüfen).')) return;
    try {
      const r = await api('/api/rename', rnPick());
      toast(r.renamed + ' umbenannt' + (r.failed ? ', ' + r.failed + ' nicht möglich' : '') + '.', r.failed ? 'bad' : 'ok');
      fill($('#rnPreview'), previewTable(r.items));
      // Liste auf die neuen Namen umstellen, damit weiter gearbeitet werden kann
      R.files = r.items.map(x => ({path: x.done ? x.path.slice(0, x.path.length - x.old.length) + x.new : x.path}));
      R.pattern = ''; R.rules = []; $('#rnPattern').value = '';
      rnAddRule = ruleEditor($('#rnRules'), () => R.rules, rows => { R.rules = rows; }, rnRefresh);
      $('#rnApply').disabled = true; $('#rnSummary').textContent = n + ' Datei(en)';
    } catch (e) { toast(e.message, 'bad'); }
  };
}
