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
  for (const [d, f] of [['Serie/Staffel 1', 'ep01.mkv'], ['Serie/Staffel 1', 'ep02.mkv'], ['Serie/Staffel 2', 'ep03.mkv'], ['Mini (2020) {tvdb-1}/Season 01', 'ep06.mkv']]) {
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
    ok(await p.isVisible('#scanFolder') && await p.locator('#cvScanHelp #scanFolder').count() === 1, name + ': Knopf „Ordner untersuchen“ in der Erklär-Karte fehlt in Schritt 1');
    ok(/Wo lohnt sich das Umwandeln/.test(await p.textContent('#cvScanHelp h2')) && /nie einzelne Dateien/.test(await p.textContent('#cvScanHelp')) && /Ordner untersuchen/.test(await p.textContent('#scanFolder')), name + ': Text der Erklär-Karte');
    ok(await p.locator('#cvScanHelp .btns #scanFolder').isVisible() && await p.locator('#cvFiles #scanFolder').count() === 0, name + ': der Knopf gehört in die Erklär-Karte, nicht mehr in die Dateien-Karte');
    await p.screenshot({path: `${L.SHOTS}/p5c-lib-${name}-0-karte.png`, fullPage: true});
    ok(!(await p.isVisible('#cvScan')), name + ': Ergebnisfeld ohne Prüfung sichtbar');
    await p.click('#scanFolder'); await p.waitForTimeout(400);
    ok(await p.locator('#bAddDir:has-text("Diesen Ordner wählen")').count() === 1, name + ': Browser sollte im Ordner-Modus öffnen');
    await p.fill('#bPath', OUT); await p.click('#bGo'); await p.waitForTimeout(400);
    await p.click('#bAddDir'); await p.waitForSelector('#cvScan .librow', {timeout: 20000}); await p.waitForTimeout(400);
    // ---- ordnerweise: Wurzel (ganzer Ordner), Serie (ganzer Ordner), Staffel 1, Staffel 2, Mini › Season 01 – nie eine Datei ----
    const names = (await p.locator('#cvScan .librow .libname b').allTextContents());
    ok(names.length === 5, name + ': 5 Ordnerzeilen erwartet, ' + names.join('|'));
    ok(!names.some(n => /\.mkv/.test(n)) && !(await p.textContent('#cvScan .liblist')).includes('ep01.mkv'), name + ': es dürfen nie einzelne Dateien auftauchen');
    ok(['Staffel 1', 'Staffel 2', 'Season 01', 'Serie'].every(n => names.includes(n)), name + ': Ordnernamen: ' + names.join('|'));
    const serie = p.locator('#cvScan .librow', {hasText: 'Serie'}).first();
    ok(/ganzer Ordner · 2 Ordner/.test(await serie.textContent()) && /3 Dateien/.test(await serie.textContent()), name + ': Sammelzeile Serie: ' + (await serie.textContent()).replace(/\s+/g, ' '));
    const staffel = (await p.locator('#cvScan .librow', {hasText: 'Staffel 1'}).textContent()).replace(/\s+/g, ' ');
    ok(/2 Dateien/.test(staffel) && /H\.264 ×2/.test(staffel) && /Älterer Codec/.test(staffel) && /DTS/.test(staffel), name + ': Fakten und Hinweise der Staffel: ' + staffel);
    ok(!/Mbit\/s.*gespart|spart.*%|geschätzt/i.test(await p.textContent('#cvScan')), name + ': keine Schätzung der Ersparnis erlaubt');
    ok(await ov() <= 0, name + ': Überlauf mit Ergebnisliste ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-lib-${name}-1-ergebnis.png`, fullPage: true});
    // Anzeigename: Serie vor Staffelordnern, ohne {tvdb-…}; im Ordnerbaum nicht doppelt zur Sammelzeile
    const mini = p.locator('#cvScan .librow', {hasText: 'Mini (2020)'}).first();
    ok(/Mini \(2020\)\s*›\s*Season 01/.test((await mini.locator('.libname').textContent()).replace(/\s+/g, ' ')) && !/tvdb/.test(await mini.locator('.libname').textContent()), name + ': Serie › Season 01 fehlt: ' + (await mini.locator('.libname').textContent()));
    ok(/tvdb-1/.test(await mini.locator('.libname').getAttribute('title')), name + ': Tooltip mit vollem Pfad');
    ok(await p.locator('#cvScan .librow', {hasText: 'Staffel 1'}).first().locator('.libpar').count() === 0, name + ': im Ordnerbaum soll die Serie bei Staffeln unter der Sammelzeile nicht wiederholt werden');
    ok(await p.locator('#cvScan .liblegend').count() === 1, name + ': Erklärzeile über der Liste fehlt');
    // Filter-Kärtchen: einzeln an-/abwählbar, mindestens ein gewählter Hinweis genügt
    ok(await p.locator('#cvScan .libfilters .libfil').count() === 5, name + ': 5 Filter-Kärtchen erwartet');
    ok((await p.locator('#cvScan .libfil[data-fil=old]').getAttribute('aria-pressed')) === 'true' && (await p.locator('#cvScan .libfil[data-fil=small]').getAttribute('aria-pressed')) === 'false', name + ': Standardwahl der Kärtchen');
    ok(/Älterer Codec · \d+/.test(await p.textContent('#cvScan .libfil[data-fil=old]')), name + ': Zähler am Kärtchen');
    const before = await p.locator('#cvScan .librow').count();
    await p.click('#cvScan .libfil[data-fil=old]'); await p.click('#cvScan .libfil[data-fil=heavy]'); await p.waitForTimeout(250);
    ok(await p.locator('#cvScan .librow').count() < before, name + ': ohne „Älterer Codec“ und „DTS“ sollten Ordner verschwinden (' + await p.locator('#cvScan .librow').count() + ' von ' + before + ')');
    await p.click('#cvScan .libfil[data-fil=old]'); await p.waitForTimeout(250);
    ok(await p.locator('#cvScan .librow').count() === before, name + ': „Älterer Codec“ wieder an: alle Ordner zurück');
    await p.click('#cvScan .libfil[data-fil=old]'); await p.click('#cvScan .libfil[data-fil=img]'); await p.click('#cvScan .libfil[data-fil=high]'); await p.waitForTimeout(250);
    ok(await p.locator('#cvScan .librow').count() === 0 && /Kein Hinweis gewählt/.test(await p.textContent('#cvScan')), name + ': kein Kärtchen gewählt: leere Liste mit Hinweis');
    ok(await ov() <= 0, name + ': Überlauf mit Kärtchen ' + await ov() + 'px');
    await p.click('#cvScan .libfil[data-fil=old]'); await p.click('#cvScan .libfil[data-fil=heavy]'); await p.click('#cvScan .libfil[data-fil=img]'); await p.click('#cvScan .libfil[data-fil=high]'); await p.waitForTimeout(250);
    ok(await p.locator('#cvScan .librow').count() === before, name + ': Standard wiederhergestellt');
    await p.screenshot({path: `${L.SHOTS}/p5c-lib-${name}-1b-filter.png`, fullPage: true});
    // zweiter Durchlauf desselben Ordners: alles kommt aus dem Merker, die Zeilen bleiben gleich
    const rowsBefore = (await p.locator('#cvScan .librow').allTextContents()).join('|');
    await p.evaluate(() => libStart(LIBUI.root)); await p.waitForSelector('#cvScan .librow', {timeout: 20000}); await p.waitForTimeout(500);
    ok(/4 von 4 Dateien kamen aus dem Merker/.test(await p.textContent('#cvScan .libcached').catch(() => '')), name + ': Hinweis „aus dem Merker“ fehlt');
    ok((await p.locator('#cvScan .librow').allTextContents()).join('|') === rowsBefore, name + ': Zeilen aus dem Merker weichen vom ersten Durchlauf ab');
    // Filter und Sortierung
    await p.uncheck('#cvScan .liberctl input[type=checkbox]'); await p.waitForTimeout(200);
    ok(await p.locator('#cvScan .librow').count() >= 5, name + ': ohne Filter fehlen Ordner');
    await p.selectOption('#cvScan select[aria-label="Sortieren"]', 'size'); await p.waitForTimeout(200);
    ok(await p.locator('#cvScan .librow small').count() >= 1, name + ': flache Liste zeigt den Ort nicht');
    ok(/Serie/.test(await p.locator('#cvScan .librow', {hasText: 'Staffel 1'}).first().locator('.libpar').textContent()), name + ': flache Liste: Staffel ohne Serie davor');
    await p.selectOption('#cvScan select[aria-label="Sortieren"]', 'tree'); await p.check('#cvScan .liberctl input[type=checkbox]');
    // ---- Auswahl: Serie (ganzer Ordner) übernehmen → 3 Dateien, nichts einzeln ----
    ok(await p.isDisabled('#cvScan button.primary'), name + ': „Übernehmen“ sollte ohne Auswahl gesperrt sein');
    await serie.locator('input').check(); await p.waitForTimeout(200);
    ok(/\(1\)/.test(await p.textContent('#cvScan button.primary')), name + ': Zähler am Übernehmen-Knopf');
    await p.click('#cvScan button.primary'); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => S.files.video.length) === 3, name + ': Serie sollte 3 Dateien übernehmen, ' + await p.evaluate(() => S.files.video.length));
    ok(/3 Dateien/.test(await p.textContent('#fileSummary')), name + ': Zusammenfassung in Schritt 1');
    // Film dazu, Serie nochmal (schon dabei) → 4
    await p.locator('#cvScan .librow', {hasText: 'Mini (2020)'}).first().locator('input').check();
    await p.locator('#cvScan .librow', {hasText: 'Staffel 1'}).first().locator('input').check();
    await p.click('#cvScan button.primary'); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => S.files.video.length) === 4, name + ': Mini dazu, Staffel 1 war schon da → 4, ' + await p.evaluate(() => S.files.video.length));
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
