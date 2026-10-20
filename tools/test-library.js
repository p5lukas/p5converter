// Test der Hinweise des Bibliothek-Scans (web/library.js): nur Fakten, nie einzelne Dateien. Aufruf: node tools/test-library.js
const LIB = require('../web/library.js');
const Q = require('../web/quality.js');
const assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; };
const row = o => ({path: '/lib/x', name: 'x', depth: 1, group: false, folders: 1, files: 4, bytes: 4e9, avgBitrate: 6e6, codecs: {hevc: 4}, maxHeight: 1080, heavy: {}, imageSubs: 0, unreadable: 0, ...o});
const ids = (r, low) => LIB.hints(r, low).map(x => x.id).join(',');

t('H.265 ohne Besonderheiten: kein Hinweis, lohnt sich nicht', () => { assert.strictEqual(ids(row({})), ''); assert.ok(!LIB.worth(row({}))); });
t('älterer Codec (H.264, MPEG-4 …) ist ein Hinweis, H.265/AV1/VP9 nicht', () => {
  assert.strictEqual(ids(row({codecs: {h264: 4}})), 'old'); assert.ok(LIB.worth(row({codecs: {h264: 4}})));
  assert.strictEqual(ids(row({codecs: {av1: 2, vp9: 2}})), '');
  const m = LIB.hints(row({codecs: {h264: 1, hevc: 3}}))[0].text; assert.ok(/1 von 4/.test(m), m);
});
t('hohe Bitrate hängt von der Höhe ab', () => {
  assert.ok(ids(row({avgBitrate: 9e6, maxHeight: 1080})).includes('high')); assert.ok(!ids(row({avgBitrate: 7e6, maxHeight: 1080})).includes('high'));
  assert.ok(ids(row({avgBitrate: 30e6, maxHeight: 2160})).includes('high')); assert.ok(!ids(row({avgBitrate: 20e6, maxHeight: 2160})).includes('high'));
  assert.ok(ids(row({avgBitrate: 3e6, maxHeight: 480})).includes('high'));
});
t('schwere Tonformate, DTS und Bild-Untertitel', () => {
  assert.ok(ids(row({heavy: {truehd: 2}})).includes('heavy')); assert.ok(ids(row({heavy: {dtshd: 1}})).includes('heavy'));
  assert.ok(ids(row({heavy: {dts: 3}})).includes('dts')); assert.ok(ids(row({imageSubs: 2})).includes('img'));
  assert.ok(LIB.worth(row({imageSubs: 1})));
});
t('„schon klein“ und „nicht lesbar“ sprechen nicht für das Umwandeln', () => {
  const r = row({codecs: {h264: 4}, avgBitrate: 2e6});
  assert.ok(ids(r, Q.lowBitrate).includes('small')); assert.ok(LIB.worth(r, Q.lowBitrate), 'älterer Codec bleibt ein Hinweis');
  const only = row({avgBitrate: 2e6, unreadable: 1});
  assert.strictEqual(ids(only, Q.lowBitrate), 'small,bad'); assert.ok(!LIB.worth(only, Q.lowBitrate));
});
t('Codec-Mix und Sortierung', () => {
  assert.strictEqual(LIB.mix({hevc: 2, h264: 3}), 'H.264 ×3 · H.265 ×2');
  const rows = [row({path: '/a', name: 'B', bytes: 1, avgBitrate: 9}), row({path: '/b', name: 'a', bytes: 9, avgBitrate: 1}), row({path: '/c', name: 'C', bytes: 5, avgBitrate: 5})];
  assert.deepStrictEqual(LIB.sortRows(rows, 'size').map(r => r.path), ['/b', '/c', '/a']);
  assert.deepStrictEqual(LIB.sortRows(rows, 'bitrate').map(r => r.path), ['/a', '/c', '/b']);
  assert.deepStrictEqual(LIB.sortRows(rows, 'name').map(r => r.name), ['a', 'B', 'C']);
  assert.deepStrictEqual(LIB.sortRows(rows, 'tree').map(r => r.path), ['/a', '/b', '/c']);
});
console.log('library: ' + n + ' Tests ok');
