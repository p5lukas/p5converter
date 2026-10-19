'use strict';
/* Einstellungen-Seite, Voreinstellungen und gemeinsame Hilfsfunktionen. Wird vor app.js geladen; app.js stellt
   $, api, S, toast, applyTheme, … bereit (nur zur Laufzeit benutzt). Die Einstellungen liegen auf dem Server (/config). */

// ---------- kleine DOM-Helfer ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') { el[k] = v; if (k === 'value') el.setAttribute('value', v); }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const fill = (el, ...kids) => { el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false)); return el; };
const opt = (v, t) => h('option', {value: v}, t);

// ---------- Welten (Namen/Farben aus den Einstellungen) ----------
const WORLD_DEFAULTS = {audio: {name: 'Audio', hue: 140}, video: {name: 'Video', hue: 270}};
const cfg = () => (S.cfg && S.cfg.settings) || {worlds: WORLD_DEFAULTS, worldOrder: ['audio', 'video'], presets: [], startWorld: 'last', showNews: true, preferredBackend: 'auto', hwDecode: true};
const W = w => (cfg().worlds && cfg().worlds[w]) || WORLD_DEFAULTS[w];
const worldOrder = () => cfg().worldOrder || ['audio', 'video'];

function renderWorldNav() {
  const nav = $('#worlds');
  fill(nav, worldOrder().map(id => h('button', {'data-world': id, class: id === S.world ? 'on' : '', onclick: () => setWorld(id, true)},
    h('span', {class: 'pl'}), h('span', {class: 'wl'}, W(id).name), h('span', {class: 'wbadge hidden', title: 'Aufträge laufen oder warten'}))));
}

async function saveCfg(mutate, msg) {
  const next = JSON.parse(JSON.stringify(cfg()));
  mutate(next);
  try {
    const r = await api('/api/settings', next, 'PUT');
    S.cfg.settings = r.settings; S.cfg.persistent = r.persistent;
    applyCfg();
    if (msg !== false) toast(msg || 'Gespeichert ✓', 'ok');
    return true;
  } catch (e) { toast(e.message, 'bad'); return false; }
}

// Farben, Namen, Reihenfolge, Vorschläge neu zeichnen
function applyCfg() {
  renderWorldNav();
  if (typeof refreshVideoUI === 'function' && S.info) refreshVideoUI();
  applyTheme(S.world);
  renderPresetChips();
  renderStartInfo();
  if (!$('#viewSettings').classList.contains('hidden')) renderSettings();
}

// ---------- Voreinstellungen ----------
const PRESET_FIELDS = {
  audio: ['aFormat', 'aMode', 'aQuality', 'aBitrate', 'aFlac', 'aWav', 'aRate', 'aCh', 'aCover', 'pattern', 'suffix', 'renRules'],
  video: ['vContainer', 'vCodec', 'vBackend', 'vCrf', 'vQuality', 'vPreset', 'vDepth', 'vHeight', 'vHwDec', 'vAudioMode', 'vAudioCodec', 'vAudioKbps', 'vSubMode', 'vTrkRules', 'pattern', 'suffix', 'renRules'],
};
// diese Felder hängen von anderen ab (Optionen werden erst nach dem ersten Durchgang neu aufgebaut)
const LATE_FIELDS = ['vBackend', 'aMode', 'aQuality', 'aBitrate'];

function collectPresetValues(world) {
  const o = {};
  PRESET_FIELDS[world].forEach(k => { const el = $('#' + k); if (el) o[k] = el.type === 'checkbox' ? el.checked : el.value; });
  return o;
}
function setField(k, v) {
  const el = $('#' + k); if (!el) return;
  if (el.type === 'checkbox') el.checked = !!v;
  else if (el.tagName === 'SELECT') { if ([...el.options].some(o => o.value === String(v) && !o.disabled)) el.value = String(v); }
  else el.value = String(v);
}
function applyPreset(p) {
  const v = p.values || {};
  Object.entries(v).filter(([k]) => !LATE_FIELDS.includes(k)).forEach(([k, x]) => setField(k, x));
  refreshAudioUI(); refreshVideoUI();
  Object.entries(v).filter(([k]) => LATE_FIELDS.includes(k)).forEach(([k, x]) => setField(k, x));
  if (p.world === 'video') qAfterPreset(v);
  refreshAudioUI(); refreshVideoUI(); syncNameUI(); saveSettings();
  if (typeof cvRender === 'function') cvRender();
}
function renderPresetChips() {
  [['audio', '#aPresets'], ['video', '#vPresets']].forEach(([world, sel]) => {
    const box = $(sel); if (!box) return;
    const list = cfg().presets.filter(p => p.world === world && p.suggest);
    fill(box, list.map(p => h('button', {title: describePreset(p), onclick: () => { applyPreset(p); toast('Voreinstellung „' + p.name + '“ geladen', 'ok'); }}, p.name)),
      h('button', {class: 'ghost', title: 'Voreinstellungen verwalten', onclick: () => { location.hash = '#settings/presets'; }}, icon('gear'), list.length ? '' : ' Keine Vorschläge – Voreinstellungen verwalten'));
  });
}

const CODEC_NAMES = {copy: 'Remux (Video kopieren)', h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9'};
const AFMT_NAMES = {mp3: 'MP3', ogg: 'Ogg Vorbis', opus: 'Opus', m4a: 'AAC (M4A)', flac: 'FLAC', wav: 'WAV'};
function describePreset(p) {
  const v = p.values || {}, o = [];
  if (p.world === 'video') {
    o.push(CODEC_NAMES[v.vCodec] || 'Video');
    if (v.vCodec && v.vCodec !== 'copy') {
      if (v.vCrf != null) o.push('CRF ' + v.vCrf);
      if (String(v.vDepth) === '10') o.push('10 Bit');
      if (v.vHeight != null && String(v.vHeight) !== '0') o.push(v.vHeight + 'p');
      if (v.vBackend && v.vBackend !== 'auto') o.push(v.vBackend);
    }
    if (v.vContainer) o.push(String(v.vContainer).toUpperCase());
    try { const r = JSON.parse(v.vTrkRules || '{}'); const n = (r.audio || []).length + (r.sub || []).length; if (n) o.push(n + (n === 1 ? ' Regel für Spuren' : ' Regeln für Spuren')); } catch (e) { /* ignorieren */ }
  } else {
    o.push(AFMT_NAMES[v.aFormat] || 'Audio');
    if (v.aFormat === 'flac') o.push('Stufe ' + (v.aFlac ?? 5));
    else if (v.aFormat === 'wav') o.push((v.aWav || 16) + ' Bit');
    else if (v.aMode === 'vbr' && (v.aFormat === 'mp3' || v.aFormat === 'ogg')) o.push('VBR ' + (v.aQuality ?? ''));
    else if (v.aBitrate) o.push(v.aBitrate + ' kbit/s');
    if (v.aCh === '1' || v.aCh === 1) o.push('Mono');
  }
  return o.filter(Boolean).join(' · ');
}

// --- Dialog „Als Voreinstellung speichern“ ---
function openPresetDialog() {
  const world = S.world;
  $('#presetName').value = '';
  $('#presetSuggest').checked = true;
  $('#presetHint').textContent = 'Gespeichert werden alle Einstellungen der Welt „' + W(world).name + '“ (ohne Dateien und Zielordner).';
  $('#presetDlg').showModal();
  setTimeout(() => $('#presetName').focus(), 50);
}
async function savePresetFromDialog() {
  const name = $('#presetName').value.trim();
  if (!name) { toast('Bitte einen Namen eingeben.', 'bad'); return; }
  const world = S.world, values = collectPresetValues(world), suggest = $('#presetSuggest').checked;
  if (await saveCfg(c => c.presets.push({id: '', name, world, suggest, values}), 'Voreinstellung „' + name + '“ gespeichert ✓')) $('#presetDlg').close();
}

// --- Bearbeiten einer Voreinstellung im Konverter ---
function editPreset(id) {
  const p = cfg().presets.find(x => x.id === id); if (!p) return;
  S.editPreset = id;
  location.hash = '';
  setWorld(p.world, false);
  applyPreset(p);
  renderEditBanner();
  showStep('convert');
}
function renderEditBanner() {
  const b = $('#editBanner'), p = S.editPreset && cfg().presets.find(x => x.id === S.editPreset);
  if (!p) { b.classList.add('hidden'); b.replaceChildren(); return; }
  b.classList.remove('hidden');
  fill(b, h('span', {}, icon('edit'), ' Voreinstellung „' + p.name + '“ wird bearbeitet – Einstellungen ändern, dann speichern'),
    h('button', {class: 'primary small', onclick: async () => {
      const values = collectPresetValues(p.world);
      if (await saveCfg(c => { c.presets.find(x => x.id === p.id).values = values; }, 'Voreinstellung „' + p.name + '“ aktualisiert ✓')) { S.editPreset = null; renderEditBanner(); }
    }}, 'Änderungen speichern'),
    h('button', {class: 'small ghost', onclick: () => { S.editPreset = null; renderEditBanner(); }}, 'Abbrechen'));
}

// ---------- Seite „Einstellungen“ ----------
const SET_GROUPS = [
  {id: 'general', icon: 'gear', title: 'Allgemein', sub: 'Startansicht, Zielordner, parallele Aufträge'},
  {id: 'worlds', icon: 'planet', title: 'Welten & Farben', sub: 'Namen, Farben, Planeten'},
  {id: 'presets', icon: 'star', title: 'Voreinstellungen', sub: 'Vorschläge anlegen und ordnen'},
  {id: 'hardware', icon: 'bolt', title: 'Hardware', sub: 'Encoder, Erkennung, Diagnose'},
  {id: 'tracks', icon: 'star', title: 'Audio & Untertitel', sub: 'Sprachen und Standard-Spuren'},
  {id: 'auth', icon: 'lock', title: 'Anmeldung', sub: 'Passwort und Benutzer'},
  {id: 'about', icon: 'info', title: 'Info', sub: 'Version, Neuigkeiten, Speicherort'},
];
const isMobile = () => matchMedia('(max-width:700px)').matches;

function showView(v) {
  $('#viewMain').classList.toggle('hidden', v !== 'main');
  $('#viewSettings').classList.toggle('hidden', v !== 'settings');
  $('#viewRename').classList.toggle('hidden', v !== 'rename');
  $('#viewLogs').classList.toggle('hidden', v !== 'logs');
  $('#viewHistory').classList.toggle('hidden', v !== 'history');
  if (v !== 'logs') stopLogs();
  if (v !== 'history') stopHistory();
  document.body.classList.toggle('inSettings', v === 'settings');
  window.scrollTo(0, 0);
}
function route() {
  if ($('#detailsDlg') && $('#detailsDlg').open) $('#detailsDlg').close(); // das Fenster „Details“ bleibt nicht über einer anderen Seite stehen
  const m = /^#settings(?:\/(\w+))?$/.exec(location.hash);
  if (location.hash === '#rename') { showView('rename'); renderRenamePage(); }
  else if (location.hash === '#logs') { showView('logs'); logsPage(); }
  else if (location.hash === '#history') { showView('history'); historyPage(); }
  else if (m) { S.setPage = m[1] || ''; showView('settings'); renderSettings(); }
  else { showView('main'); if (S.step === 'convert' && typeof cvRender === 'function') cvRender(); }
}

function row(label, control, infoKey, hint) {
  return h('div', {class: 'setrow'},
    h('div', {class: 'setl'}, h('b', {}, label, infoKey ? infoBtn(infoKey) : null), hint ? h('span', {class: 'muted small'}, hint) : null),
    h('div', {class: 'setc'}, control));
}
const check = (checked, onchange, text) => h('label', {class: 'check', style: 'margin:0'}, h('input', {type: 'checkbox', checked, onchange: e => onchange(e.target.checked)}), text);

function renderSettings() {
  const root = $('#viewSettings');
  const mobile = isMobile();
  const page = S.setPage || (mobile ? '' : 'general');
  const group = SET_GROUPS.find(g => g.id === page);
  const back = h('button', {class: 'ghost', onclick: () => { location.hash = ''; }}, '← Zum Konverter');
  const warn = S.cfg && !S.cfg.persistent ? h('div', {class: 'banner warn'}, icon('warn'), ' Die Einstellungen werden nicht dauerhaft gespeichert: Der Pfad ', h('code', {}, '/config'), ' ist nicht eingehängt oder nicht beschreibbar. Im Unraid-Template den Pfad „Einstellungen“ eintragen.') : null;

  if (mobile && !group) {
    fill(root, h('div', {class: 'sethead'}, back, h('h1', {}, 'Einstellungen')), warn,
      h('div', {class: 'mlist'}, SET_GROUPS.map(g => h('button', {class: 'mitem', onclick: () => { location.hash = '#settings/' + g.id; }},
        h('i', {}, icon(g.icon)), h('span', {}, h('b', {}, g.title), h('small', {}, g.sub)), h('em', {}, '›')))));
    return;
  }
  const nav = h('nav', {class: 'setnav'}, SET_GROUPS.map(g => h('button', {class: g.id === page ? 'on' : '', onclick: () => { location.hash = '#settings/' + g.id; }}, h('i', {}, icon(g.icon)), g.title)));
  const builders = {general: pageGeneral, worlds: pageWorlds, presets: pagePresets, hardware: pageHardware, tracks: pageTracks, auth: pageAuth, about: pageAbout};
  const content = (builders[page] || pageGeneral)();
  fill(root, h('div', {class: 'sethead'}, mobile ? h('button', {class: 'ghost', onclick: () => { location.hash = '#settings'; }}, '‹ Einstellungen') : back,
    mobile ? null : h('h1', {}, 'Einstellungen')), warn,
    mobile ? h('div', {class: 'setpage panel'}, content) : h('div', {class: 'setlayout'}, nav, h('div', {class: 'setpage panel'}, content)));
}
matchMedia('(max-width:700px)').addEventListener('change', () => { if (!$('#viewSettings').classList.contains('hidden')) renderSettings(); });

// Standardauswahl der Kontrolle nach dem Konvertieren, je Welt (im Konverter pro Lauf änderbar)
function verifyControls(w) {
  const v = (cfg().verify || {})[w] || {tracks: true, decode: true};
  const set = f => saveCfg(x => { x.verify = x.verify || {}; x.verify[w] = {...(x.verify[w] || v)}; f(x.verify[w]); }, false).then(ok => { if (ok) { vfReset(w); toast('Gespeichert ✓', 'ok'); } });
  return h('div', {class: 'vfset'},
    check(v.tracks !== false, on => set(o => { o.tracks = on; }), 'Spuren & Größe prüfen (kaum länger)'),
    check(v.decode !== false, on => set(o => { o.decode = on; }), w === 'audio' ? 'Ergebnis komplett durchlesen (kaum länger)' : 'Ergebnis komplett durchlesen (Decode-Test, bei Video merklich länger)'));
}

// --- Allgemein ---
// Anzeigenamen für die Quellordner (Wurzeln aus P5_ROOTS bzw. den Pfaden im Template); der echte Pfad bleibt unverändert
function rootNamesRow() {
  const roots = (S.info && S.info.roots) || [], names = cfg().rootNames || {};
  if (!roots.length) return row('Quellordner', h('span', {class: 'muted'}, 'Keine Ordner eingeschränkt: Das Programm zeigt den ganzen Rechner, Anzeigenamen sind nicht nötig.'), null, 'Namen im Datei-Browser');
  return row('Namen der Quellordner', h('div', {class: 'rootnames'}, roots.map(r => {
    const inp = h('input', {value: names[r] || '', maxlength: 40, placeholder: 'z. B. Filme 4K', 'aria-label': 'Anzeigename für ' + r,
      onchange: () => saveCfg(x => { x.rootNames = x.rootNames || {}; const v = inp.value.trim(); if (v) x.rootNames[r] = v; else delete x.rootNames[r]; })});
    return h('label', {class: 'rootname'}, h('code', {}, r), inp);
  })), null, 'Im Datei-Browser statt des Ordnerpfads angezeigt (leer = Pfad)');
}
function pageGeneral() {
  const c = cfg();
  const start = h('select', {onchange: () => saveCfg(x => { x.startWorld = start.value; })}, opt('last', 'Zuletzt benutzte Welt'), opt('audio', W('audio').name), opt('video', W('video').name));
  start.value = c.startWorld;
  const concSel = (key, fallback) => { const s = h('select', {onchange: () => saveCfg(x => { x[key] = +s.value; })}, [1, 2, 3, 4, 5, 6, 7, 8].map(n => opt(n, n))); s.value = c[key] || fallback || 1; return s; };
  const concA = concSel('concurrencyAudio', S.conc && S.conc.audio), concV = concSel('concurrency', S.conc && S.conc.video);
  const out = h('input', {value: c.defaultOutDir || '', placeholder: 'leer = neben der Quelldatei', onchange: () => saveCfg(x => { x.defaultOutDir = out.value.trim(); })});
  const pick = h('button', {onclick: async () => { const r = await openBrowser('dir', out.value); if (r) { out.value = r.dir; out.dispatchEvent(new Event('change')); } }}, '…');
  return h('div', {}, h('h2', {}, 'Allgemein'),
    row('Startansicht', start, 'setStart', 'Welche Welt beim Öffnen erscheint'),
    row('Parallele Aufträge – ' + W('audio').name, concA, 'conc', 'Wie viele Audio-Dateien gleichzeitig laufen'),
    row('Parallele Aufträge – ' + W('video').name, concV, 'conc', 'Wie viele Videos gleichzeitig laufen (bei CPU-Encoding 1)'),
    row('Standard-Zielordner', h('div', {class: 'row'}, out, pick), 'outDir', 'Wird vorgeschlagen, wenn im Konverter nichts anderes gewählt ist'),
    rootNamesRow(),
    row('Kontrolle – ' + W('audio').name, verifyControls('audio'), 'vfInfo', 'Standardauswahl für „danach geprüft“ beim Konvertieren'),
    row('Kontrolle – ' + W('video').name, verifyControls('video'), 'vfInfo', 'Standardauswahl für „danach geprüft“ beim Konvertieren'),
    row('Qualität nach Material', check(c.noCrfSuggest !== true, v => saveCfg(x => { x.noCrfSuggest = !v; }).then(() => { S.qSig = null; refreshVideoUI(); }), 'Die Qualitätsstufe nach der Art des Materials anpassen (Anime, Korn …)'), 'vMaterial'),
    row('Neuigkeiten', check(c.showNews, v => saveCfg(x => { x.showNews = v; }), 'Hinweis „Neuigkeiten“ bei neuer Version zeigen')));
}

// --- Welten & Farben ---
function pageWorlds() {
  const order = worldOrder();
  return h('div', {}, h('h2', {}, 'Welten & Farben', infoBtn('setWorlds')),
    h('p', {class: 'muted'}, 'Jede Welt hat ihren Namen, ihre Farbe und ihren Planeten. Die Farbe färbt die ganze Oberfläche.'),
    order.map((id, i) => {
      const w = W(id);
      const name = h('input', {value: w.name, maxlength: 20, 'aria-label': 'Name der Welt', onchange: () => {
        if (!name.value.trim()) { name.value = w.name; return; }
        saveCfg(x => { x.worlds[id].name = name.value.trim(); });
      }});
      return h('div', {class: 'worldcard'},
        h('div', {class: 'wchead'}, planetSvg(w.hue, 38), name,
          h('button', {class: 'small', disabled: i === 0, title: 'Nach oben/links', onclick: () => saveCfg(x => { x.worldOrder = [x.worldOrder[1], x.worldOrder[0]]; })}, '◀'),
          h('button', {class: 'small', disabled: i === order.length - 1, title: 'Nach unten/rechts', onclick: () => saveCfg(x => { x.worldOrder = [x.worldOrder[1], x.worldOrder[0]]; })}, '▶')),
        h('div', {class: 'swatches'}, WORLD_THEMES.map(t => h('button', {class: 'swatch' + (t.hue === w.hue ? ' on' : ''), title: t.name,
          onclick: () => saveCfg(x => { x.worlds[id].hue = t.hue; })}, planetSvg(t.hue, 26), h('span', {}, t.name)))));
    }));
}

// --- Voreinstellungen ---
function pagePresets() {
  const tab = S.presetTab || 'video';
  const all = cfg().presets, mine = all.filter(p => p.world === tab);
  const tabs = h('div', {class: 'tabs'}, ['audio', 'video'].map(w => h('button', {class: w === tab ? 'on' : '', onclick: () => { S.presetTab = w; renderSettings(); }},
    W(w).name, h('small', {}, ' ' + all.filter(p => p.world === w).length))));
  const move = (p, d) => saveCfg(x => {
    const same = x.presets.filter(q => q.world === p.world), i = same.findIndex(q => q.id === p.id), j = i + d;
    if (j < 0 || j >= same.length) return;
    const a = x.presets.findIndex(q => q.id === same[i].id), b = x.presets.findIndex(q => q.id === same[j].id);
    [x.presets[a], x.presets[b]] = [x.presets[b], x.presets[a]];
  }, false);
  const list = mine.length ? mine.map((p, i) => {
    const name = h('input', {value: p.name, maxlength: 40, 'aria-label': 'Name', onchange: () => {
      if (!name.value.trim()) { name.value = p.name; return; }
      saveCfg(x => { x.presets.find(q => q.id === p.id).name = name.value.trim(); });
    }});
    return h('div', {class: 'prow'},
      h('div', {class: 'pmain'}, name, h('span', {class: 'muted small'}, describePreset(p))),
      h('div', {class: 'pact'},
        check(p.suggest, v => saveCfg(x => { x.presets.find(q => q.id === p.id).suggest = v; }), 'Vorschlag'),
        h('button', {class: 'small', title: 'Nach oben', disabled: i === 0, onclick: () => move(p, -1)}, '↑'),
        h('button', {class: 'small', title: 'Nach unten', disabled: i === mine.length - 1, onclick: () => move(p, 1)}, '↓'),
        h('button', {class: 'small', title: 'Werte im Konverter bearbeiten', onclick: () => editPreset(p.id)}, icon('edit'), ' Werte'),
        h('button', {class: 'small', title: 'Duplizieren', onclick: () => saveCfg(x => { const q = x.presets.find(r => r.id === p.id); x.presets.push({...JSON.parse(JSON.stringify(q)), id: '', name: (q.name + ' Kopie').slice(0, 40)}); })}, icon('copy')),
        h('button', {class: 'small danger', title: 'Löschen', onclick: () => { if (confirm('Voreinstellung „' + p.name + '“ löschen?')) saveCfg(x => { x.presets = x.presets.filter(q => q.id !== p.id); }); }}, icon('trash'))));
  }) : h('div', {class: 'empty'}, 'Keine Voreinstellungen in dieser Welt.');
  return h('div', {}, h('h2', {}, 'Voreinstellungen', infoBtn('setPresets')),
    h('p', {class: 'muted'}, 'Voreinstellungen füllen alle Einstellungen einer Welt mit einem Klick. Die mit „Vorschlag“ erscheinen im Konverter oben als Knöpfe.'),
    tabs, mine.length > 1 ? h('div', {class: 'btns', style: 'margin-bottom:10px'}, h('span', {class: 'muted small'}, 'Vorschläge:'),
      h('button', {class: 'small', onclick: () => saveCfg(x => x.presets.forEach(q => { if (q.world === tab) q.suggest = true; }), false)}, 'Alle auswählen'),
      h('button', {class: 'small', onclick: () => saveCfg(x => x.presets.forEach(q => { if (q.world === tab) q.suggest = false; }), false)}, 'Alle abwählen')) : null,
    h('div', {class: 'plist'}, list),
    h('p', {class: 'muted small'}, 'Neue Voreinstellung: im Konverter die Einstellungen wählen und auf „Als Voreinstellung speichern“ (Diskette) klicken.'),
    h('div', {class: 'btns'}, h('button', {onclick: () => { location.hash = ''; setWorld(tab, false); }}, '→ Zum Konverter'),
      h('button', {class: 'ghost', onclick: restoreDefaultPresets}, 'Standard-Voreinstellungen wiederherstellen')));
}
async function restoreDefaultPresets() {
  try {
    const d = await api('/api/settings/defaults');
    const have = new Set(cfg().presets.map(p => p.id));
    const missing = d.presets.filter(p => !have.has(p.id));
    if (!missing.length) { toast('Alle Standard-Voreinstellungen sind schon da.', 'ok'); return; }
    await saveCfg(x => { x.presets.push(...missing); }, missing.length + ' Standard-Voreinstellung(en) wiederhergestellt ✓');
  } catch (e) { toast(e.message, 'bad'); }
}

// --- Audio & Untertitel: Sprach-Wünsche (nur Videowelt) ---
// Gemeinsame Auswahlliste: Sprachen aus LANGS; bei Untertiteln zusätzlich „(Forced)“ je Sprache (Wert „ger:forced“)
function langOptions(withForced) {
  const o = [];
  LANGS.forEach(([c, n]) => { o.push([c, n]); if (withForced) o.push([c + ':forced', n + ' (Forced – erzwungene Untertitel)']); });
  return o;
}
// Rangliste wie bei p5assets: nummerierte Karten mit Ziehgriff, ↑ ↓ und ✕, darunter „Sprache hinzufügen“. Reihenfolge = Priorität.
function rankList(items, labelOf, onChange, options, addText) {
  const wrap = h('div', {class: 'ranklist'});
  const key = x => typeof x === 'string' ? x : x.lang + (x.forced ? ':forced' : '');
  const fromKey = k => options === 'sub' ? {lang: k.split(':')[0], forced: k.endsWith(':forced')} : k;
  const render = () => {
    const opts = langOptions(options === 'sub').filter(([v]) => !items.some(x => key(x) === v));
    const add = h('select', {'aria-label': addText, onchange: () => { if (add.value) { items.push(fromKey(add.value)); onChange(items.slice()); render(); } }},
      h('option', {value: ''}, '+ ' + addText), opts.map(([v, t]) => h('option', {value: v}, t)));
    let drag = null;
    fill(wrap, items.map((x, i) => {
      const card = h('div', {class: 'rankcard', draggable: 'true'},
        h('span', {class: 'rghandle', title: 'Ziehen zum Sortieren', 'aria-hidden': 'true'}, '⋮⋮'),
        h('span', {class: 'rnum'}, i + 1),
        h('span', {class: 'rname'}, labelOf(x)),
        h('button', {type: 'button', class: 'small ghost', title: 'Nach oben', 'aria-label': 'Nach oben', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; onChange(items.slice()); render(); }}, '▲'),
        h('button', {type: 'button', class: 'small ghost', title: 'Nach unten', 'aria-label': 'Nach unten', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; onChange(items.slice()); render(); }}, '▼'),
        h('button', {type: 'button', class: 'small ghost', title: 'Entfernen', 'aria-label': 'Entfernen', onclick: () => { items.splice(i, 1); onChange(items.slice()); render(); }}, '✕'));
      card.addEventListener('dragstart', e => { drag = i; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch (err) { /* ok */ } });
      card.addEventListener('dragover', e => { e.preventDefault(); });
      card.addEventListener('drop', e => { e.preventDefault(); if (drag == null || drag === i) return; const [m] = items.splice(drag, 1); items.splice(i, 0, m); drag = null; onChange(items.slice()); render(); });
      return card;
    }), items.length ? null : h('p', {class: 'muted small'}, 'Noch keine Sprache.'), add);
  };
  render();
  return wrap;
}
function pageTracks() {
  const p = {audioKeep: [], subKeep: [], audioDefault: [], subDefault: [], ...(cfg().trackPrefs || {})};
  const save = (k, v) => saveCfg(x => { x.trackPrefs = {audioKeep: [], subKeep: [], audioDefault: [], subDefault: [], ...(x.trackPrefs || {})}; x.trackPrefs[k] = v; }, 'Gespeichert ✓').then(() => { if (S.step === 'tracks') trkRender(); });
  const nameOf = l => langName(l) + ' (' + l + ')';
  const subName = x => langName(x.lang) + (x.forced ? ' (Forced)' : '') + ' (' + x.lang + ')';
  const section = (title, hint, body) => h('div', {class: 'prefsec'}, h('h3', {}, title), h('p', {class: 'muted small'}, hint), body);
  return h('div', {}, h('h2', {}, 'Audio & Untertitel', infoBtn('trkPrefs')),
    h('p', {class: 'muted'}, 'Gilt für die Videowelt. In der Tabelle „Vorher → Nachher“ wendet das Programm das automatisch an (mit Funkel-Zeichen markiert): was entfernt wird und welche Spur Standard ist. Jeden Vorschlag kannst du dort ändern oder mit „rückgängig“ zurücknehmen.'),
    section('Ton: Sprachen behalten', 'Spuren in anderen Sprachen werden entfernt. Leer = alle behalten. Spuren ohne Sprachangabe bleiben immer. Hat eine Datei keine dieser Sprachen, wird nichts entfernt.',
      rankList(p.audioKeep.slice(), nameOf, v => save('audioKeep', v), 'plain', 'Sprache hinzufügen')),
    section('Ton: Standard-Spur', 'Diese Tonspur startet automatisch. Reihenfolge = Priorität: die erste Sprache, die in der Datei vorkommt, gewinnt (z. B. Deutsch, sonst Englisch). Kommentar-Spuren werden übersprungen.',
      rankList(p.audioDefault.slice(), nameOf, v => save('audioDefault', v), 'plain', 'Sprache hinzufügen')),
    section('Untertitel: Sprachen behalten', 'Untertitel in anderen Sprachen werden entfernt. Leer = alle behalten.',
      rankList(p.subKeep.slice(), nameOf, v => save('subKeep', v), 'plain', 'Sprache hinzufügen')),
    section('Untertitel: Standard', 'Dieser Untertitel startet automatisch. Reihenfolge = Priorität. „Deutsch (Forced)“ heißt: der erzwungene Untertitel, der nur bei fremdsprachigen Stellen erscheint. Findet das Programm keinen, bleibt alles wie es ist.',
      rankList(p.subDefault.map(x => ({...x})), subName, v => save('subDefault', v), 'sub', 'Untertitel hinzufügen')));
}

// --- Hardware ---
function pageHardware() {
  const c = cfg(), hw = (S.info && S.info.hw) || {backends: [], done: false};
  hw.backends = hw.backends || []; hw.diag = hw.diag || [];
  const pref = h('select', {onchange: () => saveCfg(x => { x.preferredBackend = pref.value; })},
    opt('auto', 'Automatisch (schnellste verfügbare)'), opt('cpu', 'CPU (Software)'), opt('qsv', 'Intel Quick Sync'), opt('nvenc', 'NVIDIA NVENC'), opt('vaapi', 'VAAPI'), opt('amf', 'AMD AMF'));
  pref.value = c.preferredBackend;
  const backends = hwRows(hw);
  const diagText = buildDiagText(hw);
  const diagRows = (hw.diag || []).map(d => h('tr', {}, h('td', {}, d.backend), h('td', {}, d.codec + (d.ten ? ' 10b' : '')), h('td', {}, d.variant || ''),
    h('td', {class: d.ok ? '' : 'warn'}, d.ok ? '✓ ok' : '✗'), h('td', {class: 'muted'}, d.msg || '')));
  return h('div', {}, h('h2', {}, 'Hardware'),
    row('Bevorzugter Encoder', pref, 'setBackend', 'Gilt im Konverter bei „Automatisch“, wenn dieser Encoder für den Codec nutzbar ist'),
    row('Hardware-Decoding', check(c.hwDecode, v => saveCfg(x => { x.hwDecode = v; }), 'Standardmäßig nutzen'), 'vHwDec'),
    h('h3', {}, 'Erkannte Hardware'), h('div', {}, hw.done ? backends : h('span', {class: 'muted'}, 'Erkennung läuft …')),
    h('details', {class: 'gpuhelp'}, h('summary', {}, 'Wie schalte ich meine GPU frei?'),
      ...((S.info && S.info.os) === 'windows' ? [
        h('p', {class: 'small'}, h('b', {}, 'Windows: '), 'Hier musst du nichts einstellen. Intel Quick Sync, NVIDIA NVENC und AMD AMF werden automatisch erkannt, sobald der aktuelle Grafiktreiber des Herstellers installiert ist (Intel, NVIDIA oder AMD).'),
        h('p', {class: 'small muted'}, 'Wird eine Grafikkarte nicht erkannt: Treiber aktualisieren, danach hier „Neu erkennen“ klicken. Quick Sync gibt es nur bei Intel-Prozessoren mit Grafikeinheit; NVIDIA-NVENC nur bei GeForce/Quadro ab der 600er-Reihe.')]
      : [
        h('p', {class: 'small'}, h('b', {}, 'Intel (Quick Sync) und AMD (VAAPI): '), 'Das Gerät ', h('code', {}, '/dev/dri'), ' muss an den Container durchgereicht werden. Im Unraid-Template ist es schon eingetragen; bei Docker: ', h('code', {}, '--device /dev/dri'), '.'),
        h('p', {class: 'small'}, h('b', {}, 'NVIDIA (NVENC): '), 'Nvidia-Treiber auf dem Server (Unraid: Plugin „Nvidia-Driver“) und beim Container ', h('code', {}, '--runtime=nvidia'), ' eintragen (Unraid: Erweiterte Ansicht → „Extra Parameters“). Alles Weitere ist im Image schon voreingestellt.'),
        h('p', {class: 'small muted'}, 'AMD AMF gibt es nur unter Windows. Danach hier „Neu erkennen“ klicken.')])),
    h('div', {class: 'btns', style: 'margin-top:12px'}, h('button', {onclick: async () => { await api('/api/hw/detect', {}); S.info.hw.done = false; renderSettings(); setTimeout(refreshInfoUntilDone, 800); }}, 'Neu erkennen'),
      h('button', {class: 'ghost', onclick: () => copyText(diagText)}, icon('clip'), ' Diagnose kopieren')),
    h('details', {class: 'diag'}, h('summary', {}, 'Diagnose (Details der Tests)'),
      h('p', {class: 'muted small'}, 'Grafik-/Videoeinheiten: ' + ((hw.gpus || []).join(', ') || 'keine gemeldet') + ' · Render-Geräte: ' + ((hw.renderNodes || []).join(', ') || 'keine') + ' · Test dauerte ' + ((hw.tookMs || 0) / 1000).toFixed(1) + ' s'),
      (hw.vainfo || []).map(v => h('p', {class: 'small'}, h('b', {}, v.node), ': ' + (v.driver || v.error || '–') + (v.encode && v.encode.length ? ' · Encode: ' + v.encode.join(', ') : ''))),
      diagRows.length ? h('div', {class: 'tbody'}, h('table', {}, h('tr', {}, h('th', {}, 'Backend'), h('th', {}, 'Codec'), h('th', {}, 'Start-Variante'), h('th', {}, ''), h('th', {}, 'ffmpeg-Meldung')), diagRows)) : h('p', {class: 'muted small'}, 'Keine Testergebnisse.')));
}
async function refreshInfoUntilDone() {
  S.info = normInfo(await api('/api/info')); refreshVideoUI();
  if (!$('#viewSettings').classList.contains('hidden')) renderSettings();
  if (!S.info.hw.done) setTimeout(refreshInfoUntilDone, 1200);
}
function buildDiagText(hw) {
  const l = ['p5converter ' + ((S.info && S.info.build && S.info.build.version) || ''), (S.info && S.info.ffmpeg) || ''];
  l.push('Grafik-/Videoeinheiten: ' + ((hw.gpus || []).join(', ') || '-'), 'Render-Geräte: ' + ((hw.renderNodes || []).join(', ') || '-'));
  (hw.vainfo || []).forEach(v => l.push('vainfo ' + v.node + ': ' + (v.driver || v.error || '-') + ' | Encode: ' + ((v.encode || []).join(', ') || '-')));
  (hw.backends || []).forEach(b => l.push(`[${b.id}] ${Object.keys(b.codecs || {}).filter(k => b.codecs[k]).join(',') || 'nicht nutzbar'}${b.variant ? ' via ' + b.variant : ''}${b.detail ? ' – ' + b.detail : ''}`));
  (hw.diag || []).forEach(d => l.push(`${d.backend} ${d.codec}${d.ten ? ' 10b' : ''} ${d.variant || ''}: ${d.ok ? 'ok' : 'FEHLER ' + (d.msg || '')}`));
  return l.join('\n');
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('In die Zwischenablage kopiert ✓', 'ok'); return; } catch (e) { /* weiter */ }
  const ta = h('textarea', {style: 'position:fixed;opacity:0'}); ta.value = t; document.body.append(ta); ta.select();
  try { document.execCommand('copy'); toast('In die Zwischenablage kopiert ✓', 'ok'); } catch (e) { toast('Kopieren nicht möglich', 'bad'); }
  ta.remove();
}

// --- Anmeldung ---
function pageAuth() {
  const a = S.auth || {enabled: false};
  if (!a.enabled) {
    const u = h('input', {autocomplete: 'username', autocapitalize: 'none', spellcheck: false, placeholder: 'Benutzername'});
    const p1 = h('input', {type: 'password', autocomplete: 'new-password', placeholder: 'Passwort (mindestens 8 Zeichen)'});
    const p2 = h('input', {type: 'password', autocomplete: 'new-password', placeholder: 'Passwort wiederholen'});
    const st = h('div', {class: 'status small'});
    return h('div', {}, h('h2', {}, 'Anmeldung', infoBtn('setAuth')),
      h('p', {class: 'muted'}, 'Optional: Schütze p5converter mit Benutzername und Passwort. Im reinen Heimnetz brauchst du das nicht zwingend – sobald die Oberfläche von außen erreichbar ist, solltest du es einschalten.'),
      S.cfg && !S.cfg.persistent ? h('div', {class: 'banner warn'}, icon('warn'), ' Ohne eingehängten Pfad /config geht die Anmeldung beim Neustart verloren – sie lässt sich deshalb noch nicht einschalten.') : null,
      h('div', {class: 'form'}, u, p1, p2,
        h('button', {class: 'primary', onclick: async e => {
          if (p1.value !== p2.value) { st.className = 'status small bad'; st.textContent = 'Die Passwörter stimmen nicht überein'; return; }
          e.currentTarget.disabled = true;
          try { S.auth = await api('/api/auth/setup', {username: u.value, password: p1.value}); toast('Anmeldung eingeschaltet ✓', 'ok'); updateAuthUI(); renderSettings(); }
          catch (err) { st.className = 'status small bad'; st.textContent = err.message; e.currentTarget.disabled = false; }
        }}, 'Anmeldung einschalten'), st));
  }
  const cur = h('input', {type: 'password', autocomplete: 'current-password', placeholder: 'Aktuelles Passwort'});
  const nu = h('input', {autocomplete: 'username', autocapitalize: 'none', placeholder: 'Neuer Benutzername (optional)'});
  const np = h('input', {type: 'password', autocomplete: 'new-password', placeholder: 'Neues Passwort (optional)'});
  const st = h('div', {class: 'status small'});
  const fail = m => { st.className = 'status small bad'; st.textContent = m; };
  return h('div', {}, h('h2', {}, 'Anmeldung', infoBtn('setAuth')),
    h('p', {}, 'Angemeldet als ', h('b', {}, a.user || ''), '. ', h('button', {class: 'small', onclick: logout}, icon('logout'), ' Abmelden')),
    row('Spaßmeldung', check(a.fun !== false, async v => { try { S.auth = await api('/api/auth/change', {fun: v}); toast('Gespeichert ✓', 'ok'); } catch (e) { toast(e.message, 'bad'); } }, 'Nach falschem Passwort eine Meldung zeigen'), null, 'Die rote Zeile im Anmeldefenster'),
    h('h3', {}, 'Benutzer oder Passwort ändern'),
    h('div', {class: 'form'}, cur, nu, np, h('button', {onclick: async e => {
      e.currentTarget.disabled = true;
      try { S.auth = await api('/api/auth/change', {current: cur.value, username: nu.value, newPassword: np.value}); toast('Geändert ✓', 'ok'); renderSettings(); }
      catch (err) { fail(err.message); e.currentTarget.disabled = false; }
    }}, 'Änderungen speichern')),
    h('h3', {}, 'Anmeldung ausschalten'),
    h('div', {class: 'form'}, h('button', {class: 'danger', onclick: async () => {
      const pw = cur.value; if (!pw) { fail('Bitte oben das aktuelle Passwort eintragen'); return; }
      if (!confirm('Anmeldung ausschalten? Danach kann jeder im Netz die Oberfläche öffnen.')) return;
      try { S.auth = await api('/api/auth/disable', {password: pw}); toast('Anmeldung ausgeschaltet', 'ok'); updateAuthUI(); renderSettings(); } catch (err) { fail(err.message); }
    }}, 'Anmeldung ausschalten (aktuelles Passwort oben eintragen)'), st),
    h('details', {class: 'diag'}, h('summary', {}, 'Passwort vergessen?'), h('p', {class: 'muted small'}, 'Das geht nur mit Zugriff auf den Server:'),
      h('ol', {class: 'small'}, h('li', {}, 'Im Container ausführen: ', h('code', {}, 'docker exec -it p5converter p5converter auth reset')),
        h('li', {}, 'Oder die Variable ', h('code', {}, 'P5_AUTH_RESET=1'), ' setzen und den Container neu starten (danach wieder entfernen).'),
        h('li', {}, 'Oder die Datei ', h('code', {}, '/config/auth.json'), ' löschen.'))));
}

// --- Info ---
function pageAbout() {
  const b = (S.info && S.info.build) || {}, c = (S.info && S.info.config) || {};
  const link = (t, u) => u ? h('a', {href: u, target: '_blank', rel: 'noopener'}, t) : t;
  return h('div', {}, h('h2', {}, 'Info'),
    h('img', {class: 'appicon', src: 'icon-192.png', width: 96, height: 96, alt: 'p5converter'}),
    h('div', {class: 'kv'},
      h('span', {}, 'Version'), h('b', {}, b.version || ''),
      h('span', {}, 'Branch'), link(b.branch || '–', b.branchUrl),
      h('span', {}, 'Commit'), b.commit ? link(b.commitShort, b.commitUrl) : '–',
      h('span', {}, 'ffmpeg'), (S.info && S.info.ffmpeg || '').replace(/^ffmpeg version /, '').split(' Copyright')[0],
      h('span', {}, 'System'), (S.info && S.info.os) || '',
      h('span', {}, 'Einstellungen'), c.persistent ? h('span', {}, 'gespeichert in ', h('code', {}, c.dir)) : h('span', {class: 'warn'}, 'nicht dauerhaft (Pfad /config fehlt)')),
    h('div', {class: 'btns', style: 'margin-top:14px'}, h('button', {onclick: openNews}, icon('news'), ' Neuigkeiten'), h('a', {href: b.repo, target: '_blank', rel: 'noopener'}, h('button', {class: 'ghost'}, 'GitHub'))));
}
