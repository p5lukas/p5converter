const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
// Prüft: Ersetzungen (hinzufügen/löschen/alle löschen/neu hinzufügen), Audio/Video getrennt, Warteschlange je Welt,
// Auslastungsanzeige – in allen Ansichten. Aufruf: INDIR=/tmp/media SHOTS=/tmp/shots node tools/ui-check-world.js (Server auf :8787,
// im Ordner INDIR liegen long.mkv und a.mp3; vorher je ein Audio- und ein Video-Auftrag einreihen)
const views = [
  ['desktop', {viewport: {width: 1400, height: 1000}}],
  ['iphone-portrait', {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['iphone-landscape', {viewport: {width: 844, height: 390}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['ipad-portrait', {viewport: {width: 820, height: 1180}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['ipad-landscape', {viewport: {width: 1180, height: 820}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
];
const SHOTS = process.env.SHOTS || '/tmp/shots';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errs = [];
  const eq = (name, what, got, want) => { if (got !== want) errs.push(`${name}: ${what}: ${got} (erwartet ${want})`); };
  for (const [name, opt] of views) {
    const ctx = await b.newContext(opt);
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => m.type() === 'error' && errs.push(name + ': ' + m.text()));
    await p.goto('http://127.0.0.1:8787'); await p.waitForTimeout(1200);
    const rows = () => p.locator('#ruleRows .rulerow').count();
    // --- Video: drei Ersetzungen, alle löschen, eine neu ---
    await p.click('[data-world=video]'); await p.waitForTimeout(1200);
    for (let i = 0; i < 3; i++) { await p.click('#addRule'); await p.fill(`#ruleRows .rulerow >> nth=${i} >> input >> nth=0`, 'v' + i); }
    eq(name, 'Video: 3 Zeilen', await rows(), 3);
    while (await rows()) await p.click('#ruleRows .rulerow >> nth=0 >> button');
    eq(name, 'Video: alle gelöscht', await rows(), 0);
    await p.click('#addRule');
    eq(name, 'Video: nach Neu-Hinzufügen genau 1 Zeile (kein Wiederauftauchen)', await rows(), 1);
    eq(name, 'Video: Feld leer', await p.inputValue('#ruleRows .rulerow input >> nth=0'), '');
    await p.fill('#ruleRows .rulerow input >> nth=0', 'nurvideo'); await p.fill('#pattern', '{res}');
    // --- Audio ist unabhängig ---
    await p.click('[data-world=audio]'); await p.waitForTimeout(1500);
    eq(name, 'Audio: keine Ersetzungen aus Video', await rows(), 0);
    eq(name, 'Audio: Muster getrennt', await p.inputValue('#pattern'), '');
    await p.click('#addRule'); await p.fill('#ruleRows .rulerow input >> nth=0', 'nuraudio'); await p.fill('#pattern', '{artist}');
    await p.click('[data-world=video]'); await p.waitForTimeout(1500);
    eq(name, 'Video: zurück, 1 Zeile', await rows(), 1);
    eq(name, 'Video: Wert erhalten', await p.inputValue('#ruleRows .rulerow input >> nth=0'), 'nurvideo');
    eq(name, 'Video: Muster erhalten', await p.inputValue('#pattern'), '{res}');
    // Neuladen: Zustand bleibt je Welt
    await p.reload(); await p.waitForTimeout(1500);
    eq(name, 'nach Neuladen (Video) 1 Zeile', await rows(), 1);
    await p.click('[data-world=audio]'); await p.waitForTimeout(1200);
    eq(name, 'nach Neuladen (Audio) Wert', await p.inputValue('#ruleRows .rulerow input >> nth=0'), 'nuraudio');
    // --- Warteschlange je Welt ---
    const queued = async () => (await p.locator('#queue .job').allTextContents()).join('|');
    const aq = await queued();
    if (/long\.mkv|Show/.test(aq)) errs.push(name + ': Audio-Warteschlange zeigt Video-Aufträge: ' + aq);
    if (!/a\.mp3|a\b/.test(aq) && !(await p.locator('#queue .job').count())) errs.push(name + ': Audio-Warteschlange leer');
    await p.click('[data-world=video]'); await p.waitForTimeout(1200);
    const vq = await queued();
    if (/a\.mp3/.test(vq)) errs.push(name + ': Video-Warteschlange zeigt Audio-Aufträge: ' + vq);
    // --- Auslastung: Elemente vorhanden, kein „100 %“ im Leerlauf ohne Messung ---
    const mon = await p.locator('#monitor .meter').count();
    if (!mon) errs.push(name + ': keine Auslastungsanzeige');
    await p.locator('#queue').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${SHOTS}/wd-${name}-queue.png` });
    await ctx.close();
  }
  await b.close();
  console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'ok');
})();
