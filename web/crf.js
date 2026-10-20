'use strict';
/* Qualität in Stufen (Sehr gut / Gut / Normal / Klein) statt einer CRF-Zahl; die Zahlen stehen in quality.js (Q).
   Die Zahl (#vCrf) bleibt das, was an den Server geht; die Stufe (#vQuality) ist die Auswahl des Nutzers: das Programm rechnet sie je Encoder, Codec,
   Material und Zielhöhe um. Bewegt man den Regler (Erweitert), wird die Stufe aus der Zahl abgeleitet oder steht auf „Eigener Wert“.
   Nutzt S, $, h(), cfg(), resolveBackend() aus app.js/settings.js. */

function qCurrent() {
  const r = resolveBackend();
  return {backend: r.id, codec: $('#vCodec').value};
}
const qSig = (c, st) => [c.backend, c.codec, st].join('/');
// Stufe → Zahl; nur wenn sich Encoder, Codec oder Stufe geändert haben (sonst würde ein bewegter Regler zurückspringen)
function qApply() {
  const c = qCurrent(), st = $('#vQuality').value, sig = qSig(c, st);
  if (sig === S.qSig) return;
  S.qSig = sig;
  if (st === 'custom') return;
  const v = Q.value(c.backend, c.codec, st);
  if (v != null) $('#vCrf').value = v;
}
// Zahl → Stufe (Regler bewegt, Voreinstellung ohne Stufe geladen)
function qSync() {
  const c = qCurrent(), st = c.codec === 'copy' ? $('#vQuality').value : Q.stageOf(c.backend, c.codec, $('#vCrf').value);
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
  $('#vQualityRow').classList.toggle('hidden', copy);
  const out = $('#vCrfOut'); out.textContent = $('#vCrf').value;
  const lab = $('#vCrfLabel'); if (lab && lab.firstChild) lab.firstChild.textContent = 'Zahl dahinter (' + scale + ') ';
  const hint = $('#vCrfWhy');
  if (copy) { hint.textContent = ''; }
  else {
    hint.textContent = (st === 'custom' ? 'Eigener Wert ' + $('#vCrf').value + ' (' + scale + ').' : 'Stufe „' + Q.stageName(st) + '“ = ' + scale + ' ' + $('#vCrf').value + '.') +
      ' Die Zahlen sind zwischen Encodern nicht vergleichbar (' + (Q.SCALE_HELP[scale] || scale) + '); die Stufen sind Startwerte, nicht auf deiner Hardware gemessen.';
  }
  if (typeof renderQualityControls === 'function') renderQualityControls();
}
function wireCrf() {
  $('#vCrf').addEventListener('input', () => { qSync(); crfRefresh(); });
}
