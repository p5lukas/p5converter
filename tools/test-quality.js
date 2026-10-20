// Test der Qualitätsstufen (web/quality.js). Aufruf: node tools/test-quality.js
const Q = require('../web/quality.js');
const assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; };

t('Stufen steigen: Sehr gut < Gut < Normal < Klein (Zahl wird größer) bei jedem Encoder und Codec', () => {
  for (const b of Object.keys(Q.TABLE)) for (const c of Object.keys(Q.TABLE[b])) {
    const v = Q.TABLE[b][c];
    assert.strictEqual(v.length, 4, b + '/' + c);
    for (let i = 1; i < 4; i++) assert.ok(v[i] > v[i - 1], `${b}/${c} nicht aufsteigend: ${v}`);
  }
});
t('alle Encoder haben alle vier Codecs', () => {
  for (const b of ['cpu', 'qsv', 'nvenc', 'vaapi', 'amf']) for (const c of ['h264', 'hevc', 'av1', 'vp9']) assert.ok(Q.TABLE[b][c], b + '/' + c);
});
t('Quick Sync liegt bei gleicher Stufe niedriger als NVENC (gleiche Zahl wäre dort deutlich kleiner)', () => {
  for (const c of ['h264', 'hevc', 'av1']) for (let i = 0; i < 4; i++) assert.ok(Q.TABLE.qsv[c][i] < Q.TABLE.nvenc[c][i], `${c} Stufe ${i}`);
});
t('Gut entspricht dem bisherigen Richtwert der CPU (niedrigster Wert der Bereiche)', () => {
  assert.strictEqual(Q.value('cpu', 'h264', 'good'), 18); assert.strictEqual(Q.value('cpu', 'hevc', 'good'), 20); assert.strictEqual(Q.value('cpu', 'av1', 'good'), 24);
});
t('Feste Zahlen: x265 auf der CPU 17 / 20 / 23 / 27, ohne Zu- oder Abschläge', () => {
  assert.deepStrictEqual(Q.STAGES.map(([id]) => Q.value('cpu', 'hevc', id)), [17, 20, 23, 27]);
});
t('Quelle schon klein: unter 4 Mbit/s bei 1080p, kleinere Bilder im Verhältnis', () => {
  assert.ok(Q.lowBitrate(3.2e6, 1080)); assert.ok(!Q.lowBitrate(8e6, 1080)); assert.ok(!Q.lowBitrate(0, 1080)); assert.ok(!Q.lowBitrate(3e6, 0));
  assert.ok(Q.lowBitrate(3e6, 2160)); assert.ok(!Q.lowBitrate(5e6, 2160)); assert.ok(Q.lowBitrate(1e6, 720)); assert.ok(!Q.lowBitrate(3e6, 720));
});
t('stageOf ist die Umkehrung von value, sonst „custom“', () => {
  for (const [id] of Q.STAGES) assert.strictEqual(Q.stageOf('qsv', 'hevc', Q.value('qsv', 'hevc', id)), id);
  assert.strictEqual(Q.stageOf('qsv', 'hevc', 22), 'custom');
  assert.strictEqual(Q.stageOf('cpu', 'copy', 22), 'custom');
});
t('Kopieren hat keine Zahl', () => { assert.strictEqual(Q.value('cpu', 'copy', 'good'), null); });
t('Name der Skala je Encoder', () => {
  assert.strictEqual(Q.scaleName('cpu'), 'CRF'); assert.strictEqual(Q.scaleName('nvenc'), 'CQ'); assert.strictEqual(Q.scaleName('qsv'), 'ICQ');
  assert.strictEqual(Q.scaleName('vaapi'), 'QP'); assert.strictEqual(Q.scaleName('amf'), 'QP'); assert.strictEqual(Q.scaleName('x'), 'CRF');
});
t('Stufennamen', () => { assert.strictEqual(Q.stageName('good'), 'Gut'); assert.strictEqual(Q.stageName('custom'), 'Eigener Wert'); });
console.log('quality: ' + n + ' Tests ok');
