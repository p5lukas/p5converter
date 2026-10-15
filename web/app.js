'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api = async (url, body) => {
  const r = await fetch(url, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const fmtSize = n => n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? (n / 1e3).toFixed(0) + ' KB' : (n || 0) + ' B';
const fmtTime = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };

const S = {world: 'audio', files: {audio: [], video: []}, info: null, jobs: [], stats: null};
const BACKEND_ORDER = ['qsv', 'nvenc', 'amf', 'vaapi', 'cpu'];
const CODEC_LABEL = {h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9'};
const SWENC = {h264: 'libx264', hevc: 'libx265', av1: 'libsvtav1', vp9: 'libvpx-vp9'};

// ---------- persisted settings ----------
const FIELDS = ['outMode', 'outDir', 'outStruct', 'suffix', 'pattern', 'exists', 'aFormat', 'aMode', 'aQuality', 'aBitrate', 'aFlac', 'aWav', 'aRate', 'aCh',
  'vContainer', 'vCodec', 'vBackend', 'vCrf', 'vPreset', 'vDepth', 'vHeight', 'vAudioMode', 'vAudioCodec', 'vAudioKbps', 'vAudioLangs', 'vSubMode', 'vSubLangs'];
const CHECKS = ['deleteSource', 'aCover', 'vHwDec'];
function saveSettings() {
  const o = {};
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
    if (o.world) S.world = o.world;
  } catch (e) {}
}

// ---------- worlds ----------
function setWorld(w) {
  S.world = w;
  $$('#worlds button').forEach(b => b.classList.toggle('active', b.dataset.world === w));
  $('#audioSettings').classList.toggle('hidden', w !== 'audio');
  $('#videoSettings').classList.toggle('hidden', w !== 'video');
  $('#hwCard').classList.toggle('hidden', w !== 'video');
  $('#patternRow').classList.toggle('hidden', w !== 'audio');
  renderFiles();
  refreshAudioUI();
  refreshVideoUI();
  saveSettings();
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
function hwResult() { return (S.info && S.info.hw) || {backends: [], done: false}; }
function backendCaps(id) { return hwResult().backends.find(b => b.id === id); }
function workingBackends(codec) {
  return BACKEND_ORDER.filter(id => { const b = backendCaps(id); return b && b.codecs && b.codecs[codec]; });
}
function resolveBackend() {
  const codec = $('#vCodec').value, sel = $('#vBackend').value;
  if (codec === 'copy') return {id: 'copy'};
  if (sel !== 'auto') return {id: sel};
  const w = workingBackends(codec);
  return {id: w[0] || 'cpu', auto: true};
}
function refreshVideoUI() {
  const codec = $('#vCodec').value, copy = codec === 'copy';
  // backend options
  const cur = $('#vBackend').value || 'auto';
  const opts = ['<option value="auto">Automatisch (schnellste verfügbare)</option>'];
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
  ['#vBackendRow', '#vCrfRow', '#vPresetRow', '#vDepthRow', '#vHeightRow', '#vHwDecRow'].forEach(s => $(s).classList.toggle('hidden', copy));
  $('#vHwDecRow').classList.toggle('hidden', !hw);
  const container = $('#vContainer').value;
  const resolvedEl = $('#vResolved');
  if (copy) resolvedEl.innerHTML = '<span class="chip acc">Video wird kopiert</span>';
  else {
    const enc = encoderName(r.id, codec);
    resolvedEl.innerHTML = `<b>${esc(enc)}</b> ${r.id === 'cpu' ? '<span class="chip">CPU</span>' : '<span class="chip ok">Hardware</span>'}` +
      (!hwResult().done ? ' <span class="muted small">Hardware-Erkennung läuft …</span>' : '');
  }
  const crf = $('#vCrf');
  $('#vCrfOut').textContent = crf.value;
  $('#vCrfHint').textContent = r.id === 'cpu' || copy ? 'Niedriger = bessere Qualität / größere Datei. Typisch: x264 18–23, x265 20–26, AV1 24–32.'
    : 'Hardware-Qualitätswert (ICQ/CQ/QP) – nicht 1:1 mit CRF vergleichbar, ca. 20–28 üblich.';
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
  if (container === 'mp4' && !copy) { /* mp4 shows subtitles warning in job */ }
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
function renderHwCard() {
  const h = hwResult();
  if (!h.backends.length) { $('#hwList').innerHTML = '<span class="muted">Erkennung läuft …</span>'; return; }
  $('#hwList').innerHTML = h.backends.map(b => {
    const cs = ['h264', 'hevc', 'av1', 'vp9'].filter(c => b.codecs && b.codecs[c]);
    const ok = cs.length > 0;
    const gpu = b.gpu ? ` <span class="muted small">(${esc(b.gpu)}${b.device ? ', ' + esc(b.device) : ''})</span>` : '';
    return `<div class="hw"><div><b>${esc(b.label)}${gpu}</b>` +
      (ok ? `<span class="small muted">${cs.map(c => CODEC_LABEL[c] + (b.tenBit && b.tenBit[c] ? ' <span title="10 Bit">10b</span>' : '')).join(' · ')}</span>`
          : `<span class="small muted">${esc(b.detail || 'nicht verfügbar')}</span>`) +
      `</div><span class="chip ${ok ? 'ok' : 'err'}">${ok ? 'nutzbar' : 'nicht nutzbar'}</span></div>`;
  }).join('');
  $('#hwGpus').textContent = (h.gpus && h.gpus.length ? 'Erkannte GPUs: ' + h.gpus.join(', ') : 'Keine GPU gemeldet.') +
    (h.done ? ` · Test dauerte ${(h.tookMs / 1000).toFixed(1)} s (echte Test-Encodes)` : '');
}

const VPRESETS = [
  {n: 'Archiv · H.265 10 Bit', v: {vCodec: 'hevc', vCrf: 20, vDepth: '10', vPreset: 'slow', vHeight: '0'}},
  {n: 'Klein · H.265 1080p', v: {vCodec: 'hevc', vCrf: 24, vDepth: '8', vPreset: 'medium', vHeight: '1080'}},
  {n: 'Kompatibel · H.264 1080p', v: {vCodec: 'h264', vCrf: 21, vDepth: '8', vPreset: 'medium', vHeight: '1080'}},
  {n: 'AV1 · 10 Bit', v: {vCodec: 'av1', vCrf: 28, vDepth: '10', vPreset: 'medium', vHeight: '0'}},
  {n: 'Nur Remux → MKV', v: {vCodec: 'copy'}},
];
function renderPresets() {
  $('#vPresets').innerHTML = VPRESETS.map((p, i) => `<button data-i="${i}">${esc(p.n)}</button>`).join('');
  $$('#vPresets button').forEach(b => b.onclick = () => {
    Object.entries(VPRESETS[+b.dataset.i].v).forEach(([k, v]) => $('#' + k).value = v);
    refreshVideoUI(); saveSettings();
  });
}

// ---------- files ----------
function renderFiles() {
  const list = S.files[S.world];
  const el = $('#fileList');
  if (!list.length) el.innerHTML = `<div class="empty">Noch keine Dateien.<br>„+ Dateien“ oder „+ Ordner“ wählen.</div>`;
  else el.innerHTML = list.map((f, i) => `<div class="file"><span class="n" title="${esc(f.path)}">${esc(f.rel || f.path)}</span>
    <span class="muted small">${fmtSize(f.size)}</span>
    ${S.world === 'video' ? `<button class="small" data-tr="${i}">Spuren${f.drop.size || f.defaultAudio != null ? ' ●' : ''}</button><button type="button" class="info" data-key="tracksBtn" aria-label="Erklärung anzeigen">i</button>` : ''}
    <button class="small ghost rm" data-rm="${i}">✕</button></div>`).join('');
  $$('#fileList [data-rm]').forEach(b => b.onclick = () => { list.splice(+b.dataset.rm, 1); renderFiles(); });
  $$('#fileList [data-tr]').forEach(b => b.onclick = () => openTracks(list[+b.dataset.tr]));
  const tot = list.reduce((a, f) => a + (f.size || 0), 0);
  $('#fileSummary').textContent = list.length ? `${list.length} Datei(en), ${fmtSize(tot)}` : '';
}
function addScanned(files) {
  const list = S.files[S.world];
  const have = new Set(list.map(f => f.path));
  files.forEach(f => { if (!have.has(f.path)) list.push({path: f.path, rel: f.rel, size: f.size, drop: new Set(), defaultAudio: null}); });
  renderFiles();
}

// ---------- server file browser ----------
let B = {path: '', sel: new Set(), mode: 'files', resolve: null};
async function browseTo(path) {
  try {
    const d = await api('/api/fs?path=' + encodeURIComponent(path));
    B.path = d.path; B.parent = d.parent; B.sel.clear();
    $('#bPath').value = d.path;
    $('#bUp').disabled = !d.parent && !d.roots;
    $('#bDrives').innerHTML = (d.drives || []).map(x => `<button type="button" class="small" data-d="${esc(x)}">${esc(x)}</button>`).join(' ');
    $$('#bDrives [data-d]').forEach(b => b.onclick = () => browseTo(b.dataset.d));
    const kindOK = e => B.mode === 'dir' ? false : true;
    $('#bList').innerHTML = d.entries.map((e, i) => `<div class="bi" data-i="${i}">
      ${e.dir ? '📁' : (B.mode === 'files' ? `<input type="checkbox" data-c="${i}">` : '')}
      <span>${esc(e.name)}</span><span class="sz">${e.dir ? '' : (e.media === 'video' ? '▶ ' : '♪ ') + fmtSize(e.size)}</span></div>`).join('') || '<div class="empty">Leer</div>';
    $$('#bList .bi').forEach(row => {
      const e = d.entries[+row.dataset.i];
      row.onclick = ev => {
        if (e.dir) { browseTo(d.roots ? e.name : d.path.replace(/[\\/]$/, '') + (d.path.includes('\\') ? '\\' : '/') + e.name); return; }
        if (B.mode !== 'files') return;
        const cb = row.querySelector('input');
        if (ev.target !== cb) cb.checked = !cb.checked;
        const full = d.path.replace(/[\\/]$/, '') + (d.path.includes('\\') ? '\\' : '/') + e.name;
        cb.checked ? B.sel.add(full) : B.sel.delete(full);
        $('#bCount').textContent = B.sel.size + ' ausgewählt';
      };
    });
    $('#bCount').textContent = '';
  } catch (e) { $('#bList').innerHTML = `<div class="empty warn">${esc(e.message)}</div>`; }
}
function openBrowser(mode, start) {
  B.mode = mode;
  $('#bAddSel').classList.toggle('hidden', mode !== 'files');
  $('#bAddDir').textContent = mode === 'dir' ? 'Diesen Ordner wählen' : 'Diesen Ordner (rekursiv)';
  $('#browser').showModal();
  browseTo(start || '');
  return new Promise(res => B.resolve = res);
}
function closeBrowser(v) { $('#browser').close(); if (B.resolve) B.resolve(v); B.resolve = null; }

// ---------- tracks dialog ----------
async function openTracks(f) {
  $('#tTitle').textContent = 'Spuren – ' + f.path.split(/[\\/]/).pop();
  $('#tBody').innerHTML = '<div class="empty">Lade …</div>';
  $('#tracks').showModal();
  try {
    const info = await api('/api/probe?path=' + encodeURIComponent(f.path));
    const rows = info.streams.filter(s => ['video', 'audio', 'subtitle'].includes(s.type) && !s.attachedPic).map(s => {
      const desc = s.type === 'video' ? `${s.width}×${s.height} ${s.bitDepth}bit ${s.pixFmt}` : s.type === 'audio' ? `${s.channels} Kanäle ${s.layout || ''} ${s.sampleRate ? s.sampleRate / 1000 + ' kHz' : ''}` : '';
      const keep = s.type === 'video' ? 'disabled checked' : (f.drop.has(s.index) ? '' : 'checked');
      const def = s.type === 'audio' ? `<input type="radio" name="defA" value="${s.index}" ${(f.defaultAudio != null ? f.defaultAudio === s.index : s.default) ? 'checked' : ''}>` : '';
      return `<tr><td><input type="checkbox" data-s="${s.index}" ${keep}></td><td>#${s.index}</td><td>${s.type}</td><td>${esc(s.codec)}</td>
        <td>${esc(s.lang || '–')}</td><td>${esc(s.title || '')} <span class="muted">${esc(desc)}</span></td><td>${def}</td></tr>`;
    }).join('');
    $('#tBody').innerHTML = `<table><tr><th>Behalten</th><th>#</th><th>Typ</th><th>Codec</th><th>Sprache</th><th>Titel / Info</th><th>Standard</th></tr>${rows}</table>`;
    $$('#tBody [data-s]').forEach(c => c.onchange = () => { c.checked ? f.drop.delete(+c.dataset.s) : f.drop.add(+c.dataset.s); renderFiles(); });
    $$('#tBody [name=defA]').forEach(r => r.onchange = () => { f.defaultAudio = +r.value; renderFiles(); });
  } catch (e) { $('#tBody').innerHTML = `<div class="empty warn">${esc(e.message)}</div>`; }
}

// ---------- start job ----------
function langs(s) { return s.split(',').map(x => x.trim()).filter(Boolean); }
async function start() {
  const kind = S.world, files = S.files[kind];
  const msg = $('#startMsg');
  msg.className = 'small';
  if (!files.length) { msg.textContent = 'Bitte zuerst Dateien hinzufügen.'; msg.classList.add('warn'); return; }
  const req = {
    kind,
    items: files.map(f => ({path: f.path, rel: f.rel, overrides: {drop: [...f.drop], defaultAudio: f.defaultAudio}})),
    output: {
      dir: $('#outMode').value === 'custom' ? $('#outDir').value.trim() : '', structure: $('#outStruct').value,
      suffix: $('#suffix').value, pattern: kind === 'audio' ? $('#pattern').value.trim() : '', exists: $('#exists').value,
      deleteSource: $('#deleteSource').checked,
    },
  };
  if ($('#outMode').value === 'custom' && !req.output.dir) { msg.textContent = 'Bitte einen Zielordner angeben.'; msg.classList.add('warn'); return; }
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
      audioMode: $('#vAudioMode').value, audioCodec: $('#vAudioCodec').value, audioKbps: +$('#vAudioKbps').value, audioLangs: langs($('#vAudioLangs').value),
      subMode: $('#vSubMode').value, subLangs: langs($('#vSubLangs').value)};
  }
  try {
    const r = await api('/api/jobs', req);
    msg.textContent = r.ids.length + ' Auftrag/Aufträge eingereiht.';
    files.length = 0; renderFiles(); saveSettings(); poll();
  } catch (e) { msg.textContent = e.message; msg.classList.add('warn'); }
}

// ---------- queue / monitor ----------
const openDetails = new Set();
function statusChip(j) {
  const m = {queued: ['wartet', ''], running: ['läuft', 'acc'], done: ['fertig', 'ok'], error: ['Fehler', 'err'], canceled: ['abgebrochen', 'warn'], skipped: ['übersprungen', 'warn']}[j.status];
  return `<span class="chip ${m[1]}">${m[0]}</span>`;
}
function encoderBadge(j) {
  if (j.kind !== 'video' || !j.encoder) return '';
  if (j.encoder === 'copy') return '<span class="chip">Video kopiert</span>';
  const hw = j.backend && j.backend !== 'cpu';
  const conf = j.encoderConfirmed ? ' ✓ von ffmpeg bestätigt' : (j.status === 'running' ? ' (warte auf ffmpeg …)' : '');
  return `<span class="chip ${hw ? 'ok' : ''}">${hw ? '⚡ ' : ''}${esc(j.encoder)}${conf}</span>`;
}
function renderQueue() {
  const q = $('#queue');
  if (!S.jobs.length) { q.innerHTML = '<div class="empty" style="margin-top:8px">Keine Aufträge.</div>'; return; }
  q.innerHTML = S.jobs.slice().reverse().map(j => {
    const meta = [];
    if (j.status === 'running') {
      if (j.speed) meta.push('Speed ' + esc(j.speed));
      if (j.fps) meta.push(j.fps.toFixed(0) + ' fps');
      if (j.eta) meta.push('noch ' + fmtTime(j.eta));
    }
    if (j.status === 'done' && j.sizeOut) meta.push(`${fmtSize(j.sizeIn)} → ${fmtSize(j.sizeOut)} (${Math.round(j.sizeOut / j.sizeIn * 100)} %)`);
    if (j.status === 'done') meta.push('Dauer ' + fmtTime((new Date(j.ended) - new Date(j.started)) / 1000));
    if (j.hwDecodeFallback) meta.push('<span class="warn">HW-Decoding nicht möglich → Software-Decoding</span>');
    (j.warnings || []).forEach(w => meta.push('<span class="warn">' + esc(w) + '</span>'));
    const act = (j.status === 'queued' || j.status === 'running') ? `<button class="small ghost" data-cancel="${j.id}">Abbrechen</button>` : '';
    return `<div class="job ${j.status}"><div class="job-h"><span class="n" title="${esc(j.input)}">${esc(j.name)}</span>${encoderBadge(j)}${statusChip(j)}${act}</div>
      <div class="bar"><i style="width:${j.progress.toFixed(1)}%"></i></div>
      <div class="job-m"><span>${j.progress.toFixed(1)} %</span>${meta.map(m => `<span>${m}</span>`).join('')}</div>
      ${j.error ? `<div class="small ${j.status === 'error' ? '' : 'muted'}" style="color:${j.status === 'error' ? 'var(--err)' : 'var(--mut)'}">${esc(j.error)}</div>` : ''}
      <details data-id="${j.id}" ${openDetails.has(j.id) ? 'open' : ''}><summary>Details</summary>
        <div class="small muted">Ziel: ${esc(j.output || '–')}</div>
        ${(j.mapLines || []).length ? `<pre>${esc(j.mapLines.join('\n'))}</pre>` : ''}
        <pre>${esc(j.cmd || '')}</pre><pre>${esc((j.log || []).slice(-25).join('\n'))}</pre></details></div>`;
  }).join('');
  $$('#queue [data-cancel]').forEach(b => b.onclick = () => api('/api/jobs/' + b.dataset.cancel + '/cancel', {}).then(poll));
  $$('#queue details').forEach(d => d.ontoggle = () => d.open ? openDetails.add(d.dataset.id) : openDetails.delete(d.dataset.id));
}
function meter(title, val, sub) {
  const v = val < 0 ? null : Math.max(0, Math.min(100, val));
  return `<div class="meter"><div class="t"><b>${esc(title)}</b><span>${v === null ? 'n/a' : v.toFixed(0) + ' %'}</span></div><div class="bar"><i style="width:${v || 0}%"></i></div><div class="sub">${sub || ''}</div></div>`;
}
function renderMonitor() {
  const st = S.stats, running = S.jobs.some(j => j.status === 'running');
  if (!st) { $('#monitor').innerHTML = ''; return; }
  let h = meter('CPU', st.cpu, running ? 'Bei Hardware-Encoding sollte die CPU niedrig bleiben' : 'Leerlauf – Messung nur während Aufträgen');
  (st.gpus || []).forEach(g => {
    h += meter(g.name + ' – ' + (g.encode >= 0 ? 'Video-Encode' : 'GPU aktiv'), g.encode >= 0 ? g.encode : g.util, esc(g.source) + (g.decode >= 0 ? ` · Decode ${g.decode.toFixed(0)} %` : '') + (g.encode >= 0 ? ` · Gesamt ${g.util.toFixed(0)} %` : ''));
  });
  if (!(st.gpus || []).length) h += `<div class="meter"><div class="t"><b>GPU</b><span>n/a</span></div><div class="sub">Keine GPU-Auslastung lesbar (Docker: /dev/dri bzw. NVIDIA-Runtime durchreichen)</div></div>`;
  $('#monitor').innerHTML = h;
}
let polling = false;
async function poll() {
  if (polling || S.stopped) return; polling = true;
  try {
    const d = await api('/api/state');
    S.jobs = d.jobs; S.stats = d.stats;
    if (document.activeElement !== $('#conc')) $('#conc').value = d.concurrency;
    renderQueue(); renderMonitor();
  } catch (e) {} finally { polling = false; }
}

// ---------- info popovers ----------
function infoBtn(key) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'info'; b.textContent = 'i'; b.dataset.key = key;
  b.title = 'Erklärung'; b.setAttribute('aria-label', 'Erklärung anzeigen');
  return b;
}
function decorateInfo() {
  Object.keys(INFO).forEach(key => {
    if (key === 'tracksBtn') return;
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
    if (lab_isCheck(target)) {
      if (after && after.nextSibling) target.insertBefore(b, after.nextSibling); else target.appendChild(b);
    } else if (after && after.nodeType === 3) {
      const wrap = document.createElement('span');
      wrap.className = 'lt';
      target.insertBefore(wrap, after);
      wrap.appendChild(after); wrap.appendChild(b);
    } else if (after) after.appendChild(b);
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
  btn.classList.add('on'); popFor = btn;
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
window.addEventListener('scroll', hideInfo, true);

// ---------- init ----------
async function loadInfo() {
  S.info = await api('/api/info');
  $('#ffver').textContent = S.info.ffmpeg.replace(/^ffmpeg version /, 'ffmpeg ').split(' Copyright')[0] + ' · ' + S.info.os;
  refreshVideoUI();
  $('#quit').classList.toggle('hidden', !S.info.canQuit);
  if (!S.info.hw.done) setTimeout(loadInfo, 1200);
}
function wire() {
  $$('#worlds button').forEach(b => b.onclick = () => setWorld(b.dataset.world));
  [...FIELDS, ...CHECKS].forEach(f => $('#' + f).addEventListener('input', () => { refreshAudioUI(); refreshVideoUI(); saveSettings(); }));
  $('#outMode').addEventListener('input', outModeUI);
  $('#addFiles').onclick = async () => {
    const r = await openBrowser('files', S.lastDir); if (!r) return;
    if (r.dir) S.lastDir = r.dir;
    const d = await api('/api/scan', {paths: r.paths, kind: S.world}); addScanned(d.files);
  };
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
  $('#bCancel').onclick = () => closeBrowser(null);
  $('#browser').addEventListener('cancel', () => { if (B.resolve) B.resolve(null); B.resolve = null; });
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
  $('#cancelAll').onclick = () => api('/api/jobs/cancel-all', {}).then(poll);
  $('#clearDone').onclick = () => api('/api/jobs/clear', {}).then(poll);
  $('#conc').onchange = () => api('/api/concurrency', {n: +$('#conc').value});
  $('#hwRedetect').onclick = async () => { await api('/api/hw/detect', {}); S.info.hw.done = false; S.info.hw.backends = []; renderHwCard(); setTimeout(loadInfo, 800); };
}
function outModeUI() {
  const c = $('#outMode').value === 'custom';
  $('#outDirRow').classList.toggle('hidden', !c);
  $('#structRow').classList.toggle('hidden', !c);
}
(async function init() {
  loadSettings(); renderPresets(); decorateInfo(); wire();
  await loadInfo();
  if (!$('#outDir').value && S.info.roots && S.info.roots.length > 1) $('#outDir').value = S.info.roots[S.info.roots.length - 1];
  outModeUI(); setWorld(S.world); refreshAudioUI(); refreshVideoUI();
  poll(); setInterval(poll, 1000);
})();
