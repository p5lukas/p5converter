// Prüfregel: Voreinstellungs-Assistent (Fragen, Kachel auf der Startseite, nur Video) und Probeclip (CPU) in allen Ansichten.
// Voraussetzung: INDIR enthält long.mkv, Wurzelordner INDIR und OUTDIR; frischer Server. Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-wizard.js
const L = require('./ui-lib');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
(async () => {
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const inside = sel => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; }, sel);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    // ---- Assistent ----
    const tag = 'Test ' + name;
    await p.click('text=Neue Voreinstellung'); await p.waitForTimeout(400);
    ok(await p.isVisible('#wizDlg') && await inside('#wizDlg'), name + ': Assistent nicht sichtbar oder ragt heraus');
    ok(/Frage 1 von 10/.test(await p.textContent('#wizBox')), name + ': „Frage 1 von 10“ fehlt');
    await p.screenshot({path: `${L.SHOTS}/p5c-wiz-${name}-1.png`});
    while (await p.locator('#wizGo').count()) {
      if (/Wie gut soll das Bild/.test(await p.textContent('#wizBox'))) ok(/CRF \d+/.test(await p.textContent('#wizBox .wizopts')), name + ': Wert hinter den Stufen fehlt im Assistenten'); await p.click('#wizGo'); await p.waitForTimeout(120); }
    ok(/Passt das so/.test(await p.textContent('#wizBox')), name + ': Zusammenfassung fehlt');
    await p.fill('#wizName', tag); await p.screenshot({path: `${L.SHOTS}/p5c-wiz-${name}-2.png`});
    await p.click('#wizSave'); await p.waitForTimeout(800);
    ok(!(await p.isVisible('#wizDlg')), name + ': Assistent schließt nicht');
    ok(await p.locator('#startPresets', {hasText: tag}).count() === 1, name + ': Kachel fehlt auf der Startseite');
    ok(await ov() <= 0, name + ': Überlauf Startseite ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-wiz-${name}-3-start.png`, fullPage: true});
    // Kachel anklicken: Video, Schritt 1
    await p.click('#startPresets button:has-text("' + tag + '")'); await p.waitForTimeout(600);
    ok(await p.isVisible('#cvStepper'), name + ': Kachel führt nicht in den Video-Ablauf');
    await L.home(p);
    // ---- Probeclip (CPU) ----
    await L.enter(p, 'video'); await L.addFile(p, 'long.mkv'); await L.toCheck(p); await p.waitForTimeout(800);
    await L.openCard(p, 'video');
    await p.click('#clipBtn'); await p.waitForTimeout(500);
    ok(await p.isVisible('#clipDlg') && await inside('#clipDlg'), name + ': Probeclip-Fenster nicht sichtbar oder ragt heraus');
    await p.screenshot({path: `${L.SHOTS}/p5c-clip-${name}-1.png`});
    await p.click('#clipGo');
    await p.waitForFunction(() => { const c = [...document.querySelectorAll('#clipBox .clipcard')]; return c.length === 3 && c.every(x => x.classList.contains('fertig')); }, null, {timeout: 240000}).catch(() => fails.push(name + ': Probeclip wurde nicht fertig'));
    await p.waitForTimeout(1500);
    ok(/SSIM/.test(await p.textContent('#clipBox')), name + ': SSIM fehlt im Ergebnis');
    ok(await ov() <= 0 && await inside('#clipDlg'), name + ': Probeclip-Ergebnis ragt heraus');
    await p.screenshot({path: `${L.SHOTS}/p5c-clip-${name}-2.png`});
    await p.evaluate(() => $('#clipDlg').close());
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
