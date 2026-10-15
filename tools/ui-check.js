const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const views = [
  ['desktop', {viewport: {width: 1400, height: 1000}}],
  ['iphone-portrait', {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['iphone-landscape', {viewport: {width: 844, height: 390}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['ipad-portrait', {viewport: {width: 820, height: 1180}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['ipad-landscape', {viewport: {width: 1180, height: 820}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
];
// Prüfregel: alle Ansichten (Desktop, iPhone, iPad; Hoch- und Querformat) mit Geräte-Emulation + Screenshots.
// Aufruf: INDIR=/pfad/mit/long.mkv OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check.js   (Server läuft auf :8787)
const INDIR = process.env.INDIR || '/media', OUTDIR = process.env.OUTDIR || '/tmp/p5c-out', SHOTS = process.env.SHOTS || '/tmp';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errs = [];
  let n = 0;
  for (const [name, opt] of views) {
    const ctx = await b.newContext(opt);
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => m.type() === 'error' && errs.push(name + ': ' + m.text()));
    await p.goto((process.env.P5_URL || 'http://127.0.0.1:8787')); await p.waitForTimeout(1200);
    await p.click('[data-world=video]'); await p.waitForTimeout(1800);
    // file browser dialog
    await p.click('#addFiles'); await p.waitForTimeout(400);
    await p.fill('#bPath', INDIR); await p.click('#bGo'); await p.waitForTimeout(400);
    await p.screenshot({ path: `${SHOTS}/p5c-${name}-browser.png` });
    await p.click('#bList .bi:has-text("long.mkv")'); await p.click('#bAddSel'); await p.waitForTimeout(500);
    // tracks dialog
    await p.click('[data-tr="0"]'); await p.waitForTimeout(600);
    await p.screenshot({ path: `${SHOTS}/p5c-${name}-tracks.png` });
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    await p.selectOption('#vCodec', 'hevc'); await p.selectOption('#vPreset', 'slow');
    // info popover
    await p.click('button.info[data-key=vDepth]'); await p.waitForTimeout(300);
    await p.screenshot({ path: `${SHOTS}/p5c-${name}-info.png` });
    await p.keyboard.press('Escape');
    // start slow job to the output dir, look at queue
    await p.selectOption('#vCodec', 'hevc'); await p.selectOption('#vPreset', 'slow');
    await p.selectOption('#outMode', 'custom'); await p.fill('#outDir', `${OUTDIR}/${name}`);
    await p.click('#start'); await p.waitForTimeout(3500);
    await p.evaluate(() => document.querySelector('#queue').scrollIntoView({block: 'center'}));
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${SHOTS}/p5c-${name}-queue.png` });
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (ov > 0) errs.push(`${name}: horizontaler Überlauf ${ov}px`);
    await p.click('#newsBtn'); await p.waitForTimeout(400);
    await p.screenshot({ path: `${SHOTS}/p5c-${name}-news.png` });
    await p.keyboard.press('Escape');
    await p.click('#cancelAll'); await p.waitForTimeout(800);
    await ctx.close();
  }
  console.log('Auffälligkeiten:', errs);
  await b.close();
})();
