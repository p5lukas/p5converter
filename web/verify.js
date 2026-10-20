'use strict';
/* Kontrolle nach dem Konvertieren (Satz „danach geprüft“ und Details → Prüfen): Spuren prüfen (A), Decode-Test (B), Quelldatei löschen.
   Je Art (Video, Audio) getrennt; die Anfangswerte kommen aus Einstellungen → Allgemein. Nutzt S, $, h(), cfg(), W() aus app.js/settings.js. */

// S.vf (je Art: {tracks, decode, del}) entsteht in wireVerify()
function vfDefaults(w) {
  const v = (cfg().verify || {})[w] || {};
  return {tracks: v.tracks !== false, decode: v.decode !== false, del: false};
}
function vfStash(w) {
  if (!w || !$('#vfTracks')) return;
  S.vf[w] = {tracks: $('#vfTracks').checked, decode: $('#vfDecode').checked, del: $('#deleteSource').checked};
}
function vfShow(w) {
  const v = S.vf[w] || (S.vf[w] = vfDefaults(w));
  $('#vfTracks').checked = v.tracks; $('#vfDecode').checked = v.decode; $('#deleteSource').checked = v.del;
  S.vfFor = w;
  vfUI();
}
// „Zurücksetzen“ und geänderte Standardwerte in den Einstellungen: zurück auf die Standardauswahl
function vfReset(w) { S.vf[w] = vfDefaults(w); if (S.vfFor === w) vfShow(w); }

// Zeitangaben in Worten (Schätzwerte, grob): Wie viel länger dauert der Auftrag durch die Prüfung?
function vfTime(w, kind) {
  if (kind === 'tracks') return ['kaum länger', 'Sekundenbruchteile je Datei'];
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
  $('#vfDelHint').classList.toggle('hidden', !del);
}

// was an den Server geht (Teil von output)
function vfCollect() {
  return {deleteSource: $('#deleteSource').checked, verifyTracks: $('#vfTracks').checked, verifyDecode: $('#vfDecode').checked};
}

function wireVerify() {
  S.vf = {};
  ['vfTracks', 'vfDecode', 'deleteSource'].forEach(id => $('#' + id).addEventListener('input', () => { vfStash(S.vfFor); vfUI(); }));
  $('#vCodec').addEventListener('input', vfUI);
}
