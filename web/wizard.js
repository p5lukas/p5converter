'use strict';
/* Assistent „Neue Voreinstellung“ (nur Video) und Bearbeiten einer Voreinstellung: alle Einstellungen aus Video, Ton und Untertitel, jede Frage in einfachen Worten mit einer
   empfohlenen Vorauswahl. Neu: Frage für Frage, am Ende Zusammenfassung, Name, Speichern. Bearbeiten (Einstellungen → Voreinstellungen → „Bearbeiten“): alle Fragen auf einer
   Seite als Auswahllisten, ohne Dateien. Der Assistent stellt die Felder der Konvertieren-Seite nicht um; er legt die Voreinstellung wie „Als Voreinstellung speichern“ an
   (Werte von collectPresetValues, mit den Antworten überschrieben; beim Bearbeiten bleiben die nicht abgefragten Werte erhalten). Nutzt S, $, h(), fill(), cfg(), saveCfg(),
   Q, workingBackends() usw. aus den anderen Dateien (nur zur Laufzeit). */

const WIZ = {i: 0, a: {}, edit: null, orig: null};
// nutzbare Grafik-Encoder für diesen Codec (ohne CPU)
const wizHwIds = codec => workingBackends(codec).filter(id => id !== 'cpu');
// Auswahl aus einem Feld der Oberfläche: „Name (Hinweis)“ → [Wert, Name, Hinweis]
const wizFromSelect = (id, only) => [...$('#' + id).options].filter(o => !only || only.includes(o.value)).map(o => { const m = /^(.*?)\s*\((.*)\)\s*$/.exec(o.textContent); return [o.value, m ? m[1] : o.textContent, m ? m[2] : '']; });
function wizQuestions() {
  const a = WIZ.a, copy = a.codec === 'copy', hwIds = wizHwIds(a.codec), hw = hwIds.map(id => BACKEND_FULL[id] || id), enc = a.aMode === 'encode';
  const backends = [['auto', 'Automatisch', hw.length ? 'Grafikkarte (' + hw.join(', ') + '), sonst CPU – schneller, Datei etwas größer' : 'keine Grafikkarte gefunden – es rechnet die CPU'], ['cpu', 'CPU', 'rechnet am genauesten, dauert länger', true]];
  hwIds.forEach(id => backends.push([id, BACKEND_FULL[id] || id, 'nur diese Grafikeinheit nutzen']));
  if (a.backend && !backends.some(b => b[0] === a.backend)) backends.push([a.backend, BACKEND_FULL[a.backend] || a.backend, 'in der Voreinstellung gespeichert, hier gerade nicht erkannt']);
  const stages = Q.STAGES.map(([id, name, sub]) => [id, name, {vgood: 'kaum ein Unterschied zur Quelle, große Dateien', good: 'sehr nah an der Quelle, deutlich kleiner', normal: 'kleiner, bei genauem Hinsehen kleine Unterschiede'}[id] || sub || '', id === 'good']);
  stages.push(['custom', 'Eigener Wert', 'mit Schieberegler selbst einstellen']);
  const qs = [
    {id: 'codec', label: 'Video-Format', title: 'Welches Video-Format soll herauskommen?', opts: [
      ['hevc', 'H.265', 'kleinere Dateien, läuft auf fast allen aktuellen Geräten', true], ['h264', 'H.264', 'läuft überall, Dateien etwas größer'],
      ['av1', 'AV1', 'sehr klein, braucht neuere Geräte'], ['vp9', 'VP9', 'klein, vor allem für Web und Browser'], ['copy', 'Nur neu verpacken', 'das Bild bleibt, wie es ist – sehr schnell, nichts wird kleiner']]},
    {id: 'container', label: 'Container', title: 'In welche Datei soll es verpackt werden?', opts: [['mkv', 'MKV', 'nimmt alle Spuren und Untertitel mit (empfohlen)', true], ['mp4', 'MP4', 'läuft auf noch mehr Geräten, bei manchen Untertiteln eingeschränkt']]},
    {id: 'quality', label: 'Qualität', title: 'Wie gut soll das Bild bleiben?', skip: copy, opts: stages},
    {id: 'speed', label: 'Geschwindigkeit', title: 'Wie gründlich soll gerechnet werden?', skip: copy, opts: [
      ['slow', 'Langsam', 'kleinste Dateien bei gleicher Qualität – dauert am längsten', true], ['medium', 'Mittel', 'gute Mitte aus Zeit und Dateigröße'], ['fast', 'Schnell', 'zügig, Datei etwas größer'], ['veryfast', 'Sehr schnell', 'am schnellsten, Datei am größten']]},
    {id: 'backend', label: 'Encoder', title: 'Womit soll gerechnet werden?', skip: copy, opts: backends},
    {id: 'height', label: 'Auflösung', title: 'Soll die Auflösung kleiner werden?', skip: copy, opts: [['0', 'Wie die Quelle', 'nichts wird verkleinert', true], ['2160', 'Höchstens 2160p (4K)', 'nur noch größere Bilder werden verkleinert'], ['1440', 'Höchstens 1440p', ''], ['1080', 'Höchstens 1080p', 'größere Bilder (z. B. 4K) werden verkleinert'], ['720', 'Höchstens 720p', 'deutlich kleiner'], ['576', 'Höchstens 576p', ''], ['480', 'Höchstens 480p', 'sehr klein']]},
    {id: 'depth', label: 'Bit-Tiefe', title: 'Welche Bit-Tiefe soll das Bild haben?', skip: copy, opts: [['0', 'Wie die Quelle', 'bleibt, wie sie ist', true], ['8', '8 Bit', 'läuft überall'], ['10', '10 Bit', 'weichere Farbverläufe, braucht etwas mehr Rechenzeit']]},
    {id: 'aMode', label: 'Ton umwandeln', title: 'Sollen die Tonspuren kleiner gemacht werden?', opts: [['copy', 'Unverändert lassen', 'beste Qualität, nichts geht verloren (empfohlen)', true], ['encode', 'Kleiner machen', 'Tonspuren werden neu kodiert']]},
    {id: 'aCodec', label: 'Ton-Format', title: 'In welches Ton-Format?', skip: !enc, opts: wizFromSelect('vAudioCodec').map((o, k) => k === 0 ? [...o, true] : o)},
    {id: 'aKbps', label: 'Ton-Bitrate', title: 'Wie hoch soll die Bitrate sein (je Stereo-Paar)?', skip: !enc, opts: [['96', '96 kbit/s', 'klein, für Sprache'], ['128', '128 kbit/s', ''], ['160', '160 kbit/s', 'gute Mitte', true], ['192', '192 kbit/s', ''], ['256', '256 kbit/s', 'sehr nah am Original'], ['384', '384 kbit/s', 'für Surround']]},
    {id: 'subs', label: 'Untertitel', title: 'Sollen Untertitel bleiben?', opts: [['copy', 'Alle behalten', 'wie in der Quelle (empfohlen)', true], ['none', 'Alle entfernen', 'die Datei bekommt keine Untertitel']]},
    {id: 'tracks', label: 'Sprachen & Regeln', title: 'Welche Ton- und Untertitelspuren sollen bleiben?', opts: [
      ['prefs', 'Nach meinen Sprach-Wünschen', trkHasPrefs() ? 'wie in Einstellungen → Audio & Untertitel festgelegt' : 'noch keine festgelegt (Einstellungen → Audio & Untertitel); bis dahin bleibt alles', trkHasPrefs()],
      ['keep', 'Alles unverändert lassen', 'alle Spuren bleiben, wie sie sind', !trkHasPrefs()],
      ...(a.tracks === 'custom' ? [['custom', 'Eigene Regeln der Voreinstellung', 'die gespeicherten Regeln bleiben erhalten']] : [])]},
  ];
  return qs.filter(q => !q.skip);
}
// Antworten aus den Werten einer Voreinstellung (Bearbeiten) bzw. Empfehlungen (neu)
function wizAnswers(v) {
  const rec = {codec: 'hevc', container: 'mkv', quality: 'good', speed: 'slow', backend: 'cpu', crf: '22', height: '0', depth: '0', aMode: 'copy', aCodec: 'aac', aKbps: '160', subs: 'copy', tracks: trkHasPrefs() ? 'prefs' : 'keep'};
  if (!v) return rec;
  let tracks = 'prefs';
  if (v.vTrkRules) { try { const r = JSON.parse(v.vTrkRules); tracks = r && !(r.audio || []).length && !(r.sub || []).length && r.usePrefs === false ? 'keep' : 'custom'; } catch (e) { tracks = 'custom'; } }
  const pick = (x, d) => x == null || x === '' ? d : String(x);
  return {codec: pick(v.vCodec, rec.codec), container: pick(v.vContainer, 'mkv'), quality: pick(v.vQuality, rec.quality), speed: pick(v.vPreset, 'medium'), backend: pick(v.vBackend, 'cpu'), crf: pick(v.vCrf, '22'), height: pick(v.vHeight, '0'),
    depth: pick(v.vDepth, '0'), aMode: pick(v.vAudioMode, 'copy'), aCodec: pick(v.vAudioCodec, rec.aCodec), aKbps: pick(v.vAudioKbps, rec.aKbps), subs: pick(v.vSubMode, 'copy'), tracks};
}
// die Werte der Voreinstellung: die Felder (beim Bearbeiten die gespeicherten Werte), überschrieben mit den Antworten
function wizValues() {
  const a = WIZ.a, v = WIZ.orig ? {...WIZ.orig} : collectPresetValues('video');
  if (!WIZ.orig) Object.assign(v, {pattern: '', suffix: '', renRules: '[]'});
  Object.assign(v, {vCodec: a.codec, vContainer: a.container, vAudioMode: a.aMode, vSubMode: a.subs});
  if (a.aMode === 'encode') Object.assign(v, {vAudioCodec: a.aCodec, vAudioKbps: String(a.aKbps)});
  if (a.codec === 'copy') Object.assign(v, {vDepth: '0'});
  else {
    v.vBackend = a.backend; v.vPreset = a.speed; v.vQuality = a.quality; v.vHeight = a.height; v.vDepth = a.depth;
    if (a.quality === 'custom') v.vCrf = String(a.crf);
    else {
      const id = a.backend === 'auto' ? (preferredFor(a.codec) || workingBackends(a.codec)[0] || 'cpu') : a.backend, crf = Q.value(id, a.codec, a.quality);
      if (crf != null) v.vCrf = String(crf);
    }
  }
  if (a.tracks !== 'custom') v.vTrkRules = a.tracks === 'keep' ? JSON.stringify({audio: [], sub: [], usePrefs: false}) : '';
  return v;
}
function wizName() {
  const a = WIZ.a;
  if (a.codec === 'copy') return 'Neu verpacken (' + a.container.toUpperCase() + ')';
  return CODEC_LABEL[a.codec] + ' · ' + (a.quality === 'custom' ? 'Wert ' + a.crf : Q.stageName(a.quality)) + ({slow: ' · langsam', fast: ' · schnell', veryfast: ' · sehr schnell'}[a.speed] || '') + (a.backend !== 'cpu' ? ' · Grafikkarte' : '');
}
const wizLabel = (qs, qid) => { const q = qs.find(x => x.id === qid); const o = q && q.opts.find(x => x[0] === WIZ.a[qid]); return o ? o[1] : ''; };
// Schieberegler für „Eigener Wert“ (nur bei Qualität = Eigener Wert)
function wizSlider() {
  if (WIZ.a.quality !== 'custom') return null;
  const scale = Q.scaleName(WIZ.a.backend === 'auto' ? (preferredFor(WIZ.a.codec) || workingBackends(WIZ.a.codec)[0] || 'cpu') : WIZ.a.backend), out = h('output', {}, WIZ.a.crf);
  return h('div', {class: 'qadv on wizslider'}, h('label', {class: 'qsl'}, h('span', {}, 'Eigener Wert · ' + scale + ' '), out,
    h('input', {type: 'range', min: 10, max: 40, value: WIZ.a.crf, 'aria-label': 'Eigener Wert', oninput: ev => { WIZ.a.crf = ev.target.value; out.textContent = ev.target.value; }})),
    h('div', {class: 'muted small'}, 'Niedriger = bessere Qualität, größere Datei. Die Zahl gilt nur für den gewählten Encoder.'));
}
function wizSet(qid, v) {
  if (qid === 'quality' && v === 'custom' && WIZ.a.quality !== 'custom') { // Startwert des Reglers: die bisherige Stufe
    const id = WIZ.a.backend === 'auto' ? (preferredFor(WIZ.a.codec) || workingBackends(WIZ.a.codec)[0] || 'cpu') : WIZ.a.backend, n = Q.value(id, WIZ.a.codec, WIZ.a.quality);
    if (n != null) WIZ.a.crf = String(n);
  }
  WIZ.a[qid] = v; wizRender();
}
const wizHead = (text, n) => h('div', {class: 'wizhead'}, h('span', {class: 'muted small'}, text), h('button', {type: 'button', class: 'small ghost', 'aria-label': 'Schließen', onclick: () => $('#wizDlg').close()}, '✕'));
function wizRender() {
  const qs = wizQuestions(), n = qs.length, box = $('#wizBox'), keep = box.querySelector('.wizform') ? box.scrollTop : 0;
  if (WIZ.edit) { wizRenderEdit(qs, keep); return; }
  const last = WIZ.i >= n;
  const dots = h('div', {class: 'wizdots', role: 'progressbar', 'aria-valuemin': 1, 'aria-valuemax': n, 'aria-valuenow': Math.min(WIZ.i + 1, n)}, Array.from({length: n}, (_, k) => h('i', {class: k <= WIZ.i ? 'd' : ''})));
  const head = wizHead('Neue Voreinstellung · ' + (last ? 'fertig' : 'Frage ' + (WIZ.i + 1) + ' von ' + n));
  if (!last) {
    const q = qs[WIZ.i];
    fill(box, head, dots, h('h2', {class: 'wiztitle'}, q.title),
      h('div', {class: 'wizopts', role: 'radiogroup', 'aria-label': q.title}, q.opts.map(([v, label, sub, rec]) => h('button', {type: 'button', role: 'radio', 'aria-checked': WIZ.a[q.id] === v ? 'true' : 'false', class: 'opt2' + (WIZ.a[q.id] === v ? ' on' : ''),
        onclick: () => wizSet(q.id, v)}, h('span', {class: 'rd'}), h('span', {class: 'wo'}, h('b', {}, label), sub ? h('small', {}, sub) : null), rec ? h('span', {class: 'rec'}, 'empfohlen') : null))),
      q.id === 'quality' ? wizSlider() : null,
      h('div', {class: 'wiznav'}, h('button', {type: 'button', id: 'wizPrev', class: 'ghost', disabled: WIZ.i === 0, onclick: () => { WIZ.i--; wizRender(); }}, '‹ Zurück'),
        h('button', {type: 'button', id: 'wizGo', class: 'primary', onclick: () => { WIZ.i++; wizRender(); }}, 'Weiter ›')));
    return;
  }
  const rows = qs.map(q => [q.label, wizLabel(qs, q.id) + (q.id === 'quality' && WIZ.a.quality === 'custom' ? ' (' + WIZ.a.crf + ')' : '')]);
  const name = h('input', {id: 'wizName', class: 'wizname', value: WIZ.name != null ? WIZ.name : wizName(), maxlength: 40, 'aria-label': 'Name der Voreinstellung', autocomplete: 'off', onkeydown: ev => { if (ev.key === 'Enter') { ev.preventDefault(); wizSave(); } }});
  fill(box, head, dots, h('h2', {class: 'wiztitle'}, 'Passt das so?'),
    h('div', {class: 'wizsum'}, rows.map(([k, v]) => h('div', {class: 'wizrow'}, h('span', {class: 'muted'}, k), h('b', {}, v)))),
    h('label', {class: 'wizlab'}, h('span', {class: 'lt'}, 'Name der Kachel'), name),
    h('div', {class: 'wiznav'}, h('button', {type: 'button', id: 'wizPrev', class: 'ghost', onclick: () => { WIZ.i = n - 1; wizRender(); }}, '‹ Zurück'),
      h('button', {type: 'button', id: 'wizSave', class: 'primary', onclick: wizSave}, 'Speichern')));
}
// Bearbeiten: alle Einstellungen auf einer Seite, jede als Auswahlliste mit Hinweis; ohne Dateien
function wizRenderEdit(qs, keep) {
  const box = $('#wizBox');
  const sel = q => {
    const cur = q.opts.find(o => o[0] === WIZ.a[q.id]);
    return h('div', {class: 'wizfield'}, h('label', {}, h('span', {class: 'lt'}, q.label),
      h('select', {'aria-label': q.label, onchange: ev => wizSet(q.id, ev.target.value)}, q.opts.map(([v, label]) => h('option', {value: v, selected: v === WIZ.a[q.id]}, label)))),
      cur && cur[2] ? h('small', {class: 'muted'}, cur[2]) : null, q.id === 'quality' ? wizSlider() : null);
  };
  const name = h('input', {id: 'wizName', class: 'wizname', value: WIZ.name, maxlength: 40, 'aria-label': 'Name der Voreinstellung', autocomplete: 'off', oninput: ev => { WIZ.name = ev.target.value; }});
  const group = (title, ids) => { const l = qs.filter(q => ids.includes(q.id)); return l.length ? h('section', {class: 'wizgrp'}, h('h3', {}, title), l.map(sel)) : null; };
  fill(box, wizHead('Voreinstellung bearbeiten'), h('h2', {class: 'wiztitle'}, 'Einstellungen'),
    h('div', {class: 'wizform'}, h('label', {class: 'wizlab'}, h('span', {class: 'lt'}, 'Name der Kachel'), name),
      group('Video', ['codec', 'container', 'quality', 'speed', 'backend', 'height', 'depth']), group('Ton', ['aMode', 'aCodec', 'aKbps']), group('Untertitel und Spuren', ['subs', 'tracks'])),
    h('div', {class: 'wiznav'}, h('button', {type: 'button', class: 'ghost', onclick: () => $('#wizDlg').close()}, 'Abbrechen'), h('button', {type: 'button', id: 'wizSave', class: 'primary', onclick: wizSave}, 'Änderungen speichern')));
  box.scrollTop = keep;
}
// p: Voreinstellung zum Bearbeiten (ohne Angabe: neue anlegen)
function openWizard(p) {
  p = p && p.id ? p : null;
  WIZ.i = 0; WIZ.edit = p ? p.id : null; WIZ.orig = p ? {...p.values} : null; WIZ.name = p ? p.name : null;
  WIZ.a = wizAnswers(p ? p.values : null);
  wizRender();
  $('#wizDlg').showModal();
}
async function wizSave() {
  const name = ($('#wizName') || {}).value && $('#wizName').value.trim();
  if (!name) { toast('Bitte einen Namen eingeben.', 'bad'); return; }
  const values = wizValues();
  const ok = WIZ.edit
    ? await saveCfg(c => { const x = c.presets.find(y => y.id === WIZ.edit); if (x) { x.name = name; x.values = values; } }, 'Voreinstellung „' + name + '“ aktualisiert ✓')
    : await saveCfg(c => c.presets.push({id: '', name, world: 'video', suggest: true, values}), 'Voreinstellung „' + name + '“ gespeichert ✓');
  if (ok) $('#wizDlg').close();
}
