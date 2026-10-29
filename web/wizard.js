'use strict';
/* Assistent „Neue Voreinstellung“ (nur Video): wenige Fragen in einfachen Worten, jede mit einer empfohlenen Vorauswahl; am Ende Zusammenfassung, Name, Speichern.
   Er legt die Voreinstellung genau wie „Als Voreinstellung speichern“ an (Werte der Felder von collectPresetValues, hier mit den Antworten überschrieben) und stellt
   die Felder der Konvertieren-Seite dabei nicht um. Nutzt S, $, h(), fill(), cfg(), saveCfg(), Q, workingBackends() usw. aus den anderen Dateien (nur zur Laufzeit). */

const WIZ = {i: 0, a: {}};
const WIZ_COUNT = 5;
// nutzbare Grafik-Encoder für diesen Codec (ohne CPU)
const wizHwIds = codec => workingBackends(codec).filter(id => id !== 'cpu');
function wizQuestions() {
  const a = WIZ.a, copy = a.codec === 'copy', hw = wizHwIds(a.codec).map(id => BACKEND_FULL[id] || id);
  const qs = [
    {id: 'codec', title: 'Welches Video-Format soll herauskommen?', opts: [
      ['hevc', 'H.265', 'kleinere Dateien, läuft auf fast allen aktuellen Geräten', true], ['h264', 'H.264', 'läuft überall, Dateien etwas größer'],
      ['av1', 'AV1', 'sehr klein, braucht neuere Geräte'], ['copy', 'Nur neu verpacken', 'das Bild bleibt, wie es ist – sehr schnell, nichts wird kleiner']]},
    {id: 'goal', title: 'Was ist dir wichtiger?', skip: copy, opts: [
      ['small', 'Kleinste Datei', 'dauert am längsten · CPU, Geschwindigkeit „Langsam“'], ['mid', 'Gute Mitte', 'CPU, Geschwindigkeit „Mittel“', true],
      ['fast', 'Schnell fertig', hw.length ? 'Grafikkarte (' + hw.join(', ') + ') · Datei etwas größer' : 'keine Grafikkarte gefunden · CPU, Geschwindigkeit „Schnell“']]},
    {id: 'quality', title: 'Wie gut soll das Bild bleiben?', skip: copy, opts: Q.STAGES.map(([id, name, sub]) => [id, name, {vgood: 'kaum ein Unterschied zur Quelle, große Dateien', good: 'sehr nah an der Quelle, deutlich kleiner', normal: 'kleiner, bei genauem Hinsehen Unterschiede', small: 'sehr klein, das Bild wird weicher'}[id] || sub, id === 'good']).map(o => o)},
    {id: 'height', title: 'Soll die Auflösung kleiner werden?', skip: copy, opts: [['0', 'Wie die Quelle', 'nichts wird verkleinert', true], ['1080', 'Höchstens 1080p', 'größere Bilder (z. B. 4K) werden verkleinert'], ['720', 'Höchstens 720p', 'deutlich kleinere Dateien']]},
    {id: 'tracks', title: 'Ton und Untertitel', opts: [
      ['prefs', 'Nach meinen Sprach-Wünschen', trkHasPrefs() ? 'wie in Einstellungen → Audio & Untertitel festgelegt' : 'noch keine festgelegt (Einstellungen → Audio & Untertitel); bis dahin bleibt alles', trkHasPrefs()],
      ['keep', 'Alles unverändert lassen', 'alle Spuren bleiben, wie sie sind', !trkHasPrefs()]]},
  ];
  return qs.filter(q => !q.skip);
}
// die Werte der Voreinstellung: die Felder, überschrieben mit den Antworten
function wizValues() {
  const a = WIZ.a, v = collectPresetValues('video');
  Object.assign(v, {vCodec: a.codec, vContainer: 'mkv', vDepth: '0', vAudioMode: 'copy', vSubMode: 'copy', pattern: '', suffix: '', renRules: '[]'});
  if (a.codec !== 'copy') {
    const hw = wizHwIds(a.codec).length > 0;
    v.vBackend = a.goal === 'fast' && hw ? 'auto' : 'cpu';
    v.vPreset = a.goal === 'small' ? 'slow' : a.goal === 'mid' ? 'medium' : hw ? 'medium' : 'fast';
    v.vQuality = a.quality; v.vHeight = a.height;
    const id = v.vBackend === 'auto' ? (preferredFor(a.codec) || workingBackends(a.codec)[0] || 'cpu') : 'cpu', crf = Q.value(id, a.codec, a.quality);
    if (crf != null) v.vCrf = String(crf);
  }
  v.vTrkRules = a.tracks === 'keep' ? JSON.stringify({audio: [], sub: [], usePrefs: false}) : '';
  return v;
}
function wizName() {
  const a = WIZ.a;
  if (a.codec === 'copy') return 'Neu verpacken (MKV)';
  return CODEC_LABEL[a.codec] + ' · ' + Q.stageName(a.quality) + ({small: ' · klein', fast: ' · schnell'}[a.goal] || '');
}
function wizRender() {
  const qs = wizQuestions(), n = qs.length, last = WIZ.i >= n, box = $('#wizBox');
  const dots = h('div', {class: 'wizdots', role: 'progressbar', 'aria-valuemin': 1, 'aria-valuemax': n, 'aria-valuenow': Math.min(WIZ.i + 1, n)}, Array.from({length: n}, (_, k) => h('i', {class: k <= WIZ.i ? 'd' : ''})));
  const head = h('div', {class: 'wizhead'}, h('span', {class: 'muted small'}, 'Neue Voreinstellung · ' + (last ? 'fertig' : 'Frage ' + (WIZ.i + 1) + ' von ' + n)),
    h('button', {type: 'button', class: 'small ghost', 'aria-label': 'Schließen', onclick: () => $('#wizDlg').close()}, '✕'));
  if (!last) {
    const q = qs[WIZ.i];
    fill(box, head, dots, h('h2', {class: 'wiztitle'}, q.title),
      h('div', {class: 'wizopts', role: 'radiogroup', 'aria-label': q.title}, q.opts.map(([v, label, sub, rec]) => h('button', {type: 'button', role: 'radio', 'aria-checked': WIZ.a[q.id] === v ? 'true' : 'false', class: 'opt2' + (WIZ.a[q.id] === v ? ' on' : ''), 'data-v': v,
        onclick: () => { WIZ.a[q.id] = v; wizRender(); }}, h('span', {class: 'rd'}), h('span', {class: 'wo'}, h('b', {}, label), h('small', {}, sub)), rec ? h('span', {class: 'rec'}, 'empfohlen') : null))),
      h('div', {class: 'wiznav'}, h('button', {type: 'button', id: 'wizPrev', class: 'ghost', disabled: WIZ.i === 0, onclick: () => { WIZ.i--; wizRender(); }}, '‹ Zurück'),
        h('button', {type: 'button', id: 'wizGo', class: 'primary', onclick: () => { WIZ.i++; wizRender(); }}, 'Weiter ›')));
    return;
  }
  const a = WIZ.a, lab = (qid, v) => { const q = qs.find(x => x.id === qid); const o = q && q.opts.find(x => x[0] === v); return o ? o[1] : ''; };
  const rows = [['Format', lab('codec', a.codec)], a.codec === 'copy' ? null : ['Aufwand', lab('goal', a.goal)], a.codec === 'copy' ? null : ['Qualität', lab('quality', a.quality)],
    a.codec === 'copy' ? null : ['Auflösung', lab('height', a.height)], ['Ton und Untertitel', lab('tracks', a.tracks)]].filter(Boolean);
  const name = h('input', {id: 'wizName', class: 'wizname', value: wizName(), maxlength: 40, 'aria-label': 'Name der Voreinstellung', autocomplete: 'off', onkeydown: ev => { if (ev.key === 'Enter') { ev.preventDefault(); wizSave(); } }});
  fill(box, head, dots, h('h2', {class: 'wiztitle'}, 'Passt das so?'),
    h('div', {class: 'wizsum'}, rows.map(([k, v]) => h('div', {class: 'wizrow'}, h('span', {class: 'muted'}, k), h('b', {}, v)))),
    h('label', {class: 'wizlab'}, h('span', {class: 'lt'}, 'Name der Kachel'), name),
    h('div', {class: 'wiznav'}, h('button', {type: 'button', id: 'wizPrev', class: 'ghost', onclick: () => { WIZ.i = n - 1; wizRender(); }}, '‹ Zurück'),
      h('button', {type: 'button', id: 'wizSave', class: 'primary', onclick: wizSave}, 'Speichern')));
}
async function wizSave() {
  const name = ($('#wizName') || {}).value && $('#wizName').value.trim();
  if (!name) { toast('Bitte einen Namen eingeben.', 'bad'); return; }
  if (await saveCfg(c => c.presets.push({id: '', name, world: 'video', suggest: true, values: wizValues()}), 'Voreinstellung „' + name + '“ gespeichert ✓')) $('#wizDlg').close();
}
function openWizard() {
  WIZ.i = 0; WIZ.a = {codec: 'hevc', goal: 'mid', quality: 'good', height: '0', tracks: trkHasPrefs() ? 'prefs' : 'keep'};
  wizRender();
  $('#wizDlg').showModal();
}
