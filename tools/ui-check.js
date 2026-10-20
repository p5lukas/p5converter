// Prüft den Ablauf in allen Ansichten: Startseite mit den Kacheln Video/Audio, Video in vier Schritten (Dateien, Regeln, Wie umwandeln?,
// Kontrolle & Start mit den Karten), Fenster „Details“, Start → Warteschlange/Verlauf; Audio in einer Ansicht.
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
    const row = lbl => p.locator('.cvgrid .cvk', {hasText: new RegExp('^' + lbl + '\\s*i?$', 'i')});

    // ---- Startseite ----
    eq(name, 'Start sichtbar', await vis(), 'start');
    eq(name, 'zwei Kacheln Video und Audio', await p.locator('#startTiles .kindtile').count(), 2);
    eq(name, 'keine Welten-Umschaltung mehr', await p.locator('#worlds').count(), 0);
    eq(name, 'Hardware auf der Startseite', await p.isVisible('#hwCard'), true);
    eq(name, 'Startleisten nicht auf der Startseite', (await p.isVisible('#stepnav')) || (await p.isVisible('#wizNav')), false);
    eq(name, 'keine Schritt-Reiter auf der Startseite', await p.isVisible('#cvStepper'), false);
    for (const id of ['#startRename', '#startHistory']) eq(name, id + ' in der Kopfzeile', await p.locator('header.top ' + id).isVisible(), true);
    eq(name, 'Gewonnener Platz zeigt Video und Audio', await p.locator('#savedBody .savedcol').count(), 2);
    eq(name, 'Startseite grün', await p.evaluate(() => document.documentElement.dataset.kind || ''), '');
    if (await ov() > 0) errs.push(`${name}: Überlauf auf der Startseite: ${await ov()}px`);
    await p.screenshot({path: `${L.SHOTS}/st-${name}-1-start.png`, fullPage: true});

    // ---- Video: Schritt 1 Dateien ----
    await p.click('#startTiles [data-kind=video]'); await p.waitForTimeout(500);
    eq(name, 'Ablauf sichtbar', await vis(), 'convert');
    eq(name, 'Schrittleiste mit vier Schritten', await p.locator('#cvStepper .stp').count(), 4);
    eq(name, 'Schritt 1 aktiv', await p.locator('#cvStepper .stp.on').getAttribute('data-step'), 'files');
    eq(name, 'Schritt 1: Dateikarte sichtbar', await p.isVisible('#cvFiles'), true);
    eq(name, 'Schritt 1: Weiter gesperrt ohne Dateien', await p.isDisabled('#wizNext'), true);
    eq(name, 'Schritt 1: Startleiste nicht sichtbar', await p.isVisible('#stepnav'), false);
    eq(name, 'Video grün', await p.evaluate(() => document.documentElement.dataset.kind), 'video');
    eq(name, 'Quellordner als Knöpfe', (await p.locator('#rootBtns .rootbtn').count()) >= 1, true);
    await p.screenshot({path: `${L.SHOTS}/st-${name}-2-schritt1.png`, fullPage: true});
    await L.addFile(p, 'long.mkv');
    eq(name, 'Schritt 1: Weiter frei mit Datei', await p.isDisabled('#wizNext'), false);
    // Browser: Suche ohne Haken „Unterordner“
    eq(name, 'Browser ohne Haken „Auch in Unterordnern“', await p.locator('#bDeep').count(), 0);

    // ---- Schritt 2 Regeln ----
    await p.click('#wizNext'); await p.waitForSelector('#cvRules .cvcard'); await p.waitForTimeout(400);
    eq(name, 'Schritt 2 aktiv', await p.locator('#cvStepper .stp.on').getAttribute('data-step'), 'rules');
    eq(name, 'Schritt 2: Karte „Voreingestellte Regeln“', await p.locator('#cvRules .sec-rules').count(), 1);
    eq(name, 'Schritt 2: Karte „Eigene Regeln“', await p.locator('#cvRules .sec-own').count(), 1);
    if (await ov() > 0) errs.push(`${name}: Überlauf in Schritt 2: ${await ov()}px`);
    await p.screenshot({path: `${L.SHOTS}/st-${name}-3-schritt2.png`, fullPage: true});

    // ---- Schritt 3 Wie umwandeln? ----
    await p.click('#wizNext'); await p.waitForSelector('#cvHow .cvtile'); await p.waitForTimeout(300);
    eq(name, 'Schritt 3: drei Kacheln', await p.locator('#cvHow .cvtile').count(), 3);
    eq(name, 'Schritt 3: Zusammenfassung', /Datei wird neu verpackt/.test(await p.textContent('#cvResultText')), true);
    await p.click('#cvHow [data-tile=hw] .pill:has-text("H.265")'); await p.waitForTimeout(500);
    eq(name, 'Codec per Pille gesetzt', await p.inputValue('#vCodec'), 'hevc');
    eq(name, 'Zusammenfassung nennt die Hardware', /mit .* umgewandelt/.test(await p.textContent('#cvResultText')), true);
    eq(name, 'Encoder-Pillen erscheinen', (await p.locator('#cvHow [data-tile=hw] .pill').count()) >= 3, true);
    await p.click('#cvHow [data-tile=dest] .pill:has-text("Eigener Ordner")'); await p.waitForTimeout(300);
    await p.fill('#cvHow [data-tile=dest] input', OUTDIR + '/' + name); await p.press('#cvHow [data-tile=dest] input', 'Enter'); await p.waitForTimeout(400);
    eq(name, 'Ziel in der Zusammenfassung', (await p.textContent('#cvResultText')).includes(name), true);
    eq(name, 'Weiter-Text', /Kontrolle/.test(await p.textContent('#wizNext')), true);
    eq(name, 'Zurück geht', await p.isVisible('#wizBack'), true);
    if (await ov() > 0) errs.push(`${name}: Überlauf in Schritt 3: ${await ov()}px`);
    await p.screenshot({path: `${L.SHOTS}/st-${name}-4-schritt3.png`, fullPage: true});

    // ---- Schritt 4 Kontrolle & Start ----
    await p.click('#wizNext'); await p.waitForSelector('.cvgrid .cvr:not(.cvh)'); await p.waitForTimeout(500);
    eq(name, 'Schritt 4 aktiv', await p.locator('#cvStepper .stp.on').getAttribute('data-step'), 'check');
    eq(name, 'Startleiste sichtbar', await p.isVisible('#stepnav'), true);
    eq(name, 'Weiter-Leiste weg', await p.isVisible('#wizNav'), false);
    eq(name, 'vier Karten', await p.locator('#cvTable .cvcard').count(), 4);
    for (const c of ['video', 'audio', 'subs', 'name']) eq(name, 'Karte ' + c, await p.locator(`#cvTable [data-card=${c}]`).count(), 1);
    for (const r of ['Video', 'Container', 'Qualität', 'Dateiname']) eq(name, 'Zeile ' + r, await row(r).count(), 1);
    eq(name, 'Info-Punkte an den Zeilen', (await p.locator('.cvgrid .cvk button.info').count()) >= 5, true);
    eq(name, 'Audio-Karte orange', await p.evaluate(() => { const e = document.querySelector('[data-card=audio] .cvchead h2'); return getComputedStyle(e).color !== getComputedStyle(document.querySelector('[data-card=video] .cvchead h2')).color; }), true);
    eq(name, 'Startknopf frei', await p.isDisabled('#start'), false);
    eq(name, 'Qualität: vier Stufen', await p.locator('.cvgrid .qs').count(), 4);
    eq(name, 'Qualität: Standard „Gut“', (await p.textContent('.cvgrid .qs.on')).replace(/\s+/g, ' ').trim().startsWith('Gut'), true);
    await p.click('.cvgrid .qs >> nth=0'); await p.waitForTimeout(300);
    eq(name, 'Stufe „Sehr gut“ gewählt', (await p.textContent('.cvgrid .qs.on')).trim().startsWith('Sehr gut'), true);
    eq(name, 'Stufe setzt die feste Zahl (CPU, H.265, „Sehr gut“)', await p.inputValue('#vCrf'), String(await p.evaluate(() => Q.value('cpu', 'hevc', 'very'))));
    eq(name, 'keine Auswahl „Art des Materials“', await p.locator('#vMaterial').count(), 0);
    if (await ov() > 0) errs.push(`${name}: Überlauf in der Kontrolle: ${await ov()}px`);
    await p.selectOption('.cvgrid select[aria-label="Auflösung"]', '480'); await p.waitForTimeout(300);
    await p.screenshot({path: `${L.SHOTS}/st-${name}-5-kontrolle.png`, fullPage: true});
    // Stepper: zurück zu Schritt 3, die Auswahl bleibt
    await p.click('#cvStepper [data-step=how]'); await p.waitForTimeout(400);
    eq(name, 'Stepper führt zurück (Schritt 3)', await p.locator('#cvHow .cvtile').count(), 3);
    await p.click('#wizNext'); await p.waitForSelector('.cvgrid .cvr:not(.cvh)'); await p.waitForTimeout(400);
    // Details: früheres Video-Fenster mit denselben Werten
    await p.click('#detailsBtn'); await p.waitForTimeout(400);
    eq(name, 'Details offen', await p.isVisible('#detailsDlg'), true);
    await p.click('[data-dtab=video]'); await p.waitForTimeout(300);
    eq(name, 'Details/Video: Codec H.265', await p.inputValue('#vCodec'), 'hevc');
    if (await ov() > 0) errs.push(`${name}: Überlauf in Details: ${await ov()}px`);
    await p.screenshot({path: `${L.SHOTS}/st-${name}-6-details.png`});
    await p.click('#detailsClose'); await p.waitForTimeout(300);
    eq(name, 'Details zu', await p.isVisible('#detailsDlg'), false);
    await p.click('#start'); await p.waitForTimeout(2500);
    eq(name, 'nach Start zurück auf der Startseite', await vis(), 'start');
    // Warteschlange und Verlauf stehen auf der Seite „Verlauf“ (Kopfzeile), gemeinsam für Video und Audio, mit Abzeichen
    await p.click('#startHistory'); await p.waitForTimeout(900);
    eq(name, 'Auftrag in Warteschlange oder Verlauf', (await p.locator('#queue .job').count()) + (await p.locator('.histentry').count()) >= 1, true);
    eq(name, 'Abzeichen „Video“', (await p.locator('#queue .kindbadge.video, .histentry .kindbadge.video').count()) >= 1, true);
    await p.screenshot({path: `${L.SHOTS}/st-${name}-7-queue.png`, fullPage: true});
    await p.click('#cancelAll'); await p.waitForTimeout(800);
    await p.click('#histBack'); await p.waitForTimeout(400);
    eq(name, 'zurück auf der Startseite', await vis(), 'start');

    // ---- Audio: eine Ansicht, orange ----
    await p.click('#startTiles [data-kind=audio]'); await p.waitForTimeout(500);
    eq(name, 'Audio: Ablauf', await vis(), 'convert');
    eq(name, 'Audio orange', await p.evaluate(() => document.documentElement.dataset.kind), 'audio');
    eq(name, 'Audio: keine Schrittleiste', await p.isVisible('#cvStepper'), false);
    eq(name, 'Audio: Dateikarte und Startleiste', (await p.isVisible('#cvFiles')) && (await p.isVisible('#stepnav')), true);
    await L.addFile(p, 'a.mp3');
    await p.waitForSelector('.cvgrid .cvr:not(.cvh)');
    for (const r of ['Format', 'Samplerate', 'Kanäle', 'Dateiname']) eq(name, 'Audio: Zeile ' + r, await row(r).count(), 1);
    eq(name, 'Audio: Satz ohne Hardware', (await p.locator('#cvSentence .tok').count()), 2);
    await p.selectOption('.cvgrid select[aria-label="Format"]', 'mp3'); await p.waitForTimeout(400);
    eq(name, 'Audio: Format im Feld', await p.inputValue('#aFormat'), 'mp3');
    eq(name, 'Audio: Qualität-Zeile', await row('Qualität').count(), 1);
    if (await ov() > 0) errs.push(`${name}: Überlauf in der Audio-Ansicht: ${await ov()}px`);
    await p.screenshot({path: `${L.SHOTS}/st-${name}-8-audio.png`, fullPage: true});
    await p.click('#detailsBtn'); await p.waitForTimeout(300);
    eq(name, 'Audio: Reiter „Audio & Untertitel“ ausgeblendet', await p.locator('#detailsTabs [data-dtab=tracks]').isVisible(), false);
    await p.click('[data-dtab=video]'); await p.waitForTimeout(250);
    eq(name, 'Audio: Details zeigt Audio-Einstellungen', await p.isVisible('#audioSettings'), true);
    eq(name, 'Audio: Details zeigt keine Video-Einstellungen', await p.isVisible('#videoSettings'), false);
    await p.click('#detailsClose');
    await ctx.close();
  }
  await b.close();
  console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'ok');
  process.exit(errs.length ? 1 : 0);
})();
