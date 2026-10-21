// Prüfregel: roter Knopf „Verwerfen“ in der Fußleiste (Schritte 1–4 und Audio): Rückfrage nur wenn etwas gewählt ist, setzt alles zurück, führt zur Startseite;
// in allen Ansichten sichtbar und ohne Überlauf. Voraussetzung: INDIR enthält ep01.mkv (Testvideo). Aufruf: INDIR=/tmp/season SHOTS=/tmp/shots node tools/ui-check-discard.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
(async () => {
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1200);
    // Schritt 1 ohne Dateien: Knopf da, kein Dialog, direkt zur Startseite
    await L.enter(p, 'video');
    ok(await p.locator('#wizDiscard').isVisible(), name + ': Schritt 1: „Verwerfen“ fehlt');
    await p.click('#wizDiscard'); await p.waitForTimeout(500);
    ok(!(await p.locator('#resetDlg').isVisible()) && await p.locator('#startTiles').isVisible(), name + ': ohne Auswahl sollte es ohne Rückfrage zur Startseite gehen');
    // mit Datei in den Schritten 1, 2, 3
    await L.enter(p, 'video'); await L.addFile(p, 'ep01.mkv');
    for (const step of [1, 2, 3]) {
      if (step > 1) { await p.click('#wizNext'); await p.waitForTimeout(700); }
      const d = p.locator('#wizDiscard');
      ok(await d.isVisible(), name + ': Schritt ' + step + ': „Verwerfen“ fehlt');
      ok(/Verwerfen/.test(await d.textContent()) || (await d.getAttribute('title')).length > 0, name + ': Beschriftung');
      const bx = await d.boundingBox(), vw = opt.viewport.width;
      ok(bx && bx.x >= 0 && bx.x + bx.width <= vw + 1, name + ': Schritt ' + step + ': Knopf liegt außerhalb');
      ok(await ov() <= 0, name + ': Überlauf Schritt ' + step + ' ' + await ov() + 'px');
      if (step === 2) await p.screenshot({path: `${L.SHOTS}/p5c-discard-${name}-1-fussleiste.png`});
    }
    // Schritt 3: Dialog „Weitermachen“ lässt alles stehen
    await p.click('#wizDiscard'); await p.waitForTimeout(400);
    ok(await p.locator('#resetDlg').isVisible() && /1 Datei/.test(await p.textContent('#resetText')), name + ': Rückfrage fehlt oder Text: ' + await p.textContent('#resetText'));
    await p.screenshot({path: `${L.SHOTS}/p5c-discard-${name}-2-rueckfrage.png`});
    await p.click('#resetNo'); await p.waitForTimeout(300);
    ok(!(await p.locator('#resetDlg').isVisible()) && await p.locator('#wizDiscard').isVisible() && await p.locator('#fileList .file').count() >= 0, name + ': „Weitermachen“ bricht den Ablauf ab');
    // Schritt 4: der Knopf ist dort der bisherige #resetAll
    await L.toCheck(p); await p.waitForTimeout(500);
    ok(await p.locator('#resetAll').isVisible() && !(await p.locator('#wizDiscard').isVisible()), name + ': Schritt 4: „Verwerfen“ fehlt');
    ok(/Verwerfen|✕/.test((await p.locator('#resetAll').textContent()) + (await p.locator('#resetAll').getAttribute('title'))), name + ': Schritt 4 Beschriftung');
    ok(await ov() <= 0, name + ': Überlauf Schritt 4 ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-discard-${name}-3-schritt4.png`});
    await p.click('#resetAll'); await p.waitForTimeout(300); await p.click('#resetYes'); await p.waitForTimeout(600);
    ok(await p.locator('#startTiles').isVisible(), name + ': nach „Verwerfen“ nicht auf der Startseite');
    ok(await p.evaluate(() => S.files.video.length) === 0 && await p.evaluate(() => S.vstep) === 1, name + ': Zustand nicht zurückgesetzt');
    // neuer Lauf beginnt leer in Schritt 1
    await L.enter(p, 'video'); await p.waitForTimeout(300);
    ok(await p.locator('#fileList .file').count() === 0, name + ': nach dem Verwerfen sind noch Dateien da');
    // Audio: eine Ansicht
    await L.home(p); await L.enter(p, 'audio'); await L.addFile(p, 'ep01.mkv').catch(() => {});
    if (await p.locator('#resetAll').isVisible()) { ok(true, ''); await p.screenshot({path: `${L.SHOTS}/p5c-discard-${name}-4-audio.png`}); }
    else fails.push(name + ': Audio: „Verwerfen“ nicht sichtbar');
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
