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
    ok(/Platz sparen/.test(await p.textContent('#cvScanHelp h2')) && /Es wird nichts verändert/.test(await p.textContent('#cvScanHelp')) && /Ordner untersuchen/.test(await p.textContent('#scanFolder')), name + ': Text der Erklär-Karte');
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
    // Filter-Fenster: Hinweise einzeln an-/abwählbar, mindestens ein gewählter Hinweis genügt
    ok(await p.locator('#libFilterBtn').isVisible() && await p.locator('#libSearch').isVisible() && await p.locator('#libSort').isVisible(), name + ': Kopfzeile mit Suche, Filter und Sortierung fehlt');
    ok(!/\(\d+\)/.test(await p.textContent('#libFilterBtn')), name + ': ohne gesetzte Filter keine Zahl am Filter-Knopf');
    await p.click('#libFilterBtn'); await p.waitForSelector('#libDlg[open]'); await p.waitForTimeout(300);
    ok(await p.locator('#libDlg .libfil[data-fil]').count() === 5, name + ': 5 Hinweis-Kärtchen im Filter-Fenster erwartet');
    ok((await p.locator('#libDlg .libfil[data-fil=old]').getAttribute('aria-pressed')) === 'true' && (await p.locator('#libDlg .libfil[data-fil=small]').getAttribute('aria-pressed')) === 'false', name + ': Standardwahl der Kärtchen');
    ok(/Älterer Codec\s*\d+/.test(await p.textContent('#libDlg .libfil[data-fil=old]')), name + ': Zähler am Kärtchen');
    ok(await p.locator('#libDlg [data-g=res]').count() === 4 && await p.locator('#libDlg [data-g=vc]').count() === 4 && await p.locator('#libDlg [data-g=au]').count() === 7 && await p.locator('#libDlg [data-g=src]').count() === 6, name + ': Gruppen Auflösung, Codec, Ton und Quelle fehlen');
    const dlgBox = await p.locator('#libDlg').boundingBox(), vp = p.viewportSize();
    ok(dlgBox && dlgBox.x >= -1 && dlgBox.x + dlgBox.width <= vp.width + 1 && dlgBox.y + dlgBox.height <= vp.height + 1, name + ': Filter-Fenster ragt aus dem Bildschirm');
    await p.screenshot({path: `${L.SHOTS}/p5c-lib-${name}-1a-fenster.png`});
    const before = await p.locator('#cvScan .librow').count();
    await p.click('#libDlg .libfil[data-fil=old]'); await p.click('#libDlg .libfil[data-fil=heavy]'); await p.waitForTimeout(250);
    ok(await p.locator('#cvScan .librow').count() < before, name + ': ohne „Älterer Codec“ und „DTS“ sollten Ordner verschwinden (' + await p.locator('#cvScan .librow').count() + ' von ' + before + ')');
    ok(/\(1\)/.test(await p.textContent('#libFilterBtn')) && await p.locator('#cvScan .libact').count() === 1, name + ': geänderte Hinweise sollten als Filter (1) mit Kärtchen erscheinen');
    await p.click('#libDlg .libfil[data-fil=old]'); await p.waitForTimeout(250);
    ok(await p.locator('#cvScan .librow').count() === before, name + ': „Älterer Codec“ wieder an: alle Ordner zurück');
    await p.click('#libDlg .libfil[data-fil=old]'); await p.click('#libDlg .libfil[data-fil=img]'); await p.click('#libDlg .libfil[data-fil=high]'); await p.waitForTimeout(250);
    ok(await p.locator('#cvScan .librow').count() === 0 && /Kein Ordner passt/.test(await p.textContent('#cvScan')), name + ': kein Hinweis gewählt: leere Liste mit Hinweis');
    await p.click('#libReset'); await p.waitForTimeout(250);
    ok(await p.locator('#cvScan .librow').count() === before && !/\(\d+\)/.test(await p.textContent('#libFilterBtn')), name + ': „Zurücksetzen“ stellt den Anfangszustand her');
    // Auflösung: die Testdateien sind 720p; 4K zeigt nichts, 720p alles; ein Kärtchen erscheint unter der Kopfzeile und lässt sich entfernen
    ok(/720p\s*[1-9]/.test(await p.textContent('#libDlg [data-g=res][data-v="720"]')) && /4K\s*0/.test(await p.textContent('#libDlg [data-g=res][data-v="2160"]')), name + ': Zähler der Auflösung (720p > 0, 4K = 0)');
    await p.click('#libDlg [data-g=res][data-v="2160"]'); await p.waitForTimeout(250);
    ok(await p.locator('#cvScan .librow').count() === 0 && await p.locator('#cvScan .libact:has-text("4K")').count() === 1, name + ': Filter 4K: keine Ordner, Kärtchen „4K ✕“');
    await p.click('#libDlg [data-g=res][data-v="2160"]'); await p.click('#libDlg [data-g=res][data-v="720"]'); await p.waitForTimeout(250);
    ok(await p.locator('#cvScan .librow').count() === before, name + ': Filter 720p: alle Ordner');
    await p.click('#libDone'); await p.waitForTimeout(250);
    ok(await p.isVisible('#cvScan .libact:has-text("720p")') && /\(1\)/.test(await p.textContent('#libFilterBtn')), name + ': Kärtchen „720p“ und Filter (1)');
    await p.click('#cvScan .libact:has-text("720p")'); await p.waitForTimeout(250);
    ok(await p.locator('#cvScan .libact').count() === 0 && !/\(\d+\)/.test(await p.textContent('#libFilterBtn')), name + ': Kärtchen entfernt den Filter');
    ok(await ov() <= 0, name + ': Überlauf mit Filtern ' + await ov() + 'px');
    // Suche
    await p.fill('#libSearch', 'mini'); await p.waitForTimeout(400);
    ok(await p.locator('#cvScan .librow').count() === 1 && /Mini/.test(await p.textContent('#cvScan .librow')), name + ': Suche „mini“ sollte genau den Ordner Mini zeigen, ' + await p.locator('#cvScan .librow').count());
    ok(await p.evaluate(() => document.activeElement && document.activeElement.id) === 'libSearch', name + ': das Suchfeld verliert beim Tippen den Fokus');
    await p.fill('#libSearch', 'gibtesnicht'); await p.waitForTimeout(400);
    ok(await p.locator('#cvScan .librow').count() === 0 && /Kein Ordner passt/.test(await p.textContent('#cvScan')), name + ': Suche ohne Treffer');
    await p.fill('#libSearch', ''); await p.waitForTimeout(400);
    ok(await p.locator('#cvScan .librow').count() === before, name + ': leere Suche zeigt wieder alle');
    await p.screenshot({path: `${L.SHOTS}/p5c-lib-${name}-1b-filter.png`, fullPage: true});
    // zweiter Durchlauf desselben Ordners: alles kommt aus dem Zwischenspeicher, die Zeilen bleiben gleich
    const rowsBefore = (await p.locator('#cvScan .librow').allTextContents()).join('|');
    await p.evaluate(() => { const {LIBUI, libStart} = window.__p5; return (libStart(LIBUI.root)); }); await p.waitForSelector('#cvScan .librow', {timeout: 20000}); await p.waitForTimeout(500);
    ok(/4 von 4 Dateien kamen aus dem Zwischenspeicher/.test(await p.textContent('#cvScan .libcached').catch(() => '')), name + ': Hinweis „aus dem Zwischenspeicher“ fehlt');
    ok((await p.locator('#cvScan .librow').allTextContents()).join('|') === rowsBefore, name + ': Zeilen aus dem Zwischenspeicher weichen vom ersten Durchlauf ab');
    // Filter und Sortierung
    await p.click('#libShowAll').catch(() => {}); await p.waitForTimeout(200);
    ok(await p.locator('#cvScan .librow').count() >= 5, name + ': ohne Filter fehlen Ordner');
    await p.selectOption('#libSort', 'size'); await p.waitForTimeout(200);
    ok(await p.locator('#cvScan .librow small').count() >= 1, name + ': flache Liste zeigt den Ort nicht');
    ok(/Serie/.test(await p.locator('#cvScan .librow', {hasText: 'Staffel 1'}).first().locator('.libpar').textContent()), name + ': flache Liste: Staffel ohne Serie davor');
    // Sortierung nach Dateizahl: absteigend (Wurzel mit den meisten Dateien oben), Richtung umkehren (die kleinste Zeile oben); Auswahl bleibt nach dem Neuladen der Seite erhalten
    await p.selectOption('#libSort', 'files'); await p.waitForTimeout(200);
    const filesOf = () => p.locator('#cvScan .librow').evaluateAll(els => els.map(e => +((e.querySelector('.libfacts') || {}).textContent || '0').match(/^(\d+)/)[1]));
    const desc = await filesOf(); ok(desc.every((n, i) => !i || desc[i - 1] >= n), name + ': nach Dateizahl absteigend: ' + desc.join(','));
    await p.click('#libDir'); await p.waitForTimeout(200);
    const asc = await filesOf(); ok(asc.every((n, i) => !i || asc[i - 1] <= n) && asc[0] <= asc[asc.length - 1], name + ': Richtung umkehren: ' + asc.join(','));
    await p.selectOption('#libSort', 'save'); await p.waitForTimeout(200);
    ok(await p.locator('#libDir').isEnabled(), name + ': Richtungsknopf sollte bei „nach Ersparnis“ aktiv sein');
    await p.selectOption('#libSort', 'tree'); await p.waitForTimeout(200);
    ok(await p.locator('#libDir').isDisabled(), name + ': Richtungsknopf sollte beim Ordnerbaum gesperrt sein');
    // ---- Serie im Fokus: nur noch diese Serie, jede Staffel mit Quelle, Auflösung, Codec und Ton ----
    await serie.locator('.libfocusbtn').click(); await p.waitForSelector('#cvScan .libfocus', {timeout: 5000}); await p.waitForTimeout(300);
    ok(await p.locator('#cvScan .liblist').count() === 0 && await p.locator('#libSearch').count() === 0, name + ': im Fokus sollen die anderen Ordner ausgeblendet sein');
    ok(await p.locator('#cvScan .libseason').count() === 2, name + ': 2 Staffeln erwartet, ' + await p.locator('#cvScan .libseason').count());
    const fo = (await p.textContent('#cvScan .libfocus')).replace(/\s+/g, ' ');
    ok(/Staffel 1/.test(fo) && /Staffel 2/.test(fo) && /Quelle/.test(fo) && /Auflösung/.test(fo) && /Codec/.test(fo) && /Ton/.test(fo) && /720p/.test(fo) && /H\.264/.test(fo) && /DTS/.test(fo), name + ': Staffel-Übersicht unvollständig: ' + fo.slice(0, 300));
    ok(await ov() <= 0, name + ': Überlauf im Fokus ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-lib-${name}-1c-fokus.png`, fullPage: true});
    await p.click('#libSeasonAll'); await p.waitForTimeout(200);
    ok(/\(2\)/.test(await p.textContent('#libAdopt')), name + ': „Alle Staffeln auswählen“ sollte 2 Ordner wählen: ' + await p.textContent('#libAdopt'));
    await p.click('#libBack'); await p.waitForSelector('#cvScan .liblist'); await p.waitForTimeout(200);
    ok(await p.locator('#libSearch').count() === 1 && /\(2\)/.test(await p.textContent('#libAdopt')), name + ': zurück zur Liste, die Auswahl bleibt');
    await p.evaluate(() => { const {LIBUI, libRender} = window.__p5; LIBUI.sel.clear(); libRender(); });
    // ---- Auswahl: Serie (ganzer Ordner) übernehmen → 3 Dateien, nichts einzeln ----
    ok(await p.isDisabled('#libAdopt'), name + ': „Übernehmen“ sollte ohne Auswahl gesperrt sein');
    await serie.locator('input').check(); await p.waitForTimeout(200);
    ok(/\(1\)/.test(await p.textContent('#libAdopt')), name + ': Zähler am Übernehmen-Knopf');
    await p.click('#libAdopt'); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => { const {S} = window.__p5; return (S.files.video.length); }) === 3, name + ': Serie sollte 3 Dateien übernehmen, ' + await p.evaluate(() => { const {S} = window.__p5; return (S.files.video.length); }));
    ok(/3 Dateien/.test(await p.textContent('#fileSummary')), name + ': Zusammenfassung in Schritt 1');
    // Film dazu, Serie nochmal (schon dabei) → 4
    await p.locator('#cvScan .librow', {hasText: 'Mini (2020)'}).first().locator('input').check();
    await p.locator('#cvScan .librow', {hasText: 'Staffel 1'}).first().locator('input').check();
    await p.click('#libAdopt'); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => { const {S} = window.__p5; return (S.files.video.length); }) === 4, name + ': Mini dazu, Staffel 1 war schon da → 4, ' + await p.evaluate(() => { const {S} = window.__p5; return (S.files.video.length); }));
    await p.screenshot({path: `${L.SHOTS}/p5c-lib-${name}-2-uebernommen.png`, fullPage: true});
    // schließen
    await p.click('#cvScan button[aria-label="Schließen"]'); await p.waitForTimeout(300);
    ok(!(await p.isVisible('#cvScan')), name + ': Ergebnis schließt nicht');
    // ---- Audio: kein Knopf ----
    await L.home(p); await p.click('[data-kind=audio]'); await p.waitForTimeout(400);
    ok(!(await p.isVisible('#scanFolder')), name + ': „Ordner prüfen“ gibt es nur bei Video');
    await ctx.close();
  }
  // ---- große Ersparnis: die Summe „≈ 7,5 GB von 18,6 GB ließen sich sparen“ (nur ab 50 MB; früher fehlte hier fmtSizeLib → nichts wurde angezeigt) ----
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    await p.goto(L.url); await p.waitForTimeout(1300); await L.enter(p, 'video');
    await p.evaluate(async d => { const {libStart} = window.__p5; await libStart(d); }, L.INDIR);
    await p.waitForFunction(() => window.__p5.LIBUI.state === 'done', null, {timeout: 60000});
    await p.evaluate(() => { const {LIBUI, libRender} = window.__p5; LIBUI.rows.forEach(r => { if (!r.group) { r.bytes = 20e9; r.saveBytes = 8e9; } }); libRender(); });
    await p.waitForTimeout(300);
    const t = (await p.textContent('#cvScan .libtotal').catch(() => '')) || '';
    ok(/≈ [\d,]+ GB/.test(t) && /ließen sich sparen/.test(t), name + ': Summe der Ersparnis fehlt: ' + t.slice(0, 120));
    ok(await p.locator('#cvScan .libgain').count() >= 1, name + ': Ersparnis je Ordner fehlt');
    await ctx.close();
  }
  // ---- Abbruch (Desktop): große Prüfung abbrechen ----
  {
    const ctx = await b.newContext(L.views[0][1]); const p = await ctx.newPage();
    await p.goto(L.url); await p.waitForTimeout(1300); await L.enter(p, 'video');
    await p.evaluate(async dir => { const {libStart} = window.__p5; await libStart(dir); }, process.env.MANY || '/tmp/many60');
    await p.waitForTimeout(400);
    ok(await p.locator('#cvScan .libprog').count() === 1, 'Abbruch: Fortschritt fehlt');
    await p.click('#cvScan .libprog button:has-text("Abbrechen")'); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => { const {LIBUI} = window.__p5; return (LIBUI.state); }) === 'canceled', 'Abbruch: Zustand ' + await p.evaluate(() => { const {LIBUI} = window.__p5; return (LIBUI.state); }));
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
