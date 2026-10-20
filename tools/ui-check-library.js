// Prüfregel: Bibliothek-Scan „Ordner prüfen“ (Video, Schritt 1) in allen Ansichten – ORDNERWEISE: nie einzelne Dateien, Hinweise statt Schätzungen,
// „Ordner übernehmen“ legt den ganzen Ordner (rekursiv) in Schritt 1 ab; Abbruch.
// Voraussetzung: INDIR enthält ep01.mkv, ep02.mkv, ep03.mkv, ep06.mkv (Testdateien mit H.264/DTS), Wurzelordner INDIR und OUTDIR.
// Aufruf: INDIR=/tmp/season OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-library.js
const L = require('./ui-lib.js');
const fs = require('fs');
const OUT = (process.env.OUTDIR || '/tmp/out') + '/lib';
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
(async () => {
  fs.rmSync(OUT, {recursive: true, force: true});
  for (const [d, f] of [['Serie/Staffel 1', 'ep01.mkv'], ['Serie/Staffel 1', 'ep02.mkv'], ['Serie/Staffel 2', 'ep03.mkv'], ['Film', 'ep06.mkv']]) {
    fs.mkdirSync(`${OUT}/${d}`, {recursive: true}); fs.copyFileSync(`${L.INDIR}/${f}`, `${OUT}/${d}/${f}`);
  }
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    await L.enter(p, 'video');
    ok(await p.isVisible('#scanFolder'), name + ': Knopf „Ordner prüfen“ fehlt in Schritt 1');
    ok(!(await p.isVisible('#cvScan')), name + ': Ergebnisfeld ohne Prüfung sichtbar');
    await p.click('#scanFolder'); await p.waitForTimeout(400);
    ok(await p.locator('#bAddDir:has-text("Diesen Ordner wählen")').count() === 1, name + ': Browser sollte im Ordner-Modus öffnen');
    await p.fill('#bPath', OUT); await p.click('#bGo'); await p.waitForTimeout(400);
    await p.click('#bAddDir'); await p.waitForSelector('#cvScan .librow', {timeout: 20000}); await p.waitForTimeout(400);
    // ---- ordnerweise: Wurzel (ganzer Ordner), Serie (ganzer Ordner), Staffel 1, Staffel 2, Film – nie eine Datei ----
    const names = (await p.locator('#cvScan .librow .libname b').allTextContents());
    ok(names.length === 5, name + ': 5 Ordnerzeilen erwartet, ' + names.join('|'));
    ok(!names.some(n => /\.mkv/.test(n)) && !(await p.textContent('#cvScan .liblist')).includes('ep01.mkv'), name + ': es dürfen nie einzelne Dateien auftauchen');
    ok(['Staffel 1', 'Staffel 2', 'Film', 'Serie'].every(n => names.includes(n)), name + ': Ordnernamen: ' + names.join('|'));
    const serie = p.locator('#cvScan .librow', {hasText: 'Serie'}).first();
    ok(/ganzer Ordner · 2 Ordner/.test(await serie.textContent()) && /3 Dateien/.test(await serie.textContent()), name + ': Sammelzeile Serie: ' + (await serie.textContent()).replace(/\s+/g, ' '));
    const staffel = (await p.locator('#cvScan .librow', {hasText: 'Staffel 1'}).textContent()).replace(/\s+/g, ' ');
    ok(/2 Dateien/.test(staffel) && /H\.264 ×2/.test(staffel) && /Älterer Codec/.test(staffel) && /DTS/.test(staffel), name + ': Fakten und Hinweise der Staffel: ' + staffel);
    ok(!/Mbit\/s.*gespart|spart.*%|geschätzt/i.test(await p.textContent('#cvScan')), name + ': keine Schätzung der Ersparnis erlaubt');
    ok(await ov() <= 0, name + ': Überlauf mit Ergebnisliste ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-lib-${name}-1-ergebnis.png`, fullPage: true});
    // Filter und Sortierung
    await p.uncheck('#cvScan .liberctl input[type=checkbox]'); await p.waitForTimeout(200);
    ok(await p.locator('#cvScan .librow').count() >= 5, name + ': ohne Filter fehlen Ordner');
    await p.selectOption('#cvScan select[aria-label="Sortieren"]', 'size'); await p.waitForTimeout(200);
    ok(await p.locator('#cvScan .librow small').count() >= 1, name + ': flache Liste zeigt den Pfad nicht');
    await p.selectOption('#cvScan select[aria-label="Sortieren"]', 'tree'); await p.check('#cvScan .liberctl input[type=checkbox]');
    // ---- Auswahl: Serie (ganzer Ordner) übernehmen → 3 Dateien, nichts einzeln ----
    ok(await p.isDisabled('#cvScan button.primary'), name + ': „Übernehmen“ sollte ohne Auswahl gesperrt sein');
    await serie.locator('input').check(); await p.waitForTimeout(200);
    ok(/\(1\)/.test(await p.textContent('#cvScan button.primary')), name + ': Zähler am Übernehmen-Knopf');
    await p.click('#cvScan button.primary'); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => S.files.video.length) === 3, name + ': Serie sollte 3 Dateien übernehmen, ' + await p.evaluate(() => S.files.video.length));
    ok(/3 Dateien/.test(await p.textContent('#fileSummary')), name + ': Zusammenfassung in Schritt 1');
    // Film dazu, Serie nochmal (schon dabei) → 4
    await p.locator('#cvScan .librow', {hasText: 'Film'}).first().locator('input').check();
    await p.locator('#cvScan .librow', {hasText: 'Staffel 1'}).first().locator('input').check();
    await p.click('#cvScan button.primary'); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => S.files.video.length) === 4, name + ': Film dazu, Staffel 1 war schon da → 4, ' + await p.evaluate(() => S.files.video.length));
    await p.screenshot({path: `${L.SHOTS}/p5c-lib-${name}-2-uebernommen.png`, fullPage: true});
    // schließen
    await p.click('#cvScan button[aria-label="Schließen"]'); await p.waitForTimeout(300);
    ok(!(await p.isVisible('#cvScan')), name + ': Ergebnis schließt nicht');
    // ---- Audio: kein Knopf ----
    await L.home(p); await p.click('[data-kind=audio]'); await p.waitForTimeout(400);
    ok(!(await p.isVisible('#scanFolder')), name + ': „Ordner prüfen“ gibt es nur bei Video');
    await ctx.close();
  }
  // ---- Abbruch (Desktop): große Prüfung abbrechen ----
  {
    const ctx = await b.newContext(L.views[0][1]); const p = await ctx.newPage();
    await p.goto(L.url); await p.waitForTimeout(1300); await L.enter(p, 'video');
    await p.evaluate(async () => { await libStart('/tmp/many60'); });
    await p.waitForTimeout(400);
    ok(await p.locator('#cvScan .libprog').count() === 1, 'Abbruch: Fortschritt fehlt');
    await p.click('#cvScan .libprog button:has-text("Abbrechen")'); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => LIBUI.state) === 'canceled', 'Abbruch: Zustand ' + await p.evaluate(() => LIBUI.state));
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
