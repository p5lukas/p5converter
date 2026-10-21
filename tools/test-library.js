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
t('Filter-Kärtchen: ein Ordner bleibt, wenn mindestens ein gewählter Hinweis zutrifft', () => {
  const old = row({codecs: {h264: 4}}), high = row({avgBitrate: 9e6}), both = row({codecs: {h264: 4}, avgBitrate: 9e6}), dts = row({heavy: {dts: 1}}), none = row({}), small = row({avgBitrate: 2e6});
  const m = (r, ...on) => LIB.matches(r, new Set(on), Q.lowBitrate);
  assert.ok(m(old, 'old') && !m(old, 'high') && m(old, 'high', 'old'));
  assert.ok(m(high, 'high') && !m(high, 'old'));
  assert.ok(m(both, 'old') && m(both, 'high'));
  assert.ok(m(dts, 'heavy'), 'DTS zählt zu „Schwerer Ton / DTS“');
  assert.ok(!m(none, 'old', 'high', 'heavy', 'img', 'small'));
  assert.ok(m(small, 'small') && !m(small, 'old', 'high', 'heavy', 'img'));
  assert.ok(!m(old), 'kein Kärtchen gewählt: nichts passt');
  assert.deepStrictEqual(LIB.FILTER_DEFAULT, ['old', 'high', 'heavy', 'img']);
  const c = LIB.filterCounts([old, high, both, dts, none, small], Q.lowBitrate);
  assert.deepStrictEqual(c, {old: 2, high: 2, heavy: 1, img: 0, small: 1});
});
t('Anzeigename: Serie vor Staffelordnern, ohne {tvdb-…}', () => {
  const season = row({path: '/video2/Serien/Chernobyl (2019) {tvdb-360893}/Season 01', name: 'Season 01'});
  assert.deepStrictEqual(LIB.title(season, new Set(), true), {series: 'Chernobyl (2019)', name: 'Season 01', up: '/video2/Serien'});
  assert.strictEqual(LIB.title(season, new Set(), false).series, 'Chernobyl (2019)', 'flache Liste: immer mit Serie');
  // im Ordnerbaum steht die Sammelzeile der Serie darüber: kein Wiederholen
  const grp = new Set(['/video2/Serien/Chernobyl (2019) {tvdb-360893}']);
  assert.strictEqual(LIB.title(season, grp, true).series, '');
  assert.strictEqual(LIB.title(season, grp, false).series, 'Chernobyl (2019)', 'flach auch bei sichtbarer Sammelzeile mit Serie');
  // Ordner, die keine Staffel sind, und Sammelzeilen bleiben unter ihrem Namen (bereinigt)
  assert.deepStrictEqual(LIB.title(row({path: '/video2/Serien/1923 (2022) {tvdb-416491}', name: '1923 (2022) {tvdb-416491}', group: true}), new Set(), true), {series: '', name: '1923 (2022)', up: '/video2/Serien'});
  assert.strictEqual(LIB.title(row({path: '/video2/Filme/Alien (1979)', name: 'Alien (1979)'}), new Set(), true).series, '');
  for (const n of ['Season 01', 'Season 1', 'Staffel 2', 'S03', 'Series 4', 'Specials', 'Extras']) assert.ok(LIB.seasonLike(n), n);
  for (const n of ['Season', '1923 (2022)', 'Seasoned', 'Alien']) assert.ok(!LIB.seasonLike(n), n);
  assert.strictEqual(LIB.clean('The Lost Room (2006) {tvdb-79637}'), 'The Lost Room (2006)');
  assert.strictEqual(LIB.clean('Film [imdb-tt123] HD'), 'Film HD');
  assert.strictEqual(LIB.nf(15360), '15.360');
});
console.log('library: ' + n + ' Tests ok');
