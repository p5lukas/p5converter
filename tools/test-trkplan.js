// Test der reinen Logik von „Audio & Untertitel“ (web/trkplan.js). Aufruf: node tools/test-trkplan.js
const TP = require('../web/trkplan.js');
const assert = require('assert');
const A = (index, lang, codec, ch, extra) => ({index, type: 'audio', lang, codec, channels: ch, ...extra});
const S = (index, lang, codec, extra) => ({index, type: 'subtitle', lang, codec: codec || 'subrip', ...extra});
const base = {audioMode: 'copy', subMode: 'copy', audioRules: [], subRules: [], usePrefs: true, prefs: {}};
const P = (streams, manual, cfg) => TP.plan({streams}, manual, {...base, ...cfg});
let n = 0;
const t = (name, fn) => { fn(); n++; };

t('Regel nach Codec: nur DTS wird umgewandelt, AC-3 bleibt', () => {
  const p = P([A(1, 'ger', 'dts', 6), A(2, 'eng', 'ac3', 6)], {}, {audioRules: [{codec: 'dts', action: 'encode', to: 'ac3', kbps: 192}]});
  assert.deepStrictEqual(p.edits[1], {action: 'encode', codec: 'ac3', kbps: 192});
  assert.strictEqual(p.edits[2], undefined);
  assert.ok(p.tracks[0].why[0].includes('DTS'));
});
t('DTS-HD-Regel trifft nur DTS-HD, „DTS (alle)“ trifft beides', () => {
  const hd = A(1, 'ger', 'dts', 8, {profile: 'DTS-HD MA'}), core = A(2, 'ger', 'dts', 6, {profile: 'DTS'});
  const p = P([hd, core], {}, {audioRules: [{codec: 'dtshd', action: 'drop'}]});
  assert.strictEqual(p.tracks[0].kept, false); assert.strictEqual(p.tracks[1].kept, true);
  const q = P([hd, core], {}, {audioRules: [{codec: 'dts', action: 'drop'}]});
  assert.ok(!q.tracks[0].kept && !q.tracks[1].kept);
});
t('erste passende Regel gewinnt', () => {
  const p = P([A(1, 'ger', 'dts', 6)], {}, {audioRules: [{codec: 'dts', action: 'drop'}, {codec: 'any', action: 'encode', to: 'aac'}]});
  assert.strictEqual(p.tracks[0].kept, false);
});
t('Kanal-Bedingung', () => {
  const p = P([A(1, 'ger', 'ac3', 6), A(2, 'ger', 'ac3', 2)], {}, {audioRules: [{codec: 'ac3', ch: 'multi', action: 'drop'}]});
  assert.ok(!p.tracks[0].kept && p.tracks[1].kept);
});
t('Sprach-Liste entfernt andere Sprachen, unbekannte bleiben', () => {
  const p = P([A(1, 'ger', 'ac3', 6), A(2, 'fre', 'ac3', 6), A(3, 'und', 'ac3', 2), A(4, 'eng', 'ac3', 2)], {}, {prefs: {audioKeep: ['ger', 'eng']}});
  assert.deepStrictEqual(p.tracks.map(r => r.kept), [true, false, true, true]);
  assert.strictEqual(p.edits[2].action, 'drop');
});
t('Sprachcodes werden gleich behandelt (de = ger)', () => {
  const p = P([A(1, 'de', 'ac3', 6), A(2, 'fra', 'ac3', 6)], {}, {prefs: {audioKeep: ['ger']}});
  assert.deepStrictEqual(p.tracks.map(r => r.kept), [true, false]);
});
t('keine der gewünschten Sprachen: nichts wird entfernt, Hinweis (guard)', () => {
  const p = P([A(1, 'fre', 'ac3', 6), A(2, 'spa', 'ac3', 6)], {}, {prefs: {audioKeep: ['ger', 'eng']}});
  assert.ok(p.tracks.every(r => r.kept)); assert.strictEqual(p.guard.audio, true); assert.deepStrictEqual(p.edits, {});
});
t('eigene Änderung geht vor Regel und Sprach-Liste', () => {
  const p = P([A(1, 'ger', 'ac3', 6), A(2, 'fre', 'ac3', 6)], {2: {action: 'copy'}, 1: {action: 'drop'}}, {prefs: {audioKeep: ['ger']}});
  assert.deepStrictEqual(p.tracks.map(r => r.kept), [false, true]);
  assert.strictEqual(p.edits[2].action, 'copy');
});
t('Sprach-Wünsche lassen sich abschalten (usePrefs=false)', () => {
  const p = P([A(1, 'ger', 'ac3', 6), A(2, 'fre', 'ac3', 6)], {}, {usePrefs: false, prefs: {audioKeep: ['ger'], audioDefault: ['fre']}});
  assert.ok(p.tracks.every(r => r.kept)); assert.deepStrictEqual(p.edits, {});
});
t('Standard-Audio nach Rangliste, Kommentarspur wird übersprungen', () => {
  const p = P([A(1, 'eng', 'ac3', 6, {default: true}), A(2, 'ger', 'ac3', 6, {title: 'Kommentar'}), A(3, 'ger', 'ac3', 6)], {}, {prefs: {audioDefault: ['ger', 'eng']}});
  assert.strictEqual(p.edits[3].default, true); assert.strictEqual(p.edits[1].default, false);
  assert.strictEqual(p.edits[2], undefined);
});
t('Standard-Audio: zweite Wahl, wenn die erste Sprache fehlt', () => {
  const p = P([A(1, 'fre', 'ac3', 6, {default: true}), A(2, 'eng', 'ac3', 6)], {}, {prefs: {audioDefault: ['ger', 'eng']}});
  assert.strictEqual(p.edits[2].default, true);
});
t('manuell gesetzte Standard-Tonspur schaltet die Rangliste ab', () => {
  const p = P([A(1, 'ger', 'ac3', 6), A(2, 'eng', 'ac3', 6)], {2: {default: true}}, {prefs: {audioDefault: ['ger']}});
  assert.strictEqual(p.edits[1], undefined); assert.strictEqual(p.edits[2].default, true);
});
t('Standard-Untertitel „Deutsch Forced“', () => {
  const p = P([S(5, 'ger', 'subrip', {default: true}), S(6, 'ger', 'subrip', {forced: true}), S(7, 'eng')], {}, {prefs: {subDefault: [{lang: 'ger', forced: true}, {lang: 'ger', forced: false}]}});
  assert.strictEqual(p.edits[6].default, true); assert.strictEqual(p.edits[5].default, false); assert.strictEqual(p.edits[7], undefined);
});
t('Standard-Untertitel: nichts gefunden → nichts geändert', () => {
  const p = P([S(5, 'eng', 'subrip', {default: true})], {}, {prefs: {subDefault: [{lang: 'ger', forced: true}]}});
  assert.deepStrictEqual(p.edits, {});
});
t('Untertitel-Regel: Bild-Untertitel entfernen, Text bleibt', () => {
  const p = P([S(5, 'ger', 'hdmv_pgs_subtitle'), S(6, 'ger', 'subrip')], {}, {subRules: [{kind: 'image', action: 'drop'}]});
  assert.ok(!p.tracks[0].kept && p.tracks[1].kept);
});
t('Untertitel allgemein „entfernen“ (subMode none): nur ausdrücklich Gewähltes bleibt', () => {
  const p = P([S(5, 'ger'), S(6, 'eng')], {6: {action: 'copy'}}, {subMode: 'none'});
  assert.deepStrictEqual(p.tracks.map(r => r.kept), [false, true]);
});
t('Gruppen-Schlüssel: nur Sprachen, Reihenfolge und Codec egal', () => {
  const a = TP.signature({streams: [A(1, 'ger', 'dts', 6), A(2, 'eng', 'ac3', 2), S(3, 'de')]});
  const b = TP.signature({streams: [A(1, 'eng', 'aac', 2), A(2, 'de', 'ac3', 6), S(3, 'ger')]});
  assert.strictEqual(a.key, b.key); assert.deepStrictEqual(a.audio, ['eng', 'ger']);
});
t('Zusammenfassung zählt Wirkung', () => {
  const p = P([A(1, 'ger', 'dts', 6), A(2, 'fre', 'ac3', 6), A(3, 'ger', 'ac3', 2)], {}, {audioRules: [{codec: 'dts', action: 'encode', to: 'ac3'}], prefs: {audioKeep: ['ger'], audioDefault: ['ger']}});
  assert.deepStrictEqual(TP.summarize(p), {dropLang: 1, dropRule: 0, dropOwn: 0, encode: 1, defaults: 1});
});
console.log('trkplan: ' + n + ' Tests ok');
