// Test der Monatsgrafik (web/statschart.js): Monatsreihe, Namen, Dauer. Aufruf: node tools/test-statschart.js
const assert = require('assert');
(async () => {
  const { lastMonths, monthName, fmtDuration } = await import('../web/statschart.js');
  let n = 0;
  const t = (name, fn) => { fn(); n++; };
  t('letzte zwölf Monate bis zum aktuellen, fehlende mit Nullen', () => {
    const m = lastMonths([{month: '2026-11', count: 3, in: 30, out: 10, seconds: 50}, {month: '2026-02', count: 1, in: 9, out: 4, seconds: 5}], 12, new Date(2026, 10, 15));
    assert.strictEqual(m.length, 12); assert.strictEqual(m[0].month, '2025-12'); assert.strictEqual(m[11].month, '2026-11');
    assert.deepStrictEqual(m[11], {month: '2026-11', count: 3, in: 30, out: 10, seconds: 50});
    assert.strictEqual(m[2].month, '2026-02'); assert.strictEqual(m[2].count, 1); assert.strictEqual(m[5].count, 0);
  });
  t('Jahreswechsel', () => {
    const m = lastMonths([], 3, new Date(2027, 0, 5));
    assert.deepStrictEqual(m.map(x => x.month), ['2026-11', '2026-12', '2027-01']);
  });
  t('Monatsnamen', () => { assert.strictEqual(monthName('2026-03'), 'Mär'); assert.strictEqual(monthName('2026-11', true), 'November 2026'); });
  t('Dauer in Worten', () => {
    assert.strictEqual(fmtDuration(0), '0 s'); assert.strictEqual(fmtDuration(45), '45 s'); assert.strictEqual(fmtDuration(600), '10 min');
    assert.strictEqual(fmtDuration(3600), '1 h '); assert.strictEqual(fmtDuration(12000), '3 h 20 min');
  });
  console.log('statschart: ' + n + ' Tests ok');
})().catch(e => { console.error(e); process.exit(1); });
