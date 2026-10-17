'use strict';
/* Automatischer CRF-Vorschlag (Faustregel-Tabelle, keine Messung).
   Startwerte aus Anleitungen/Foren (x264/x265/AV1); steht dort ein Bereich, gilt der NIEDRIGERE Wert (bessere Qualität).
   Nutzt S, $, h(), cfg() aus app.js/settings.js und TRK/trkProbe aus tracks.js. */

// Grundwert je Codec (Richtwerte der Oberfläche: x264 18–23, x265 20–26, AV1 24–32 → jeweils der niedrigere)
const CRF_BASE = {h264: 18, hevc: 20, av1: 24};
// Art des Materials: Abzug vom Grundwert (Anime/Zeichentrick x265 16–20 → 16; Korn/altes Material 18–22 → 18)
const CRF_MATERIAL = {
  standard: {name: 'Standard (Film/Serie)', off: 0, why: 'normaler Realfilm: Richtwert x265 20–25, genommen wird der niedrigere Wert.'},
  modern: {name: 'Aktueller Film (Blockbuster)', off: 0, why: 'sauberes digitales Bild braucht keinen Sonderwert, es gilt der Standard.'},
  grain: {name: 'Altes Material / mit Filmkorn', off: -2, why: 'Korn und feine Details kosten viele Bits und verschmieren leicht; deshalb etwas niedriger (x265 ca. 18–22 → 18).'},
  anime: {name: 'Anime', off: -4, why: 'auf glatten Flächen und Linien fallen Blöcke und Streifen sofort auf; üblich ist x265 16–20 → 16.'},
  cartoon: {name: 'Zeichentrick', off: -4, why: 'große einfarbige Flächen zeigen Artefakte schnell; üblich ist x265 16–20 → 16.'},
  home: {name: 'Heimvideo / Handyvideo', off: 0, why: 'wie Standard; sehr verrauschtes Material lässt sich schlecht komprimieren, hier hilft ein etwas niedrigerer Wert nur bedingt.'},
};

// Vorschlag aus Codec, Material und Zielhöhe (0 = wie Quelle → Höhe der ersten Datei, falls bekannt)
function crfSuggest(codec, material, height) {
  const base = CRF_BASE[codec], m = CRF_MATERIAL[material] || CRF_MATERIAL.standard;
  if (base == null) return null;
  const parts = [m.why];
  let crf = base + m.off;
  if (height && height <= 720) { crf -= 1; parts.push('Bei 720p oder kleiner etwas niedriger (−1), weil jedes Bild weniger Punkte hat.'); }
  return {crf: Math.max(10, crf), text: parts.join(' ')};
}

async function crfSourceHeight() {
  const f = S.files.video[0];
  if (!f) return 0;
  try { const info = await trkProbe(f); const v = (info.streams || []).find(s => s.type === 'video' && !s.attachedPic); return v ? v.height || 0 : 0; } catch (e) { return 0; }
}

// zeigt/versteckt die Auswahl und füllt den Regler vor (außer der Nutzer hat ihn selbst bewegt)
async function crfRefresh(force) {
  const on = cfg().noCrfSuggest !== true, copy = $('#vCodec').value === 'copy';
  $('#vMatRow').classList.toggle('hidden', !on || copy);
  const hint = $('#vCrfWhy');
  if (!on || copy) { hint.textContent = ''; return; }
  const h0 = +$('#vHeight').value || await crfSourceHeight();
  const s = crfSuggest($('#vCodec').value, $('#vMaterial').value, h0);
  if (!s) { hint.textContent = 'Für diesen Codec gibt es keinen Richtwert.'; return; }
  const hw = (typeof resolveBackend === 'function' && resolveBackend().id !== 'cpu');
  if (force || !S.crfManual) { $('#vCrf').value = s.crf; $('#vCrfOut').textContent = s.crf; S.crfManual = false; }
  const diff = +$('#vCrf').value !== s.crf;
  hint.textContent = 'Empfehlung: CRF ' + s.crf + ' – ' + s.text + (hw ? ' Bei Hardware-Encodern ist das nur ein grober Anhaltspunkt.' : '') + (diff ? ' (Du hast den Regler geändert.)' : '');
  $('#vCrfSet').classList.toggle('hidden', !diff);
  $('#vCrfSet').textContent = 'Empfehlung ' + s.crf + ' setzen';
  S.crfRec = s.crf;
}
function wireCrf() {
  S.crfManual = true; // gespeicherter Reglerwert bleibt beim Start; erst Material-/Codec-Wechsel füllt neu vor
  $('#vMaterial').addEventListener('input', () => { S.crfManual = false; crfRefresh(true); saveSettings(); });
  ['vCodec', 'vHeight', 'vBackend'].forEach(id => $('#' + id).addEventListener('input', () => { if (id === 'vCodec') S.crfManual = false; crfRefresh(id === 'vCodec'); }));
  $('#vCrf').addEventListener('input', () => { S.crfManual = true; crfRefresh(false); });
  $('#vCrfSet').onclick = () => { S.crfManual = false; crfRefresh(true); saveSettings(); };
}
