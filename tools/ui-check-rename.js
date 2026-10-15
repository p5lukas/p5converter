const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
// Prüft Symbole (keine bunten Emojis), Kopfzeile, Namensmuster + Ersetzungen + Vorschau und die Seite „Umbenennen“ in allen Ansichten.
// Aufruf: INDIR=/tmp/media SHOTS=/tmp/shots node tools/ui-check-rename.js   (Server läuft auf :8787)
const views = [
  ['desktop', {viewport: {width: 1400, height: 1000}}],
  ['iphone-portrait', {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['iphone-landscape', {viewport: {width: 844, height: 390}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['ipad-portrait', {viewport: {width: 820, height: 1180}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['ipad-landscape', {viewport: {width: 1180, height: 820}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
];
const INDIR = process.env.INDIR || '/tmp/media', SHOTS = process.env.SHOTS || '/tmp/shots';
const EMOJI = /\p{Emoji_Presentation}|[⚙⚠⚡⬆▶✎✦⭐]/u; // echte Emojis und iOS-anfällige Zeichen
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errs = [];
  for (const [name, opt] of views) {
    const ctx = await b.newContext(opt);
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => m.type() === 'error' && errs.push(name + ': ' + m.text()));
    await p.goto('http://127.0.0.1:8787'); await p.waitForTimeout(1200);
    await p.click('[data-world=video]'); await p.waitForTimeout(1500);
    await p.screenshot({ path: `${SHOTS}/rn-${name}-head.png` });
    await p.click('#addFiles'); await p.waitForTimeout(300);
    await p.fill('#bPath', INDIR); await p.click('#bGo'); await p.waitForTimeout(400);
    await p.click('#bList .bi:has-text("Show S01E01")'); await p.click('#bAddSel'); await p.waitForTimeout(400);
    await p.selectOption('#vCodec', 'hevc'); await p.selectOption('#vHeight', '720');
    await p.fill('#pattern', '{filename} [{res}][{codec}]');
    await p.click('#addRule'); await p.fill('.rulerow input >> nth=0', 'webdl'); await p.fill('.rulerow input >> nth=1', 'WEB');
    await p.waitForTimeout(700);
    const prev = await p.textContent('#namePreview');
    if (!/WEB-1080p\] \[720p\]\[x265\]\.mkv/.test(prev)) errs.push(name + ': Vorschau unerwartet: ' + prev);
    await p.locator('#nameBox').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${SHOTS}/rn-${name}-namebox.png` });
    const bodyText = await p.evaluate(() => [...document.querySelectorAll('header, main, dialog')].map(e => e.innerText).join('\n'));
    // Planeten sind SVGs; im Text darf kein buntes Emoji vorkommen
    const bad = bodyText.match(EMOJI); if (bad) errs.push(name + ': Emoji im Text: ' + bad[0]);
    // Umbenennen-Seite
    await p.click('#renameBtn'); await p.waitForTimeout(500);
    await p.click('#rnAddFiles'); await p.waitForTimeout(300);
    await p.fill('#bPath', INDIR); await p.click('#bGo'); await p.waitForTimeout(400);
    await p.click('#bList .bi:has-text("Show S01E01")'); await p.click('#bAddSel'); await p.waitForTimeout(400);
    await p.fill('#rnPattern', '{title}');
    await p.click('#rnAddRule'); await p.fill('#rnRules .rulerow input >> nth=0', 'S01E01'); await p.fill('#rnRules .rulerow input >> nth=1', 'Folge 1');
    await p.waitForTimeout(700);
    const rp = await p.textContent('#rnPreview');
    if (!rp.includes('Show Folge 1 [WEBDL-1080p].mkv')) errs.push(name + ': Umbenennen-Vorschau unerwartet: ' + rp);
    await p.screenshot({ path: `${SHOTS}/rn-${name}-page.png`, fullPage: true });
    await ctx.close();
  }
  await b.close();
  console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'ok');
})();
