'use strict';
/* Qualität in Stufen (Sehr gut / Gut / Normal / Klein) statt einer CRF-Zahl; die Zahlen stehen in quality.js (Q).
   Die Zahl (#vCrf) bleibt das, was an den Server geht; die Stufe (#vQuality) ist die Auswahl des Nutzers: das Programm rechnet sie je Encoder, Codec,
   Material und Zielhöhe um. Bewegt man den Regler (Erweitert), wird die Stufe aus der Zahl abgeleitet oder steht auf „Eigener Wert“.
   Nutzt S, $, h(), cfg(), resolveBackend() aus app.js/settings.js. */

const qMaterialOn = () => cfg().noCrfSuggest !== true;
const qHeight = () => +$('#vHeight').value || S.srcHeight || 0;
function qCurrent() {
  const r = resolveBackend();
  return {backend: r.id, codec: $('#vCodec').value, mat: qMaterialOn() ? $('#vMaterial').value : 'standard', height: qHeight()};
}
const qSig = (c, st) => [c.backend, c.codec, st, c.mat, c.height].join('/');
// Stufe → Zahl; nur wenn sich Encoder, Codec, Material, Höhe oder Stufe geändert haben (sonst würde ein bewegter Regler zurückspringen)
function qApply() {
  const c = qCurrent(), st = $('#vQuality').value, sig = qSig(c, st);
  if (sig === S.qSig) return;
  S.qSig = sig;
  if (st === 'custom') return;
  const v = Q.value(c.backend, c.codec, st, c.mat, c.height);
  if (v != null) $('#vCrf').value = v;
}
// Zahl → Stufe (Regler bewegt, Voreinstellung ohne Stufe geladen)
function qSync() {
  const c = qCurrent(), st = c.codec === 'copy' ? $('#vQuality').value : Q.stageOf(c.backend, c.codec, $('#vCrf').value, c.mat, c.height);
  $('#vQuality').value = st; S.qSig = qSig(c, st);
}
// Nach dem Laden einer Voreinstellung: hat sie eine Stufe, gilt sie für den jetzigen Encoder; sonst wird die Stufe aus der Zahl abgeleitet
function qAfterPreset(values) {
  if (values && values.vQuality && values.vQuality !== 'custom') { S.qSig = null; qApply(); } else qSync();
}
function qSetStage(st) { setField('vQuality', st); S.qSig = null; qApply(); $('#vCrf').dispatchEvent(new Event('input', {bubbles: true})); }

// Text neben dem Regler und Name der Zahl (CRF/CQ/ICQ/QP)
function crfRefresh() {
  const c = qCurrent(), copy = c.codec === 'copy', scale = Q.scaleName(c.backend), st = $('#vQuality').value;
  $('#vMatRow').classList.toggle('hidden', !qMaterialOn() || copy);
  $('#vQualityRow').classList.toggle('hidden', copy);
  const out = $('#vCrfOut'); out.textContent = $('#vCrf').value;
  const lab = $('#vCrfLabel'); if (lab && lab.firstChild) lab.firstChild.textContent = 'Zahl dahinter (' + scale + ') ';
  const hint = $('#vCrfWhy');
  if (copy) { hint.textContent = ''; }
  else {
    const mat = qMaterialOn() && c.mat !== 'standard' ? ' Material: ' + (CRF_MATERIAL[c.mat] || {name: c.mat}).name + ' (' + (Q.MATERIAL[c.mat] || 0) + ').' : '';
    hint.textContent = (st === 'custom' ? 'Eigener Wert ' + $('#vCrf').value + ' (' + scale + ').' : 'Stufe „' + Q.stageName(st) + '“ = ' + scale + ' ' + $('#vCrf').value + '.') + mat +
      ' Die Zahlen sind zwischen Encodern nicht vergleichbar (' + (Q.SCALE_HELP[scale] || scale) + '); die Stufen sind Startwerte, nicht auf deiner Hardware gemessen.';
  }
  if (typeof renderQualityControls === 'function') renderQualityControls();
}
// Art des Materials (Beschriftung und Begründung wie bisher)
const CRF_MATERIAL = {
  standard: {name: 'Standard (Film/Serie)'}, modern: {name: 'Aktueller Film (Blockbuster)'}, grain: {name: 'Altes Material / mit Filmkorn'},
  anime: {name: 'Anime'}, cartoon: {name: 'Zeichentrick'}, home: {name: 'Heimvideo / Handyvideo'},
};

async function crfSourceHeight() {
  const f = S.files.video[0];
  if (!f) return 0;
  try { const info = await trkProbe(f); const v = (info.streams || []).find(s => s.type === 'video' && !s.attachedPic); return v ? v.height || 0 : 0; } catch (e) { return 0; }
}
// Höhe der Quelle merken (für „Auflösung wie Quelle“ bei 720p und kleiner)
async function crfLoadSourceHeight() {
  const h0 = await crfSourceHeight();
  if (h0 !== S.srcHeight) { S.srcHeight = h0; if (typeof refreshVideoUI === 'function') refreshVideoUI(); if (typeof saveSettings === 'function') saveSettings(); if (typeof cvRender === 'function') cvRender(); }
}
function wireCrf() {
  $('#vCrf').addEventListener('input', () => { qSync(); crfRefresh(); });
  $('#vMaterial').addEventListener('input', () => { saveSettings(); });
}
