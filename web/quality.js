'use strict';
/* Qualität in Stufen statt einer CRF-Zahl (reine Logik, mit Node getestet: tools/test-quality.js).
   Dieselbe Zahl bedeutet bei CPU (x264/x265: CRF), NVIDIA (CQ), Intel Quick Sync (ICQ), VAAPI und AMD (QP) nicht dasselbe – darum gibt es vier Stufen,
   und das Programm rechnet sie je Encoder und Codec auf die passende Zahl um.
   Die Tabelle sind Startwerte aus Anleitungen und Erfahrung, NICHT auf echter Hardware gemessen. Stehen dort Bereiche, gilt der niedrigere Wert
   (bessere Qualität). Intel Quick Sync liegt bei gleicher Zahl erfahrungsgemäß deutlich kleiner (also schwächer) als NVENC; deshalb sind die Zahlen dort niedriger. */
const Q = (() => {
  const STAGES = [['very', 'Sehr gut', 'groß'], ['good', 'Gut', 'empfohlen'], ['normal', 'Normal', 'kleiner'], ['small', 'Klein', 'weich']];
  // je Encoder und Codec: Zahl für [Sehr gut, Gut, Normal, Klein]
  const TABLE = {
    cpu:   {h264: [15, 18, 21, 25], hevc: [17, 20, 23, 27], av1: [20, 24, 28, 34], vp9: [22, 27, 31, 36]},
    qsv:   {h264: [15, 18, 22, 26], hevc: [16, 19, 23, 27], av1: [18, 22, 26, 31], vp9: [18, 22, 26, 31]},
    nvenc: {h264: [18, 21, 25, 29], hevc: [19, 23, 27, 31], av1: [22, 27, 31, 36], vp9: [19, 23, 27, 31]},
    vaapi: {h264: [17, 21, 25, 29], hevc: [18, 22, 26, 30], av1: [20, 25, 29, 34], vp9: [18, 22, 26, 30]},
    amf:   {h264: [17, 21, 25, 29], hevc: [18, 22, 26, 30], av1: [20, 25, 29, 34], vp9: [18, 22, 26, 30]},
  };
  // Name der Zahl je Encoder (Erweitert zeigt ihn neben dem Regler)
  const SCALE = {cpu: 'CRF', nvenc: 'CQ', qsv: 'ICQ', vaapi: 'QP', amf: 'QP'};
  const SCALE_HELP = {CRF: 'Constant Rate Factor (x264, x265, AV1, VP9 auf der CPU)', CQ: 'Constant Quality (NVIDIA NVENC)', ICQ: 'Intelligent Constant Quality (Intel Quick Sync)', QP: 'Quantisierungsparameter (VAAPI, AMD AMF)'};
  // Art des Materials: Abzug (Anime/Zeichentrick brauchen eine niedrigere Zahl, Korn etwas niedriger)
  const MATERIAL = {standard: 0, modern: 0, grain: -2, anime: -4, cartoon: -4, home: 0};
  const clamp = n => Math.max(10, Math.min(51, Math.round(n)));

  const row = (backend, codec) => (TABLE[backend] || TABLE.cpu)[codec] || null;
  function offset(material, height) { return (MATERIAL[material] || 0) + (height && height <= 720 ? -1 : 0); }
  // Zahl für eine Stufe; null = für diesen Codec gibt es keinen Richtwert (z. B. Kopieren)
  function value(backend, codec, stage, material, height) {
    const r = row(backend, codec), i = STAGES.findIndex(s => s[0] === stage);
    if (!r || i < 0) return null;
    return clamp(r[i] + offset(material, height));
  }
  // welche Stufe gehört zu dieser Zahl? 'custom' = eigener Wert
  function stageOf(backend, codec, crf, material, height) {
    const n = +crf;
    for (const [id] of STAGES) if (value(backend, codec, id, material, height) === n) return id;
    return 'custom';
  }
  const scaleName = backend => SCALE[backend] || 'CRF';
  const stageName = id => (STAGES.find(s => s[0] === id) || [])[1] || 'Eigener Wert';
  return {STAGES, TABLE, SCALE, SCALE_HELP, MATERIAL, value, stageOf, scaleName, stageName, offset};
})();
if (typeof module !== 'undefined') module.exports = Q;
