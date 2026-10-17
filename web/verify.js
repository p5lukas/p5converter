'use strict';
/* Kontrolle nach dem Konvertieren (letzter Schritt „Zusammenfassung“): Spuren prüfen (A), Decode-Test (B), Schonfrist (C).
   Je Welt getrennt; die Anfangswerte kommen aus Einstellungen → Allgemein. Nutzt S, $, h(), cfg(), W() aus app.js/settings.js. */

const VF_DAYS = [1, 3, 7, 14, 30, 60, 90];
// S.vf (je Welt: {tracks, decode, grace, days, del}) entsteht in wireVerify()

function vfDefaults(w) {
  const v = (cfg().verify || {})[w] || {};
  return {tracks: v.tracks !== false, decode: v.decode !== false, grace: !!v.grace, days: v.graceDays || 7, del: false};
}
function vfStash(w) {
  if (!w || !$('#vfTracks')) return;
  S.vf[w] = {tracks: $('#vfTracks').checked, decode: $('#vfDecode').checked, grace: $('#vfGrace').checked, days: +$('#vfDays').value || 7, del: $('#deleteSource').checked};
}
function vfShow(w) {
  const v = S.vf[w] || (S.vf[w] = vfDefaults(w));
  $('#vfTracks').checked = v.tracks; $('#vfDecode').checked = v.decode; $('#vfGrace').checked = v.grace;
  $('#vfDays').value = String(v.days); if ($('#vfDays').value !== String(v.days)) $('#vfDays').value = '7';
  $('#deleteSource').checked = v.del;
  S.vfFor = w;
  vfUI();
}
// „Zurücksetzen“ und geänderte Standardwerte in den Einstellungen: zurück auf die Standardauswahl
function vfReset(w) { S.vf[w] = vfDefaults(w); if (S.vfFor === w) vfShow(w); }

// Zeitangaben in Worten (Schätzwerte, grob): Wie viel länger dauert der Auftrag durch die Prüfung?
function vfTime(w, kind) {
  if (kind === 'tracks') return ['kaum länger', 'Sekundenbruchteile je Datei'];
  if (kind === 'grace') return ['keine Zeit, aber Speicher', 'die Originale belegen den Platz, bis die Schonfrist vorbei ist'];
  if (w === 'audio') return ['kaum länger', 'ein Lied braucht nur Bruchteile einer Sekunde'];
  const copy = $('#vCodec').value === 'copy';
  return copy
    ? ['viel länger als das Umwandeln selbst', 'Umwandeln ohne Neu-Kodieren dauert nur Minuten; das Durchlesen eines 2-Stunden-Films in 1080p braucht grob 5–10 Minuten, bei 4K deutlich mehr']
    : ['etwas länger', 'ein 2-Stunden-Film in 1080p braucht für das Durchlesen grob 5–10 Minuten, bei 4K deutlich mehr; im Vergleich zum Neu-Kodieren ist das wenig'];
}
const vfTimeEl = (w, kind) => { const [a, b] = vfTime(w, kind); return [h('b', {class: 'vftime'}, a), h('span', {class: 'muted small'}, ' – ' + b + ' (Schätzwert)')]; };

function vfUI() {
  if (!$('#vfCard')) return;
  const w = S.world, del = $('#deleteSource').checked;
  fill($('#vfTracksT'), vfTimeEl(w, 'tracks'));
  fill($('#vfDecodeT'), vfTimeEl(w, 'decode'));
  const g = $('#vfGrace');
  g.disabled = !del; if (!del) g.checked = false;
  $('#vfDays').disabled = !del || !g.checked;
  $('#vfGraceRow').classList.toggle('off', !del);
  const days = $('#vfDays').value;
  fill($('#vfGraceT'), del
    ? [h('span', {class: 'muted small'}, 'Das Original wird erst in den Ordner „p5converter-gelöscht“ (neben der Quelle) verschoben und nach ' + days + (days === '1' ? ' Tag' : ' Tagen') + ' endgültig gelöscht – ')].concat(vfTimeEl(w, 'grace'))
    : [h('span', {class: 'muted small'}, 'Nur mit „Quelldatei löschen“ möglich – dort wird das Original sonst sofort und endgültig gelöscht.')]);
  $('#vfDelHint').classList.toggle('hidden', !del || g.checked);
}

// was an den Server geht (Teil von output)
function vfCollect() {
  const del = $('#deleteSource').checked, grace = del && $('#vfGrace').checked;
  return {deleteSource: del, verifyTracks: $('#vfTracks').checked, verifyDecode: $('#vfDecode').checked, grace, graceDays: grace ? +$('#vfDays').value : 0};
}
function vfWords() {
  const o = vfCollect(), p = [];
  if (o.verifyTracks) p.push('Spuren und Größe prüfen');
  if (o.verifyDecode) p.push('Ergebnis komplett durchlesen');
  if (!p.length) p.push('nur Lesbarkeit und Laufzeit');
  if (o.deleteSource) p.push(o.grace ? 'Original nach ' + o.graceDays + (o.graceDays === 1 ? ' Tag' : ' Tagen') + ' löschen (Schonfrist)' : 'Original sofort löschen');
  return p;
}

function wireVerify() {
  S.vf = {};
  ['vfTracks', 'vfDecode', 'vfGrace', 'vfDays', 'deleteSource'].forEach(id => $('#' + id).addEventListener('input', () => { vfStash(S.vfFor); vfUI(); if (S.step === 'summary') renderSummary(); }));
  $('#vCodec').addEventListener('input', vfUI);
}
