'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api = async (url, body, method) => {
  const r = await fetch(url, body === undefined ? {} : {method: method || 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && j.login && typeof showLogin === 'function') showLogin('Bitte melde dich erneut an.');
    const e = new Error(j.error || r.statusText); e.status = r.status; throw e;
  }
  return j;
};
const fmtSize = n => n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? (n / 1e3).toFixed(0) + ' KB' : (n || 0) + ' B';
const fmtTime = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };

const S = {step: 'start', vstep: 1, world: 'video', files: {audio: [], video: []}, info: null, jobs: [], stats: null};
const BACKEND_ORDER = ['qsv', 'nvenc', 'amf', 'vaapi', 'cpu'];
const CODEC_LABEL = {h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9'};
const SWENC = {h264: 'libx264', hevc: 'libx265', av1: 'libsvtav1', vp9: 'libvpx-vp9'};

// ---------- persisted settings ----------
const FIELDS = ['outMode', 'outDir', 'outStruct', 'exists', 'aFormat', 'aMode', 'aQuality', 'aBitrate', 'aFlac', 'aWav', 'aRate', 'aCh',
  'vContainer', 'vCodec', 'vBackend', 'vCrf', 'vQuality', 'vPreset', 'vDepth', 'vHeight', 'vAudioMode', 'vAudioCodec', 'vAudioKbps', 'vSubMode', 'vTrkRules'];
const CHECKS = ['aCover', 'vHwDec']; // „Quelldatei löschen“ wird bewusst NICHT gemerkt (verify.js, je Art, nur für diesen Besuch)
// Namensmuster, Zusatz und Ersetzungen gehören je Art (Audio und Video getrennt)
const NAME_FIELDS = ['pattern', 'suffix', 'renRules'];
const NAME_EMPTY = {pattern: '', suffix: '', renRules: '[]'};
S.name = {audio: {...NAME_EMPTY}, video: {...NAME_EMPTY}};
function stashName(world) { const o = {}; NAME_FIELDS.forEach(k => { o[k] = $('#' + k).value; }); S.name[world] = o; }
function showName(world) { NAME_FIELDS.forEach(k => { $('#' + k).value = (S.name[world] || NAME_EMPTY)[k] ?? NAME_EMPTY[k]; }); S.nameFor = world; }
function saveSettings() {
  if (S.nameFor) stashName(S.nameFor);
  const o = {name: S.name};
  FIELDS.forEach(f => o[f] = $('#' + f).value);
  CHECKS.forEach(f => o[f] = $('#' + f).checked);
  o.world = S.world;
  try { localStorage.setItem('p5c', JSON.stringify(o)); } catch (e) {}
}
function loadSettings() {
  try {
    const o = JSON.parse(localStorage.getItem('p5c') || '{}');
    FIELDS.forEach(f => { if (o[f] !== undefined) $('#' + f).value = o[f]; });
    CHECKS.forEach(f => { if (o[f] !== undefined) $('#' + f).checked = o[f]; });
    if (o.name) ['audio', 'video'].forEach(w => { if (o.name[w]) S.name[w] = {...NAME_EMPTY, ...o.name[w]}; });
    if (o.world) S.world = o.world;
  } catch (e) {}
}

// ---------- Art (Video oder Audio) ----------
// Die Art wird auf der Startseite gewählt. Video ist grün, Audio orange (nur Audio-Kachel und Audio-Ablauf); die Startseite und alle anderen Seiten sind grün.
function applyKindTheme() {
  const inFlow = S.step !== 'start' && !$('#viewMain').classList.contains('hidden');
  if (inFlow) document.documentElement.dataset.kind = S.world; else delete document.documentElement.dataset.kind;
}
function setWorld(w) {
  if (S.nameFor && S.nameFor !== w) stashName(S.nameFor);
  if (S.nameFor !== w) showName(w);
  if (S.vfFor && S.vfFor !== w) vfStash(S.vfFor);
  if (S.vfFor !== w) vfShow(w);
  S.world = w;
  renderFiles();
  refreshAudioUI();
  refreshVideoUI();
  renderStartInfo();
  syncNameUI();
  renderQueue(); renderHero(); renderHistBadge(); renderSaved(); renderStartTiles();
  saveSettings();
}
// Startseite: Kachel Video oder Audio gewählt → in den Ablauf dieser Art
function enterKind(w) {
  if (w !== S.world) setWorld(w);
  if (location.hash) location.hash = '';
  S.step = 'convert';
  if (w === 'video' && !S.files.video.length) S.vstep = 1;
  applySteps(); cvRender();
  window.scrollTo(0, 0);
}

// ---------- audio UI ----------
const A_BITRATES = {mp3: [96, 128, 160, 192, 224, 256, 320], ogg: [96, 128, 160, 192, 224, 256, 320, 500], opus: [48, 64, 96, 128, 160, 192, 256], m4a: [96, 128, 160, 192, 256, 320]};
function refreshAudioUI() {
  const f = $('#aFormat').value, mode = $('#aMode').value;
  const lossy = ['mp3', 'ogg', 'opus', 'm4a'].includes(f);
  const vbrOK = f === 'mp3' || f === 'ogg';
  $('#aModeRow').classList.toggle('hidden', !(f === 'mp3' || f === 'ogg' || f === 'opus'));
  if (!vbrOK && f !== 'opus') $('#aMode').value = 'cbr';
  const m = $('#aMode').value;
  $('#aQualityRow').classList.toggle('hidden', !(vbrOK && m === 'vbr'));
  $('#aBitrateRow').classList.toggle('hidden', !lossy || (vbrOK && m === 'vbr'));
  $('#aFlacRow').classList.toggle('hidden', f !== 'flac');
  $('#aWavRow').classList.toggle('hidden', f !== 'wav');
  const q = $('#aQuality');
  if (f === 'mp3') { q.min = 0; q.max = 9; $('#aQualityOut').textContent = 'V' + q.value + ' (0 = beste)'; }
  else { q.min = -1; q.max = 10; $('#aQualityOut').textContent = q.value + ' (10 = beste)'; }
  $('#aFlacOut').textContent = $('#aFlac').value;
  const cur = $('#aBitrate').value;
  const list = A_BITRATES[f] || [];
  $('#aBitrate').innerHTML = list.map(b => `<option value="${b}">${b} kbit/s</option>`).join('');
  $('#aBitrate').value = list.includes(+cur) ? cur : (f === 'opus' ? 128 : 192);
  $('#aCover').parentElement.classList.toggle('hidden', !['mp3', 'm4a', 'flac'].includes(f));
}

// ---------- video UI ----------
// Antworten von /api/info: Listen sind nie null (die Erkennung kann noch laufen, wenn die Oberfläche schon fragt)
function normInfo(info) {
  const h = info.hw || {};
  ['backends', 'gpus', 'renderNodes', 'diag', 'vainfo'].forEach(k => { if (!Array.isArray(h[k])) h[k] = []; });
  info.hw = h; info.encoders = info.encoders || {};
  return info;
}
function hwResult() { return (S.info && S.info.hw) || {backends: [], done: false}; }
function backendCaps(id) { return (hwResult().backends || []).find(b => b.id === id); }
function workingBackends(codec) {
  return BACKEND_ORDER.filter(id => { const b = backendCaps(id); return b && b.codecs && b.codecs[codec]; });
}
// „Automatisch“ nimmt den bevorzugten Encoder aus Einstellungen → Hardware, wenn er für diesen Codec nutzbar ist, sonst den schnellsten
// verfügbaren (eine bewusst gewählte Hardware im Assistenten gilt immer)
function preferredFor(codec) {
  const p = cfg().preferredBackend;
  if (!p || p === 'auto') return null;
  if (p === 'cpu') return 'cpu';
  const b = backendCaps(p);
  return b && b.codecs && b.codecs[codec] ? p : null;
}
function resolveBackend() {
  const codec = $('#vCodec').value, sel = $('#vBackend').value;
  if (codec === 'copy') return {id: 'copy'};
  if (sel !== 'auto') return {id: sel};
  const p = preferredFor(codec);
  if (p) return {id: p, auto: true, pref: true};
  const w = workingBackends(codec);
  return {id: w[0] || 'cpu', auto: true};
}
function refreshVideoUI() {
  const codec = $('#vCodec').value, copy = codec === 'copy';
  // backend options
  const cur = $('#vBackend').value || 'auto';
  const prefId = preferredFor(codec);
  const opts = ['<option value="auto">' + (prefId ? 'Automatisch (bevorzugt: ' + esc(BACKEND_FULL[prefId] || prefId) + ')' : 'Automatisch (schnellste verfügbare)') + '</option>'];
  BACKEND_ORDER.forEach(id => {
    const b = backendCaps(id);
    if (!b) return;
    const ok = b.codecs && b.codecs[codec];
    opts.push(`<option value="${id}" ${ok ? '' : 'disabled'}>${esc(b.label)}${ok ? ' ✓' : (b.compiled ? ' – nicht verfügbar' : ' – nicht im ffmpeg')}</option>`);
  });
  $('#vBackend').innerHTML = opts.join('');
  $('#vBackend').value = cur;
  if ($('#vBackend').value !== cur) $('#vBackend').value = 'auto';

  const r = resolveBackend();
  const hw = !copy && r.id !== 'cpu';
  ['#vBackendRow', '#vCrfRow', '#vCrfAdvice', '#vPresetRow', '#vDepthRow', '#vHeightRow', '#vHwDecRow'].forEach(s => $(s).classList.toggle('hidden', copy));
  $('#vHwDecRow').classList.toggle('hidden', !hw);
  const container = $('#vContainer').value;
  const resolvedEl = $('#vResolved');
  if (copy) resolvedEl.innerHTML = '<span class="chip acc">Video wird kopiert</span>';
  else {
    const enc = encoderName(r.id, codec);
    resolvedEl.innerHTML = `<b>${esc(enc)}</b> ${r.id === 'cpu' ? '<span class="chip">CPU</span>' : '<span class="chip ok">' + esc(BACKEND_FULL[r.id] || 'Hardware') + '</span>'}` + (r.pref ? ' <span class="muted small">(bevorzugt laut Einstellungen)</span>' : '') +
      (!hwResult().done ? ' <span class="muted small">Hardware-Erkennung läuft …</span>' : '');
  }
  qApply(); // Qualitätsstufe → Zahl (Encoder, Codec, Material oder Höhe haben sich vielleicht geändert)
  $('#vCrfHint').textContent = r.id === 'cpu' || copy ? 'Niedriger = bessere Qualität / größere Datei.' : 'Niedriger = bessere Qualität / größere Datei. Die Zahl gilt nur für diesen Encoder.';
  // 10 bit availability
  const depth = $('#vDepth');
  let tenOK = true;
  if (!copy) {
    if (r.id === 'cpu') tenOK = true;
    else { const b = backendCaps(r.id); tenOK = !!(b && b.tenBit && b.tenBit[codec]); }
  }
  [...depth.options].forEach(o => { if (o.value === '10') o.disabled = !tenOK; });
  if (!tenOK && depth.value === '10') depth.value = '8';
  $('#vAudioCodecRow').classList.toggle('hidden', $('#vAudioMode').value !== 'encode');
  $('#vAudioHint').classList.toggle('hidden', $('#vAudioMode').value !== 'encode');
  trkRuleHint();
  crfRefresh();
  renderHwCard();
}
function encoderName(backend, codec) {
  const m = {qsv: '_qsv', nvenc: '_nvenc', vaapi: '_vaapi', amf: '_amf'};
  if (backend === 'cpu') {
    if (codec === 'av1' && S.info && !S.info.encoders.libsvtav1 && S.info.encoders['libaom-av1']) return 'libaom-av1';
    return SWENC[codec];
  }
  return codec + m[backend];
}
// Hardware-Liste (Startseite und Einstellungen → Hardware): nutzbare zuerst, nicht nutzbare eingeklappt, Gründe auf Klick
const HW_FOREIGN = {linux: ['amf'], windows: ['vaapi'], darwin: ['amf', 'vaapi', 'nvenc', 'qsv']};
function hwRows(hw) {
  const os = (S.info && S.info.os) || '', hide = HW_FOREIGN[os] || [];
  const list = hw.backends.filter(b => !hide.includes(b.id));
  const codecsOf = b => ['h264', 'hevc', 'av1', 'vp9'].filter(c => b.codecs && b.codecs[c]);
  const name = b => h('b', {}, b.label, b.gpu ? h('span', {class: 'muted small'}, ' (' + b.gpu + (b.device ? ', ' + b.device : '') + ')') : null);
  const good = list.filter(b => codecsOf(b).length), bad = list.filter(b => !codecsOf(b).length);
  const rows = good.map(b => h('div', {class: 'hw'}, h('div', {}, name(b),
    h('span', {class: 'small muted'}, codecsOf(b).map(c => CODEC_LABEL[c] + (b.tenBit && b.tenBit[c] ? ' 10 Bit' : '')).join(' · ') + (b.variant && b.variant !== 'automatisch' ? ' · gestartet: ' + b.variant : ''))),
    h('span', {class: 'chip ok'}, 'nutzbar')));
  if (bad.length) rows.push(h('details', {class: 'hwoff'}, h('summary', {}, 'Nicht nutzbar (' + bad.length + ')'),
    bad.map(b => h('div', {class: 'hw off'}, h('div', {}, name(b),
      h('details', {class: 'why'}, h('summary', {}, 'Warum?'), h('p', {class: 'small muted'}, b.detail || (b.compiled === false ? 'Dieses ffmpeg wurde ohne diesen Encoder gebaut.' : 'Der Test-Encode hat nicht funktioniert.')))),
      h('span', {class: 'chip'}, 'nicht nutzbar')))));
  return rows;
}
function hwFoot(h2) {
  return (h2.gpus && h2.gpus.length ? 'Erkannte Grafik-/Videoeinheiten: ' + h2.gpus.join(', ') : 'Keine Grafik-/Videoeinheit gemeldet.') +
    (h2.done ? ` · Test: ${(h2.tookMs / 1000).toFixed(1)} s` : '');
}
function renderHwCard() {
  const hw = hwResult(), box = $('#hwList');
  const sum = $('#hwSum');
  if (!hw.backends.length) { box.innerHTML = '<span class="muted">Erkennung läuft …</span>'; if (sum) sum.textContent = 'Erkennung läuft …'; return; }
  if (sum) sum.textContent = hw.backends.filter(b => ['h264', 'hevc', 'av1', 'vp9'].some(c => b.codecs && b.codecs[c])).map(b => b.label.replace(/ \(.*\)$/, '')).join(', ') || 'keine nutzbar';
  fill(box, hwRows(hw));
  fill($('#hwGpus'), hwFoot(hw) + ' · ', h('a', {href: '#settings/hardware'}, 'Diagnose'));
}

// ---------- files ----------
function renderFileList() {
  const list = S.files[S.world];
  const el = $('#fileList');
  if (!list.length) el.innerHTML = `<div class="empty">Noch keine Dateien.<br>„+ Dateien“ oder „+ Ordner“ wählen.</div>`;
  else el.innerHTML = list.map((f, i) => `<div class="file"><span class="n" title="${esc(f.path)}">${esc(f.rel || f.path)}</span>
    <span class="muted small">${fmtSize(f.size)}</span>
    ${S.world === 'video' && trkCount(f) ? `<button class="small ghost" data-tr="${i}" title="Für diese Datei sind einzelne Spuren geändert. Klicken zum Ansehen.">${trkCount(f)} ${trkCount(f) === 1 ? 'Spur' : 'Spuren'} geändert</button>` : ''}
    <button class="small ghost rm" data-rm="${i}">✕</button></div>`).join('');
  $$('#fileList [data-rm]').forEach(b => b.onclick = () => { list.splice(+b.dataset.rm, 1); renderFiles(); });
  $$('#fileList [data-tr]').forEach(b => b.onclick = () => openSheet('tracks'));
}
function renderFiles() {
  renderFileList(); renderStartInfo(); refreshNamePreview();
  if (typeof cvRender === 'function') cvRender();
}
function addScanned(files) {
  const list = S.files[S.world];
  const have = new Set(list.map(f => f.path));
  files.forEach(f => { if (!have.has(f.path)) list.push({path: f.path, rel: f.rel, size: f.size, tracks: {}}); });
  renderFiles();
}

// ---------- server file browser ----------
// Suche: ab 2 Zeichen sucht das Feld immer auch in allen Unterordnern (Server, /api/fs/search); bei einem Zeichen filtert es nur die Einträge des Ordners.
// Umlaute dürfen so oder so getippt werden (muller / mueller finden Müller). Wurzelordner zeigen ihren Anzeigenamen aus den Einstellungen.
let B = {path: '', sel: new Set(), mode: 'files', resolve: null, entries: [], roots: false, q: '', found: null, seq: 0};
const bJoin = (p, n) => p.replace(/[\\/]$/, '') + (p.includes('\\') ? '\\' : '/') + n;
const fU = t => String(t).toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');
const fE = t => String(t).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const bMatch = (name, q) => fU(name).includes(fU(q)) || fE(name).includes(fE(q));
const rootNameOf = path => (cfg().rootNames || {})[path] || '';
// Pfad mit dem Anzeigenamen der Wurzel: „/video1/Filme/x“ → „Filme 4K/Filme/x“ (die längste passende Wurzel gewinnt)
function pathLabel(p) {
  const names = cfg().rootNames || {};
  const root = Object.keys(names).filter(r => { const t = r.replace(/[\\/]$/, ''); return p === r || p === t || p.startsWith(t + '/') || p.startsWith(t + '\\'); }).sort((x, y) => y.length - x.length)[0];
  return root ? names[root] + p.slice(root.replace(/[\\/]$/, '').length) : p;
}
function renderBrowser() {
  const q = B.q.trim();
  let rows;
  if (B.found) rows = B.found.map(x => ({name: x.name, full: x.path, dir: x.dir, size: x.size, media: x.media}));
  else {
    rows = B.entries.map(e => ({name: B.roots ? (rootNameOf(e.name) || e.name) : e.name, sub: B.roots && rootNameOf(e.name) ? e.name : '', full: B.roots ? e.name : bJoin(B.path, e.name), dir: e.dir, size: e.size, media: e.media}));
    if (q) rows = rows.filter(r => bMatch(r.name + ' ' + (r.sub || ''), q));
  }
  $('#bList').innerHTML = rows.map((r, i) => `<div class="bi" data-i="${i}">
    ${r.dir ? ic('folder') : (B.mode === 'files' ? `<input type="checkbox" data-c="${i}" ${B.sel.has(r.full) ? 'checked' : ''}>` : '')}
    <span>${esc(r.name)}${r.sub ? ` <small class="muted">${esc(r.sub)}</small>` : ''}</span><span class="sz">${r.dir ? '' : (r.media === 'video' ? ic('play') + ' ' : '♪ ') + fmtSize(r.size)}</span></div>`).join('')
    || `<div class="empty">${q ? 'Nichts gefunden' : 'Leer'}</div>`;
  $$('#bList .bi').forEach(row => {
    const r = rows[+row.dataset.i];
    row.onclick = ev => {
      if (r.dir) { B.q = ''; B.found = null; $('#bSearch').value = ''; browseTo(r.full); return; }
      if (B.mode !== 'files') return;
      const cb = row.querySelector('input');
      if (ev.target !== cb) cb.checked = !cb.checked;
      cb.checked ? B.sel.add(r.full) : B.sel.delete(r.full);
      $('#bCount').textContent = B.sel.size + ' ausgewählt';
    };
  });
  if (!B.found) $('#bInfo').textContent = q ? rows.length + ' von ' + B.entries.length : '';
}
let bTimer = 0;
function bSearchUpdate() {
  B.q = $('#bSearch').value; clearTimeout(bTimer);
  const q = B.q.trim();
  if (q.length < 2) { B.found = null; $('#bInfo').textContent = ''; renderBrowser(); return; }
  const my = ++B.seq; $('#bInfo').textContent = 'Suche …';
  bTimer = setTimeout(async () => {
    try {
      const r = await api('/api/fs/search?path=' + encodeURIComponent(B.path) + '&q=' + encodeURIComponent(q) + (B.mode === 'dir' ? '&dirs=1' : ''));
      if (my !== B.seq) return;
      B.found = r.hits; renderBrowser();
      $('#bInfo').textContent = r.hits.length + (r.hits.length === 1 ? ' Treffer' : ' Treffer') + (r.truncated ? ' (nur die ersten, bitte genauer suchen)' : '');
    } catch (e) { if (my === B.seq) { B.found = null; $('#bInfo').textContent = e.message; renderBrowser(); } }
  }, 300);
}
async function browseTo(path) {
  try {
    const d = await api('/api/fs?path=' + encodeURIComponent(path));
    B.path = d.path; B.parent = d.parent; B.sel.clear(); B.entries = d.entries; B.roots = !!d.roots; B.found = null; B.q = ''; B.seq++;
    $('#bSearch').value = ''; $('#bPath').value = d.path;
    const where = d.path ? pathLabel(d.path) : '';
    $('#bWhere').textContent = where && where !== d.path ? 'Angezeigt als: ' + where : '';
    $('#bUp').disabled = !!d.roots || (!d.parent && !((S.info && S.info.roots) || []).length); // in einem Wurzelordner führt „hoch“ zur Liste aller Wurzelordner
    $('#bDrives').innerHTML = (d.drives || []).map(x => `<button type="button" class="small" data-d="${esc(x)}">${esc(x)}</button>`).join(' ');
    $$('#bDrives [data-d]').forEach(b => b.onclick = () => browseTo(b.dataset.d));
    renderBrowser();
    $('#bCount').textContent = '';
  } catch (e) { $('#bList').innerHTML = `<div class="empty warn">${esc(e.message)}</div>`; }
}
function openBrowser(mode, start) {
  B.mode = mode;
  $('#bAddSel').classList.toggle('hidden', mode !== 'files');
  $('#bAll').parentElement.classList.toggle('hidden', mode !== 'files');
  $('#bAddDir').textContent = mode === 'dir' ? 'Diesen Ordner wählen' : 'Diesen Ordner (rekursiv)';
  $('#browser').showModal();
  browseTo(start || '');
  return new Promise(res => B.resolve = res);
}
function closeBrowser(v) { $('#browser').close(); if (B.resolve) B.resolve(v); B.resolve = null; }

// Dateien aus dem Browser holen (start = Ordner, in dem er aufgeht, z. B. ein Quellordner)
async function pickFrom(start) {
  const r = await openBrowser('files', start); if (!r) return;
  if (r.dir) S.lastDir = r.dir;
  const d = await api('/api/scan', {paths: r.paths, kind: S.world}); addScanned(d.files);
}

// ---------- Toasts ----------
function toast(msg, kind) {
  const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}
function renderStartInfo() {
  const n = S.files[S.world].length;
  $('#startInfo').textContent = n ? `${n} ${n === 1 ? 'Datei' : 'Dateien'} · ${W(S.world).name}` : 'Noch keine Dateien';
}

// ---------- start job ----------
function langs(s) { return s.split(',').map(x => x.trim()).filter(Boolean); }
async function start() {
  const kind = S.world, files = S.files[kind];
  if (!files.length) { toast('Bitte zuerst Dateien hinzufügen.', 'bad'); return; }
  if (kind === 'video') await trkProbeAll(files); // höchstens 6 Dateien gleichzeitig lesen (nicht alle auf einmal)
  const req = {
    kind,
    items: await Promise.all(files.map(async f => ({path: f.path, rel: f.rel, overrides: kind === 'video' ? await trackOverridesFor(f) : {}}))),
    output: {
      dir: $('#outMode').value === 'custom' ? $('#outDir').value.trim() : '', structure: $('#outStruct').value,
      suffix: $('#suffix').value, pattern: $('#pattern').value.trim(), replace: cleanRules(nameRules()), exists: $('#exists').value,
      ...vfCollect(),
    },
  };
  if ($('#outMode').value === 'custom' && !req.output.dir) { toast('Bitte einen Zielordner angeben.', 'bad'); return; }
  const unchecked = typeof cvUnreviewed === 'function' ? cvUnreviewed() : 0;
  if (unchecked && !confirm(unchecked === 1 ? 'Eine Gruppe von Dateien wurde noch nicht kontrolliert. Trotzdem starten?' : unchecked + ' Gruppen von Dateien wurden noch nicht kontrolliert. Trotzdem starten?')) return;
  if (req.output.deleteSource && !confirm('Quelldateien werden nach erfolgreicher Konvertierung GELÖSCHT. Fortfahren?')) return;
  if (kind === 'audio') {
    const f = $('#aFormat').value, vbr = ($('#aMode').value === 'vbr') && (f === 'mp3' || f === 'ogg');
    req.audio = {format: f, mode: vbr ? 'vbr' : 'cbr', quality: +$('#aQuality').value, bitrate: +$('#aBitrate').value, flacLevel: +$('#aFlac').value,
      wavBits: +$('#aWav').value, sampleRate: +$('#aRate').value, channels: +$('#aCh').value, keepCover: $('#aCover').checked};
  } else {
    const r = resolveBackend();
    req.video = {container: $('#vContainer').value, codec: $('#vCodec').value, backend: r.id === 'copy' ? 'cpu' : r.id, crf: +$('#vCrf').value,
      preset: $('#vPreset').value, bitDepth: +$('#vDepth').value, height: +$('#vHeight').value, hwDecode: $('#vHwDec').checked,
      av1Aom: S.info && !S.info.encoders.libsvtav1 && S.info.encoders['libaom-av1'],
      audioMode: $('#vAudioMode').value, audioCodec: $('#vAudioCodec').value, audioKbps: +$('#vAudioKbps').value, audioLangs: [],
      subMode: $('#vSubMode').value, subLangs: []};
  }
  try {
    const r = await api('/api/jobs', req);
    toast(r.ids.length + (r.ids.length === 1 ? ' Auftrag eingereiht.' : ' Aufträge eingereiht.'), 'ok');
    files.length = 0; if (kind === 'video') S.vstep = 1;
    renderFiles(); saveSettings(); poll(); renderStartTiles(); showStep('start');
  } catch (e) { toast(e.message, 'bad'); }
}

// ---------- queue / monitor ----------
const openDetails = new Set();
function statusChip(j) {
  if (j.status === 'running' && j.phase === 'check') return '<span class="chip acc" title="Die neue Datei ist fertig und wird jetzt geprüft.">prüfe Ergebnis …</span>';
  if (j.status === 'queued' && j.held) return '<span class="chip warn" title="Dieser Auftrag ist angehalten und startet erst, wenn du ihn freigibst.">angehalten</span>';
  if (j.status === 'queued' && S.paused) return '<span class="chip warn" title="Die Warteschlange ist pausiert.">pausiert</span>';
  const m = {queued: ['wartet', ''], running: ['läuft', 'acc'], done: ['fertig', 'ok'], error: ['Fehler', 'err'], canceled: ['abgebrochen', 'warn'], skipped: ['übersprungen', 'warn']}[j.status];
  return `<span class="chip ${m[1]}">${m[0]}</span>`;
}
const BACKEND_NAMES = {qsv: 'Intel Quick Sync', nvenc: 'NVIDIA NVENC', vaapi: 'VAAPI', amf: 'AMD AMF', cpu: 'CPU'};
const BACKEND_FULL = BACKEND_NAMES;
// „Schreiben“ = Encoder, „Lesen“ = Decoder: zwei getrennte Angaben mit gleicher Logik –
// grün + Haken = ffmpeg hat es bestätigt, gelb = nicht bestätigt bzw. Ausweichweg, grau = so eingestellt/noch offen
function encoderBadge(j) {
  if (j.kind !== 'video' || !j.encoder) return '';
  if (j.encoder === 'copy') return '<span class="chip">Video kopiert</span>';
  const hw = j.backend && j.backend !== 'cpu';
  const who = hw ? BACKEND_NAMES[j.backend] || j.backend : 'CPU';
  let cls = '', mark = '', title = hw ? 'Der Encoder läuft in der Hardware.' : 'Der Encoder läuft in Software auf der CPU (so eingestellt).';
  if (hw && j.encoderConfirmed) { cls = 'ok'; mark = ' ✓'; title += ' ffmpeg hat die Nutzung bestätigt (✓).'; }
  else if (hw && j.status === 'done') { cls = 'warn'; title += ' ffmpeg hat die Nutzung nicht ausdrücklich bestätigt.'; }
  else if (hw && j.status === 'running') mark = ' (warte auf ffmpeg …)';
  return `<span class="chip ${cls}" title="${esc(title)}">${hw ? ic('bolt') : ''}Schreiben: ${esc(who)} · ${esc(j.encoder)}${mark}</span>`;
}
function decoderBadge(j) {
  if (j.kind !== 'video' || !j.decoder || j.encoder === 'copy') return '';
  if (j.decoder === 'hardware') {
    const who = BACKEND_NAMES[j.backend] || 'Hardware';
    if (j.decoderConfirmed) return `<span class="chip ok" title="Die Quelldatei wird in der Hardware gelesen. ffmpeg hat den Hardware-Decoder bestätigt (${esc(j.decoderName)}).">${ic('bolt')}Lesen: ${esc(who)} ✓</span>`;
    const unsure = j.backend === 'qsv' && j.status === 'done';
    return `<span class="chip ${unsure ? 'warn' : ''}" title="Die Quelldatei wird in der Hardware gelesen. ffmpeg meldet den Decoder bei ${esc(who)} nicht ausdrücklich, deshalb ohne Haken.">${ic('bolt')}Lesen: ${esc(who)}</span>`;
  }
  return `<span class="chip ${j.hwDecodeFallback ? 'warn' : ''}" title="Die Quelldatei wird auf der CPU gelesen${j.hwDecodeFallback ? ' (Hardware ging bei dieser Datei nicht)' : ' (so eingestellt)'}. Das Ergebnis ist gleich gut, nur die CPU hat mehr zu tun.">Lesen: CPU</span>`;
}
// Warteschlange pausieren/fortsetzen: Knopf und Hinweis im Verlauf
function renderPauseUI() {
  const b = $('#pauseQueue'); if (!b) return;
  b.textContent = S.paused ? 'Fortsetzen' : 'Pausieren'; b.classList.toggle('on', !!S.paused);
  b.title = S.paused ? 'Die Warteschlange fortsetzen' : 'Die Warteschlange pausieren: laufende Aufträge werden fertig, es startet kein neuer';
  $('#queuePaused').classList.toggle('hidden', !S.paused);
}
// unterbrochene Aufträge aus dem letzten Lauf (Neustart des Containers): einmal fragen
function restoreAsk() {
  const n = (S.restorable && S.restorable.count) || 0;
  if (!n || S.restoreShown || $('#restoreDlg').open) return;
  S.restoreShown = true;
  $('#restoreText').textContent = n + (n === 1 ? ' Auftrag wurde' : ' Aufträge wurden') + ' beim letzten Beenden unterbrochen (' + (S.restorable.video ? S.restorable.video + ' Video' : '') + (S.restorable.video && S.restorable.audio ? ', ' : '') + (S.restorable.audio ? S.restorable.audio + ' Audio' : '') + '). Fortsetzen? Unfertige Zieldateien sind schon gelöscht, die Quelldateien sind unberührt.';
  $('#restoreDlg').showModal();
}
// Abzeichen „Video“ / „Audio“ (Audio in Orange) in Warteschlange und Verlauf
const kindBadge = k => `<span class="kindbadge ${k}">${esc(W(k).name)}</span>`;
// Warteschlange und Verlauf werden regelmäßig neu gezeichnet. Damit sich dabei weder der Scrollstand noch geöffnete Details ändern:
// (1) unveränderte Teile bleiben als DOM-Knoten stehen (syncChildren / reconcileCards), (2) keepView rückt die Seite nach dem Zeichnen so zurecht,
// dass das erste sichtbare Element an derselben Stelle bleibt (der Scroll-Anker der Browser ist dafür nicht verlässlich, Safari hat keinen).
function keepView(fn) {
  let anchor = null, top = 0;
  if (window.scrollY > 0) {
    for (const el of document.querySelectorAll('#queue .job, .histentry')) { const r = el.getBoundingClientRect(); if (r.bottom > 24) { anchor = el; top = r.top; break; } }
  }
  fn();
  if (anchor && anchor.isConnected) { const d = anchor.getBoundingClientRect().top - top; if (Math.abs(d) > 0.5) window.scrollBy(0, d); }
}
// Kinder von parent in die Reihenfolge von els bringen, ohne bereits richtig stehende Knoten anzufassen (sonst gingen Scrollstand und Auswahl darin verloren)
function syncChildren(parent, els) {
  els.forEach((el, i) => { if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] || null); });
  while (parent.children.length > els.length) parent.lastElementChild.remove();
}
// Karten der Warteschlange: je Auftrag ein fester Knoten mit zwei Teilen: .jvol (Kopf, Balken, Zahlen: ändert sich laufend) und .jdet (Details: nur bei neuem Log)
function reconcileCards(box, cards) {
  if (!box._cards) { box.textContent = ''; box._cards = new Map(); }
  const cache = box._cards, seen = new Set(); let prev = null;
  for (const c of cards) {
    seen.add(c.id);
    let e = cache.get(c.id);
    if (!e) { const el = document.createElement('div'); el.innerHTML = '<div class="jvol"></div><div class="jdet"></div>'; e = {el, cls: null, vol: null, det: null}; cache.set(c.id, e); }
    if (e.cls !== c.cls) { e.el.className = c.cls; e.cls = c.cls; }
    if (e.vol !== c.vol) { e.el.firstElementChild.innerHTML = c.vol; e.vol = c.vol; }
    if (e.det !== c.det) {
      const d = e.el.lastElementChild, pos = [...d.querySelectorAll('pre')].map(x => x.scrollTop);
      d.innerHTML = c.det; d.querySelectorAll('pre').forEach((x, i) => { if (pos[i]) x.scrollTop = pos[i]; }); e.det = c.det;
    }
    const ref = prev ? prev.nextElementSibling : box.firstElementChild;
    if (e.el !== ref) box.insertBefore(e.el, ref);
    prev = e.el;
  }
  for (const [id, e] of cache) if (!seen.has(id)) { e.el.remove(); cache.delete(id); }
}
function renderQueue() { keepView(renderQueueNow); }
function renderQueueNow() {
  renderPauseUI();
  // die Warteschlange zeigt nur laufende und wartende Aufträge; beendete stehen darunter im Verlauf
  const q = $('#queue'), mine = S.jobs.filter(j => j.status === 'queued' || j.status === 'running');
  if (!mine.length) { q._cards = null; q.innerHTML = '<div class="empty" style="margin-top:8px">Keine laufenden oder wartenden Aufträge. Beendete Aufträge stehen unten im Verlauf.</div>'; return; }
  reconcileCards(q, mine.map(j => { // in der Reihenfolge, in der sie dran kommen (oben: läuft bzw. als Nächstes)
    const meta = [];
    if (j.status === 'running') {
      if (j.speed) meta.push('Speed ' + esc(j.speed));
      if (j.fps) meta.push(j.fps.toFixed(0) + ' fps');
      if (j.eta) meta.push('noch ' + fmtTime(j.eta));
    }
    if (j.status === 'done' && j.sizeOut) meta.push(`${fmtSize(j.sizeIn)} → ${fmtSize(j.sizeOut)} (${Math.round(j.sizeOut / j.sizeIn * 100)} %)`);
    if (j.status === 'done') meta.push('Dauer ' + fmtTime((new Date(j.ended) - new Date(j.started)) / 1000));
    if (j.hwDecodeFallback && j.status !== 'error') meta.push('<span class="muted">Lesen per Hardware ging bei dieser Datei nicht – die CPU liest, geschrieben wird trotzdem in Hardware</span>');
    if (j.status === 'done' && (j.checks || []).length && !j.checkFailed) meta.push('<span class="okc" title="' + esc(j.checks.map(c => c.note).join(' · ')) + '">✓ geprüft: ' + esc(j.checks.map(c => c.note.replace(/ \(.*$/, '')).join(' · ')) + '</span>');
    (j.warnings || []).forEach(w => meta.push('<span class="warn">' + esc(w) + '</span>'));
    const mv = j.status === 'queued' ? `<span class="qmove"><button class="small ghost" data-mv="${j.id}" data-how="top" title="An den Anfang der Warteschlange" aria-label="An den Anfang">Zuerst</button><button class="small ghost" data-mv="${j.id}" data-how="up" title="Eine Stelle nach vorn" aria-label="Nach vorn">${ic('up')}</button><button class="small ghost" data-mv="${j.id}" data-how="down" title="Eine Stelle nach hinten" aria-label="Nach hinten"><span class="flip">${ic('up')}</span></button><button class="small ghost" data-hold="${j.id}" data-on="${j.held ? 0 : 1}" title="${j.held ? 'Wieder zur Warteschlange freigeben' : 'Diesen Auftrag anhalten: er startet erst, wenn du ihn freigibst'}">${j.held ? 'Freigeben' : 'Anhalten'}</button></span>` : '';
    const act = mv + ((j.status === 'queued' || j.status === 'running') ? `<button class="small ghost" data-cancel="${j.id}" title="Bricht diesen Auftrag ab und löscht die unfertige Datei. Die Quelldatei bleibt unberührt.">Abbrechen</button>` : '');
    const note = j.status === 'done' && (j.hwDecodeFallback || (j.warnings || []).length);
    return {id: j.id, cls: `job ${j.status}${note ? ' note' : ''}`, vol: `<div class="job-h">${kindBadge(j.kind)}<span class="n" title="${esc(j.input)}">${esc(j.name)}</span>${encoderBadge(j)}${decoderBadge(j)}${statusChip(j)}${act}</div>
      <div class="bar"><i style="width:${j.progress.toFixed(1)}%"></i></div>
      <div class="job-m"><span>${j.progress.toFixed(1)} %</span>${meta.map(m => `<span>${m}</span>`).join('')}</div>
      ${j.error && j.status === 'error' ? `<div class="small" style="color:var(--bad)">${esc(j.error)}</div>` : ''}
`, det: `<details data-id="${j.id}" ${openDetails.has(j.id) ? 'open' : ''}><summary>Details</summary>
        <div class="small muted">Ziel: ${esc(j.output || '–')}</div>
        ${(j.attempts || []).length ? `<div class="small muted">Frühere Versuche:<br>${j.attempts.map(a => esc(a)).join('<br>')}</div>` : ''}
        ${(j.mapLines || []).length ? `<pre>${esc(j.mapLines.join('\n'))}</pre>` : ''}
        <div class="copyrow"><button type="button" class="small ghost" data-copy="cmd" data-id="${j.id}">Befehl kopieren</button><button type="button" class="small ghost" data-copy="log" data-id="${j.id}">Log kopieren</button></div>
        <pre>${esc(j.cmd || '')}</pre><pre>${esc((j.log || []).slice(-25).join('\n'))}</pre></details>`};
  }));
  $$('#queue [data-cancel]').forEach(b => b.onclick = () => api('/api/jobs/' + b.dataset.cancel + '/cancel', {}).then(poll));
  $$('#queue [data-mv]').forEach(b => b.onclick = () => api('/api/jobs/' + b.dataset.mv + '/move', {how: b.dataset.how}).then(poll).catch(e => toast(e.message, 'bad')));
  $$('#queue [data-hold]').forEach(b => b.onclick = () => api('/api/jobs/' + b.dataset.hold + '/hold', {on: b.dataset.on === '1'}).then(poll));
  $$('#queue [data-copy]').forEach(b => b.onclick = () => { const j = S.jobs.find(x => x.id === b.dataset.id); if (j) copyText(b.dataset.copy === 'cmd' ? (j.cmd || '') : (j.log || []).join('\n')); });
  $$('#queue details').forEach(d => d.ontoggle = () => d.open ? openDetails.add(d.dataset.id) : openDetails.delete(d.dataset.id));
}
// Auslastungsanzeige: die Elemente bleiben bestehen und werden nur aktualisiert, damit die Balken sichtbar gleiten
function meter(key, title, val, sub) {
  const v = val < 0 ? null : Math.max(0, Math.min(100, val));
  let el = document.querySelector(`#monitor [data-m="${key}"]`);
  if (!el) {
    el = document.createElement('div'); el.className = 'meter'; el.dataset.m = key;
    el.innerHTML = '<div class="t"><b></b><span></span></div><div class="bar"><i></i></div><div class="sub"></div>';
    $('#monitor').appendChild(el);
  }
  el.querySelector('b').textContent = title;
  el.querySelector('.t span').textContent = v === null ? 'keine Messung' : v.toFixed(0) + ' %';
  el.querySelector('.bar i').style.width = (v || 0) + '%';
  el.querySelector('.sub').textContent = sub || '';
  return key;
}
// Intel meldet nur „Grafik nicht im Ruhezustand“ (gesamte Grafik, kein Video-Wert): deshalb ein Status statt einer Prozentzahl.
// Hysterese: erst ab 5 % „aktiv“, danach mindestens 4 s lang, damit die Anzeige nicht flackert.
function intelStatus(key, g, fresh) {
  const now = Date.now(), M = S.intel = S.intel || {};
  if (fresh && g.util >= 5) M.last = now;
  const active = !!M.last && now - M.last < 4000;
  const qsv = backendCaps('qsv'), nm = 'Intel Quick Sync' + (qsv && qsv.gpu ? ' (' + qsv.gpu.replace(/^Intel\(R\)\s*/i, '').replace(/\s*Graphics.*$/i, '') + ')' : '');
  let el = document.querySelector(`#monitor [data-m="${key}"]`);
  if (!el) {
    el = document.createElement('div'); el.className = 'meter status'; el.dataset.m = key;
    el.innerHTML = '<div class="t"><b></b><span class="chip"></span></div><div class="sub"></div>';
    $('#monitor').appendChild(el);
  }
  el.querySelector('b').textContent = nm;
  const chip = el.querySelector('.chip');
  chip.textContent = !fresh ? 'keine Messung' : active ? 'aktiv' : 'Leerlauf';
  chip.className = 'chip ' + (!fresh ? '' : active ? 'acc' : 'ok');
  el.querySelector('.sub').textContent = !fresh ? 'Keine aktuelle Messung' : active ? 'Die Video-Einheit der Intel-CPU arbeitet gerade (gemessen: Grafik nicht im Ruhezustand).' : 'Die Intel-Grafik ruht. Beim Konvertieren mit Quick Sync springt sie auf „aktiv“.';
  return key;
}
function renderMonitor() {
  const st = S.stats, running = S.jobs.some(j => j.status === 'running'), box = $('#monitor');
  if (!st) { box.replaceChildren(); return; }
  const fresh = st.at && Date.now() - st.at < 15000;
  const keep = [];
  keep.push(meter('cpu', 'CPU', fresh ? st.cpu : -1, !fresh ? 'Keine aktuelle Messung' : running ? 'Bei Hardware-Encoding sollte die CPU niedrig bleiben' : 'Gerade nichts los – Live-Wert des ganzen Rechners'));
  (st.gpus || []).forEach((g, i) => {
    if (g.kind === 'intel') { keep.push(intelStatus('gpu' + i, g, fresh)); return; }
    const enc = g.encode >= 0;
    keep.push(meter('gpu' + i, g.name + ' – ' + (enc ? 'Video-Encode' : 'Grafik aktiv'), fresh ? (enc ? g.encode : g.util) : -1,
      g.source + (g.decode >= 0 ? ` · Decode ${g.decode.toFixed(0)} %` : '') + (enc ? ` · Gesamt ${g.util.toFixed(0)} %` : '')));
  });
  if (!(st.gpus || []).length) {
    keep.push(meter('nogpu', 'Videoeinheit', -1, 'Keine Auslastung lesbar (Docker: /dev/dri bzw. NVIDIA-Runtime durchreichen)'));
  }
  [...box.children].forEach(c => { if (!keep.includes(c.dataset.m)) c.remove(); });
}
// Aufträge, die zum aktuellen Durchlauf gehören: alle, deren Zeitraum (angelegt → beendet) sich mit den noch aktiven überlappt.
// So zählt „Datei 4 von 13“ nur den laufenden Durchlauf, auch nach dem Neuladen der Seite (die Zeiten kommen vom Server).
function currentBatch() {
  const mine = S.jobs.slice().sort((a, b) => new Date(a.created) - new Date(b.created));
  const now = Date.now(), end = j => (j.status === 'queued' || j.status === 'running') ? now : new Date(j.ended).getTime() || now;
  let comps = [], cur = null;
  mine.forEach(j => {
    const s = new Date(j.created).getTime(), e = end(j);
    if (cur && s <= cur.end + 1500) { cur.jobs.push(j); cur.end = Math.max(cur.end, e); } else { cur = {jobs: [j], end: e}; comps.push(cur); }
  });
  const active = comps.find(c => c.jobs.some(j => j.status === 'queued' || j.status === 'running'));
  return active ? active.jobs : [];
}
// Kopfbereich der Startseite: der aktuelle Auftrag („Datei 4 von 13“, Fortschritt, Hardware mit Haken) oder „Gerade nichts los“
function renderHero() {
  const box = $('#jobNow'); if (!box) return;
  const batch = currentBatch(), total = batch.length;
  const running = batch.filter(j => j.status === 'running').sort((a, b) => new Date(a.started) - new Date(b.started));
  const cur = running[0] || batch.find(j => j.status === 'queued');
  if (!cur) {
    box.className = 'jobnow idle';
    box.innerHTML = (S.paused ? '<div class="jn-pause">Warteschlange pausiert</div>' : '') + '<div class="jn-title">Gerade nichts los</div><div class="muted small">Wähle oben Video oder Audio, um einen neuen Auftrag zu starten. Laufende Aufträge erscheinen hier; beendete stehen im Verlauf.</div>';
    return;
  }
  const finished = batch.filter(j => !(j.status === 'queued' || j.status === 'running')).length;
  const pos = Math.min(total, finished + 1);
  const overall = Math.round(batch.reduce((a, j) => a + (j.status === 'running' ? j.progress : j.status === 'queued' ? 0 : 100), 0) / total);
  const meta = [];
  if (cur.status === 'running') { if (cur.speed) meta.push('Speed ' + esc(cur.speed)); if (cur.fps) meta.push(cur.fps.toFixed(0) + ' fps'); if (cur.eta) meta.push('noch ' + fmtTime(cur.eta)); }
  box.className = 'jobnow';
  box.innerHTML = `${S.paused ? '<div class="jn-pause">Warteschlange pausiert: laufende Aufträge werden fertig, es startet kein neuer</div>' : ''}<div class="jn-title">Datei ${pos} von ${total}${running.length > 1 ? ` <span class="muted small">(${running.length} laufen parallel)</span>` : ''}</div>
    <div class="jn-name" title="${esc(cur.input)}">${esc(cur.name)}</div>
    <div class="bar"><i style="width:${cur.progress.toFixed(1)}%"></i></div>
    <div class="job-m"><span>${cur.progress.toFixed(1)} %</span>${meta.map(m => `<span>${m}</span>`).join('')}</div>
    <div class="jn-chips">${statusChip(cur)}${encoderBadge(cur)}${decoderBadge(cur)}</div>
    ${total > 1 ? `<div class="jn-all"><span class="muted small">Gesamt ${overall} %</span><div class="bar thin"><i style="width:${overall}%"></i></div></div>` : ''}`;
}
// Zähler am Verlauf-Knopf: laufende und wartende Aufträge (Video und Audio)
function renderHistBadge() {
  const n = S.jobs.filter(j => j.status === 'running' || j.status === 'queued').length;
  const el = $('#histBadge'); if (!el) return;
  el.textContent = n || ''; el.classList.toggle('hidden', !n);
  $('#startHistory').title = n ? `Verlauf und Warteschlange (${n} ${n === 1 ? 'Auftrag läuft oder wartet' : 'Aufträge laufen oder warten'})` : 'Verlauf und Warteschlange';
}
// „Parallel“ gilt je Art (Video und Audio haben je eine eigene Warteschlange)
function renderConc() {
  if (!S.conc) return;
  if (document.activeElement !== $('#concV')) $('#concV').value = S.conc.video;
  if (document.activeElement !== $('#concA')) $('#concA').value = S.conc.audio;
}
let polling = false;
async function poll() {
  if (polling || S.stopped) return;
  if (document.hidden && (S.hiddenTick = (S.hiddenTick || 0) + 1) % 5) return; // Reiter im Hintergrund: nur alle 5 Sekunden
  polling = true;
  try {
    const d = await api('/api/state');
    S.jobs = d.jobs; S.stats = d.stats; S.conc = d.concurrency; S.paused = !!d.paused; S.restorable = d.restorable || {count: 0};
    const savedChanged = JSON.stringify(S.saved) !== JSON.stringify(d.saved); S.saved = d.saved; if (savedChanged) renderSaved();
    renderConc();
    const fin = d.finished !== undefined ? d.finished : S.jobs.filter(j => !(j.status === 'queued' || j.status === 'running')).length;
    renderQueue(); renderMonitor(); renderHero(); renderHistBadge(); renderStartTiles(); restoreAsk(); rainOnDone(S.jobs); rainBarsSync();
    if (S.histFin !== undefined && fin !== S.histFin && typeof S.histReload === 'function') S.histReload(); // ein Auftrag ist beendet: Verlauf sofort neu laden
    S.histFin = fin;
  } catch (e) {} finally { polling = false; }
}

// ---------- info popovers ----------
function infoBtn(key) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'info'; b.textContent = 'i'; b.dataset.key = key;
  b.title = 'Erklärung'; b.setAttribute('aria-label', 'Erklärung anzeigen');
  return b;
}
function wrapLabels() {
  // jeder Label-Titel bekommt die Klasse .lt (für das "> "-Präfix); Text-Knoten werden dafür eingepackt
  $$('.panel label').forEach(lab => {
    if (lab.classList.contains('check') || lab.classList.contains('inline') || lab.querySelector(':scope > .lt')) return;
    const first = [...lab.childNodes].find(n => (n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && n.tagName === 'SPAN'));
    if (!first) return;
    if (first.nodeType === 3) {
      const wrap = document.createElement('span'); wrap.className = 'lt';
      lab.insertBefore(wrap, first); wrap.appendChild(first);
    } else first.classList.add('lt');
  });
}
function decorateInfo() {
  wrapLabels();
  Object.keys(INFO).forEach(key => {
    let target = null, after = null;
    const el = document.getElementById(key);
    if (el) {
      const lab = el.closest('label');
      if (!lab) return;
      // after first text node or span of the label
      after = [...lab.childNodes].find(n => (n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && n.tagName === 'SPAN'));
      target = lab;
    } else {
      const h = document.querySelector(`[data-info="${key}"]`);
      if (!h) return;
      h.appendChild(infoBtn(key)); return;
    }
    const b = infoBtn(key);
    const lt = target.querySelector(':scope > .lt');
    if (lt) lt.appendChild(b);
    else if (lab_isCheck(target) || target.classList.contains('inline')) { if (after && after.nextSibling) target.insertBefore(b, after.nextSibling); else target.appendChild(b); }
    else target.insertBefore(b, target.firstChild);
  });
}
const lab_isCheck = l => l.classList.contains('check');
let popFor = null;
function showInfo(btn) {
  const pop = $('#infoPop');
  if (popFor === btn) return hideInfo();
  hideInfo();
  const i = INFO[btn.dataset.key]; if (!i) return;
  pop.innerHTML = `<h4>${i.t}</h4>${i.b}`;
  pop.classList.remove('hidden');
  const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  let x = Math.min(Math.max(8, r.left - 10), window.innerWidth - w - 8);
  let y = Math.max(8, Math.min(r.bottom + 8, window.innerHeight - h - 8));
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  btn.classList.add('on'); popFor = btn; popY = scrollY;
  if (btn.closest('dialog')) btn.closest('dialog').appendChild(pop); else document.body.appendChild(pop);
}
function hideInfo() {
  const pop = $('#infoPop'); pop.classList.add('hidden');
  if (popFor) popFor.classList.remove('on'); popFor = null;
}
document.addEventListener('click', e => {
  const b = e.target.closest('button.info');
  if (b) { e.preventDefault(); e.stopPropagation(); showInfo(b); return; }
  if (!e.target.closest('#infoPop')) hideInfo();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideInfo(); });
let popY = 0;
window.addEventListener('scroll', () => { if (popFor && Math.abs(scrollY - popY) > 40) hideInfo(); }, true);

// ---------- init ----------
async function loadInfo() {
  S.info = normInfo(await api('/api/info'));
  // zuerst das, was nicht von der Hardware abhängt: Fußzeile und „Beenden“ (erscheint sofort)
  $('#ffver').textContent = S.info.ffmpeg.replace(/^ffmpeg version /, 'ffmpeg ').split(' Copyright')[0].split(' ').slice(0, 2).join(' ');
  $('#quit').classList.toggle('hidden', !S.info.canQuit);
  renderFooter();
  try { refreshVideoUI(); } catch (e) { reportError('Hardware-Anzeige: ' + (e && e.message)); }
  if (!S.info.hw.done) setTimeout(() => loadInfo().catch(() => {}), 1200);
}
// Fehler der Oberfläche ins Protokoll des Programms schreiben (damit sie auch ohne Entwicklerwerkzeuge sichtbar sind)
let reported = 0;
function reportError(msg) {
  if (reported++ > 5) return;
  try { fetch('/api/client-error', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({msg: String(msg).slice(0, 500)})}); } catch (e) {}
}
window.addEventListener('error', e => reportError((e.message || 'Fehler') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '')));
window.addEventListener('unhandledrejection', e => reportError('Promise: ' + (e.reason && e.reason.message || e.reason)));
function renderFooter() {
  const b = S.info.build, ff = S.info.ffmpeg.replace(/^ffmpeg version /, '').split(' Copyright')[0].split(' ')[0];
  const ver = b.tag ? `<a href="${esc(b.branchUrl)}" target="_blank" rel="noopener">v${esc(b.tag)}</a>` : `<a href="${esc(b.branchUrl)}" target="_blank" rel="noopener">${esc(b.branch)}</a>`;
  $('#foot').innerHTML = `<span><b>p5converter</b> ${esc(b.base)}</span><span>${ver}</span>` +
    (b.commit ? `<span><a href="${esc(b.commitUrl)}" target="_blank" rel="noopener">${esc(b.commitShort)}</a></span>` : '') +
    `<span>ffmpeg ${esc(ff)}</span><span>${esc(S.info.os)}</span><span><button class="lnk" id="footNews">Neuigkeiten</button></span><span><a href="${esc(b.repo)}" target="_blank" rel="noopener">GitHub</a></span>`;
  $('#footNews').onclick = openNews;
}
// Neuigkeiten wie bei p5assets: je Version einmal ein kurzer Hinweis mit den Überschriften; die ganze Liste steht in der Fußzeile.
// Was schon gezeigt wurde, merkt sich der Server (gilt für alle Geräte).
const markNewsSeen = (ids, version) => api('/api/news/seen', {ids: ids || [], version: !!version}).catch(() => {});
async function loadNews() {
  try {
    const r = await api('/api/news');
    if (r.show) openNewsNotice(r);
  } catch (e) { /* optional */ }
}
function openNewsNotice(r) {
  const dlg = $('#newsNotice');
  fill($('#nnTitle'), icon('news'), ' Neu in Version ' + r.version);
  fill($('#nnBody'), h('p', {class: 'muted'}, r.count + (r.count === 1 ? ' Neuerung' : ' Neuerungen') + ', zum Beispiel:'),
    h('ul', {class: 'newshl'}, r.highlights.map(t => h('li', {}, t))),
    h('p', {class: 'muted small'}, 'Alle Neuigkeiten findest du jederzeit unten in der Fußzeile unter „Neuigkeiten“.'));
  const done = () => { markNewsSeen([], true); dlg.close(); };
  $('#nnClose').onclick = done;
  $('#nnAll').onclick = () => { done(); openNews(); };
  dlg.showModal();
}
async function openNews() {
  let r;
  try { r = await api('/api/news'); } catch (e) { toast('Neuigkeiten konnten nicht geladen werden.', 'bad'); return; }
  const groups = {};
  r.all.forEach(n => (groups[n.version] = groups[n.version] || []).push(n));
  const vkey = v => v.split('.').reduce((a, x) => a * 1000 + (+x || 0), 0);
  $('#newsBody').innerHTML = Object.keys(groups).sort((a, b) => vkey(b) - vkey(a)).map(v => groups[v].map(n =>
    `<div class="newsitem"><div class="ver">Version ${esc(v)}</div><h4>${esc(n.title)}</h4><p>${esc(n.text)}</p></div>`).join('')).join('') || '<div class="empty">Keine Neuigkeiten.</div>';
  $('#newsVer').textContent = 'Aktuell: ' + S.info.build.version;
  $('#news').showModal();
  markNewsSeen(r.all.map(n => n.id), true);
}
function wire() {
  wireRename(); wireFlow();
  $('#gearBtn').onclick = () => { location.hash = '#settings'; };
  $('#logbtn').onclick = () => { location.hash = '#logs'; };
  $('#logoutBtn').onclick = logout;
  $('#savePreset').onclick = openPresetDialog;
  $('#presetCancel').onclick = () => $('#presetDlg').close();
  $('#presetForm').addEventListener('submit', e => { e.preventDefault(); savePresetFromDialog(); });
  window.addEventListener('hashchange', route);
  [...FIELDS, ...CHECKS].forEach(f => $('#' + f).addEventListener('input', () => { refreshAudioUI(); refreshVideoUI(); saveSettings(); refreshNamePreview(); if (typeof cvRender === 'function') cvRender(); }));
  $('#outMode').addEventListener('input', outModeUI);
  $('#addFiles').onclick = () => pickFrom(S.lastDir);
  $('#addFolder').onclick = async () => {
    const r = await openBrowser('dir', S.lastDir); if (!r) return;
    S.lastDir = r.dir;
    const d = await api('/api/scan', {paths: [r.dir], kind: S.world}); addScanned(d.files);
  };
  $('#clearFiles').onclick = () => { S.files[S.world].length = 0; renderFiles(); };
  $('#pickOut').onclick = async () => { const r = await openBrowser('dir', $('#outDir').value); if (r) { $('#outDir').value = r.dir; saveSettings(); } };
  $('#bUp').onclick = () => browseTo(B.parent || '');
  $('#bGo').onclick = () => browseTo($('#bPath').value);
  $('#bPath').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); browseTo($('#bPath').value); } };
  $('#bSearch').addEventListener('input', bSearchUpdate);
  $('#bSearch').onkeydown = e => { if (e.key === 'Enter') e.preventDefault(); };
  $('#bCancel').onclick = () => closeBrowser(null);
  $('#browser').addEventListener('cancel', () => { if (B.resolve) B.resolve(null); B.resolve = null; });
  const bAll = on => { $$('#bList input[type=checkbox]').forEach(cb => { if (cb.checked !== on) cb.closest('.bi').click(); }); };
  $('#bAll').onclick = () => bAll(true); $('#bNone').onclick = () => bAll(false);
  $('#bAddSel').onclick = () => closeBrowser({paths: [...B.sel], dir: B.path});
  $('#bAddDir').onclick = () => closeBrowser(B.mode === 'dir' ? {dir: B.path, paths: [B.path]} : {paths: [B.path], dir: B.path});
  $('#start').onclick = start;
  $('#quit').onclick = async () => {
    const running = S.jobs.filter(j => j.status === 'running' || j.status === 'queued').length;
    if (!confirm(running ? `Es laufen/warten noch ${running} Aufträge. Trotzdem beenden und abbrechen?` : 'p5converter beenden?')) return;
    try { await api('/api/quit', {}); } catch (e) {}
    document.body.innerHTML = '<div style="padding:60px;text-align:center;font:18px system-ui">p5converter wurde beendet.<br><br><small>Du kannst dieses Fenster schließen. Zum Neustart das Programm erneut öffnen.</small></div>';
    S.stopped = true;
  };
  $('#cancelAll').onclick = () => api('/api/jobs/cancel-all', {kind: ''}).then(poll);
  $('#histBack').onclick = () => { location.hash = ''; };
  $('#pauseQueue').onclick = () => api('/api/queue/pause', {on: !S.paused}).then(poll);
  $('#restoreYes').onclick = () => { $('#restoreDlg').close(); api('/api/queue/restore', {action: 'resume'}).then(r => { toast(r.resumed + (r.resumed === 1 ? ' Auftrag' : ' Aufträge') + ' fortgesetzt', 'ok'); poll(); }).catch(e => toast(e.message, 'bad')); };
  $('#restoreNo').onclick = () => { $('#restoreDlg').close(); api('/api/queue/restore', {action: 'discard'}).then(() => toast('Unterbrochene Aufträge verworfen', 'ok')).catch(e => toast(e.message, 'bad')); };
  $('#scanFolder').onclick = libPick;
  $('#concV').onchange = () => api('/api/concurrency', {kind: 'video', n: +$('#concV').value});
  $('#concA').onchange = () => api('/api/concurrency', {kind: 'audio', n: +$('#concA').value});
  wireVerify(); wireCrf(); wireConvert();
  $('#hwRedetect').onclick = async () => { await api('/api/hw/detect', {}); S.info.hw.done = false; S.info.hw.backends = []; renderHwCard(); setTimeout(loadInfo, 800); };
}
function outModeUI() {
  const c = $('#outMode').value === 'custom';
  $('#outDirRow').classList.toggle('hidden', !c);
  $('#structRow').classList.toggle('hidden', !c);
}
function applyDefaultsFromCfg() {
  const c = cfg();
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('p5c') || '{}'); } catch (e) {}
  if (saved.vQuality === undefined && saved.vCrf !== undefined) qSync(); // alter Stand ohne Stufe: Stufe aus der gespeicherten Zahl ableiten
  refreshVideoUI();
  if (saved.vHwDec === undefined) $('#vHwDec').checked = c.hwDecode !== false;
  if (c.defaultOutDir && saved.outDir === undefined) { $('#outDir').value = c.defaultOutDir; $('#outMode').value = 'custom'; }
  else if (!$('#outDir').value && S.info.roots && S.info.roots.length > 1) $('#outDir').value = S.info.roots[S.info.roots.length - 1];
}

async function startApp() {
  S.cfg = await api('/api/settings');
  captureDefaults(); loadSettings(); decorateInfo(); wire();
  await loadInfo();
  applyDefaultsFromCfg();
  if (S.world !== 'audio' && S.world !== 'video') S.world = 'video';
  outModeUI(); setWorld(S.world); renderPresetChips(); renderHero(); applySteps();
  if (cfg().showNews !== false) loadNews();
  if (!S.cfg.persistent) toast('Einstellungen werden nicht dauerhaft gespeichert (Pfad /config fehlt).', 'bad');
  poll(); S.pollTimer = setInterval(poll, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  checkAlerts(); S.alertTimer = setInterval(() => checkAlerts(), 30000);
  route();
}

// ---------- Ziehen zum Aktualisieren (nur als Web-App vom Home-Bildschirm) ----------
// Eine Web-App vom Home-Bildschirm hat in iOS kein Pull-to-Refresh: am oberen Rand nach unten ziehen lädt die Seite neu (wie bei p5assets).
(function pullToRefresh() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!standalone) return;
  const bar = document.createElement('div'); bar.id = 'ptr'; bar.textContent = '↓ Zum Aktualisieren ziehen';
  document.body.appendChild(bar);
  let y0 = null, dist = 0;
  const THRESHOLD = 90, GO = THRESHOLD / 2 + 10;
  const blocked = t => !!(t.closest && t.closest('dialog, textarea, input, select, .tablewrap, .blist, .cvpop, pre, details[open] > pre')) || document.querySelector('dialog[open]');
  addEventListener('touchstart', e => { y0 = (window.scrollY <= 0 && e.touches.length === 1 && !blocked(e.target)) ? e.touches[0].clientY : null; dist = 0; }, {passive: true});
  addEventListener('touchmove', e => {
    if (y0 == null) return;
    dist = e.touches[0].clientY - y0;
    if (dist <= 0 || window.scrollY > 0) { bar.style.transform = ''; return; }
    const d = Math.min(dist / 2, THRESHOLD + 20);
    bar.style.transform = `translateY(${d}px)`;
    bar.textContent = d >= GO ? '↑ Loslassen zum Aktualisieren' : '↓ Zum Aktualisieren ziehen';
  }, {passive: true});
  addEventListener('touchend', () => {
    if (y0 != null && dist / 2 >= GO) { bar.textContent = 'Lade neu …'; location.reload(); }
    bar.style.transform = ''; y0 = null; dist = 0;
  }, {passive: true});
})();

(async function boot() {
  await loadAuth();
  if (S.auth.enabled && !S.auth.authenticated) { showLogin(); return; }
  updateAuthUI();
  try { await startApp(); } catch (e) { if (e.status !== 401) { toast('Start fehlgeschlagen: ' + e.message, 'bad'); reportError('Start fehlgeschlagen: ' + e.message); } }
})();
