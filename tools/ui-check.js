// Prüft den Ablauf in Schritten in allen Ansichten: Startseite, Reiter, Dateien, Ziel, Benennen, Einstellungen,
// Zusammenfassung, Start → zurück zur Startseite mit laufender Warteschlange; beide Welten.
// Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check.js   (Server auf :8787, ROOTS enthalten INDIR und OUTDIR)
const L = require('./ui-lib');
const OUTDIR = process.env.OUTDIR || '/tmp/out';
(async () => {
  const b = await L.launch();
  const errs = [];
  const eq = (n, what, got, want) => { if (got !== want) errs.push(`${n}: ${what}: ${got} (erwartet ${want})`); };
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt);
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => m.type() === 'error' && errs.push(name + ': ' + m.text()));
    await p.goto(L.url); await p.waitForTimeout(1200);
    const vis = async () => p.evaluate(() => [...document.querySelectorAll('.stepsec')].filter(e => !e.classList.contains('hidden')).map(e => e.dataset.step).join(','));
    const ov = async () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    // ---- Video ----
    await L.setWorld(p, 'video');
    eq(name, 'Start sichtbar', await vis(), 'start');
    eq(name, 'Hardware auf der Startseite (Video)', await p.isVisible('#hwCard'), true);
    eq(name, 'Zurück/Weiter nicht auf der Startseite', await p.isVisible('#stepnav'), false);
    await p.screenshot({ path: `${L.SHOTS}/st-${name}-1-start.png`, fullPage: true });
    await p.click('#startFlow'); await p.waitForTimeout(300);
    eq(name, 'Dateien nach „Konvertierung starten“', await vis(), 'files');
    await L.addFile(p, 'long.mkv');
    await p.screenshot({ path: `${L.SHOTS}/st-${name}-2-files.png` });
    // Spuren-Dialog erreichbar
    await p.click('[data-tr="0"]'); await p.waitForTimeout(500);
    await p.screenshot({ path: `${L.SHOTS}/st-${name}-2b-tracks-dialog.png` });
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    const seq = ['dest', 'name', 'video', 'tracks', 'summary'];
    for (const s of seq) {
      await p.click('#stepNext'); await p.waitForTimeout(300);
      eq(name, 'Schritt ' + s, await vis(), s);
      if (await ov() > 0) errs.push(`${name}: Überlauf im Schritt ${s}: ${await ov()}px`);
      if (s === 'video') { await p.selectOption('#vCodec', 'hevc'); await p.selectOption('#vPreset', 'veryfast'); await p.selectOption('#vHeight', '480'); }
      if (s === 'dest') { await p.selectOption('#outMode', 'custom'); await p.fill('#outDir', OUTDIR + '/' + name); }
      await p.screenshot({ path: `${L.SHOTS}/st-${name}-3-${s}.png` });
    }
    const sum = await p.textContent('#summaryBody');
    if (!/long\.mkv/.test(sum) || !/H\.265/.test(sum) || !new RegExp(name).test(sum)) errs.push(`${name}: Zusammenfassung unvollständig: ${sum.slice(0, 200)}`);
    // „Ändern“ springt zum Schritt, Weiter führt zurück zur Zusammenfassung
    await p.click('#summaryBody .sumrow >> nth=1 >> button'); await p.waitForTimeout(300);
    eq(name, 'Ändern → Ziel', await vis(), 'dest');
    await L.goStep(p, 'summary');
    await p.click('#start'); await p.waitForTimeout(2500);
    eq(name, 'nach Start zurück auf der Startseite', await vis(), 'start');
    eq(name, 'Auftrag in der Warteschlange', await p.locator('#queue .job').count() >= 1, true);
    eq(name, 'Datei-Liste nach Start leer', await p.locator('#steps .stepbtn em').count(), 0);
    await p.locator('#queue').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${L.SHOTS}/st-${name}-4-queue.png` });
    await p.click('#cancelAll'); await p.waitForTimeout(800);

    // ---- Audio: eigene, passende Schritte ----
    await L.setWorld(p, 'audio');
    eq(name, 'Audio: Start', await vis(), 'start');
    eq(name, 'Audio: keine Hardware-Kachel', await p.isVisible('#hwCard'), false);
    eq(name, 'Audio: Reiter', (await p.locator('#steps .stepbtn').allTextContents()).length, 6);
    await p.click('#startFlow'); await p.waitForTimeout(300);
    await L.addFile(p, 'a.mp3');
    for (const s of ['dest', 'name', 'audio', 'summary']) {
      await p.click('#stepNext'); await p.waitForTimeout(300);
      eq(name, 'Audio-Schritt ' + s, await vis(), s);
      if (await ov() > 0) errs.push(`${name}: Überlauf im Audio-Schritt ${s}: ${await ov()}px`);
    }
    await p.screenshot({ path: `${L.SHOTS}/st-${name}-5-audio-summary.png` });
    await ctx.close();
  }
  await b.close();
  console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'ok');
})();
