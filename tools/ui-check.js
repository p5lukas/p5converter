// Prüft die eine Ansicht „Konvertieren“ in allen Ansichten: Startseite, Dateien, Satz, Tabelle „Vorher → Nachher“, Fenster „Details“,
// Start → Warteschlange/Verlauf; beide Welten.
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
    eq(name, 'Startleiste nicht auf der Startseite', await p.isVisible('#stepnav'), false);
    eq(name, 'keine Schritt-Reiter mehr', await p.locator('#steps').count(), 0);
    for (const id of ['#startFlow', '#startRename', '#startHistory']) eq(name, id + ' in der Kopfzeile', await p.locator('header.top ' + id).isVisible(), true);
    await p.screenshot({ path: `${L.SHOTS}/st-${name}-1-start.png`, fullPage: true });
    await p.click('#startFlow'); await p.waitForTimeout(400);
    eq(name, 'eine Ansicht „Konvertieren“', await vis(), 'convert');
    eq(name, 'Startleiste sichtbar', await p.isVisible('#stepnav'), true);
    eq(name, 'ohne Dateien: Startknopf gesperrt', await p.isDisabled('#start'), true);
    eq(name, 'ohne Dateien: Platzhalter statt Tabelle', await p.locator('#cvTable .cvempty').count(), 1);
    await p.screenshot({ path: `${L.SHOTS}/st-${name}-2-leer.png` });
    await L.addFile(p, 'long.mkv');
    await p.waitForSelector('.cvgrid .cvr:not(.cvh)');
    eq(name, 'Satz mit Ziel und Prüfen', (await p.locator('#cvSentence .tok').count()), 2);
    for (const row of ['Video', 'Container', 'Dateiname']) eq(name, 'Zeile ' + row, await p.locator('.cvgrid .cvk', {hasText: new RegExp('^' + row + '$', 'i')}).count(), 1);
    eq(name, 'Startknopf frei', await p.isDisabled('#start'), false);
    if (await ov() > 0) errs.push(`${name}: Überlauf in der Konvertieren-Ansicht: ${await ov()}px`);
    // Codec ändern → Satz zeigt Hardware, Tabelle zeigt Qualität in Stufen
    await p.selectOption('.cvgrid select[aria-label="Video-Codec"]', 'hevc'); await p.waitForTimeout(500);
    eq(name, 'Satz mit Hardware nach Codec-Wechsel', (await p.locator('#cvSentence .tok').count()), 3);
    eq(name, 'Qualität: vier Stufen', await p.locator('.cvgrid .qs').count(), 4);
    eq(name, 'Qualität: Standard „Gut“', (await p.textContent('.cvgrid .qs.on')).replace(/\s+/g, ' ').trim().startsWith('Gut'), true);
    await p.click('.cvgrid .qs >> nth=0'); await p.waitForTimeout(300);
    eq(name, 'Stufe „Sehr gut“ gewählt', (await p.textContent('.cvgrid .qs.on')).trim().startsWith('Sehr gut'), true);
    eq(name, 'Stufe setzt die Zahl (CPU, H.265, „Sehr gut“)', await p.inputValue('#vCrf'), String(await p.evaluate(() => Q.value('cpu', 'hevc', 'very', 'standard', qHeight()))));
    await p.selectOption('.cvgrid select[aria-label="Auflösung"]', '480'); await p.waitForTimeout(300);
    await p.screenshot({ path: `${L.SHOTS}/st-${name}-3-tabelle.png`, fullPage: true });
    // Satz: Ziel-Fenster
    await p.click('#cvSentence .tok >> nth=-2'); await p.waitForTimeout(300);
    eq(name, 'kleines Fenster zum Ziel', await p.locator('.cvpop').count(), 1);
    await p.selectOption('.cvpop select[aria-label="Speicherort"]', 'custom'); await p.waitForTimeout(300);
    await p.fill('.cvpop input', OUTDIR + '/' + name); await p.press('.cvpop input', 'Enter'); await p.click('.cvpop input >> xpath=../.. >> select[aria-label="Struktur"]').catch(() => {});
    await p.screenshot({ path: `${L.SHOTS}/st-${name}-4-ziel.png` });
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    eq(name, 'Fenster zu', await p.locator('.cvpop').count(), 0);
    eq(name, 'Ziel im Satz', (await p.textContent('#cvSentence')).includes(name), true);
    // Details: früheres Video-Fenster mit denselben Werten
    await p.click('#detailsBtn'); await p.waitForTimeout(400);
    eq(name, 'Details offen', await p.isVisible('#detailsDlg'), true);
    await p.click('[data-dtab=video]'); await p.waitForTimeout(300);
    eq(name, 'Details/Video: Codec H.265', await p.inputValue('#vCodec'), 'hevc');
    if (await ov() > 0) errs.push(`${name}: Überlauf in Details: ${await ov()}px`);
    await p.screenshot({ path: `${L.SHOTS}/st-${name}-5-details.png` });
    await p.click('#detailsClose'); await p.waitForTimeout(300);
    eq(name, 'Details zu', await p.isVisible('#detailsDlg'), false);
    await p.click('#start'); await p.waitForTimeout(2500);
    eq(name, 'nach Start zurück auf der Startseite', await vis(), 'start');
    // Warteschlange und Verlauf stehen auf der Seite „Verlauf“ (Kopfzeile)
    await p.click('#startHistory'); await p.waitForTimeout(900);
    eq(name, 'Auftrag in Warteschlange oder Verlauf', (await p.locator('#queue .job').count()) + (await p.locator('.histentry').count()) >= 1, true);
    await p.screenshot({ path: `${L.SHOTS}/st-${name}-6-queue.png`, fullPage: true });
    await p.click('#cancelAll'); await p.waitForTimeout(800);
    await p.click('#histBack'); await p.waitForTimeout(400);
    eq(name, 'zurück auf der Startseite', await vis(), 'start');

    // ---- Audio ----
    await L.setWorld(p, 'audio');
    eq(name, 'Audio: Start', await vis(), 'start');
    eq(name, 'Audio: keine Hardware-Kachel', await p.isVisible('#hwCard'), false);
    await p.click('#startFlow'); await p.waitForTimeout(300);
    await L.addFile(p, 'a.mp3');
    await p.waitForSelector('.cvgrid .cvr:not(.cvh)');
    for (const row of ['Format', 'Samplerate', 'Kanäle', 'Dateiname']) eq(name, 'Audio: Zeile ' + row, await p.locator('.cvgrid .cvk', {hasText: new RegExp('^' + row + '$', 'i')}).count(), 1);
    eq(name, 'Audio: Satz ohne Hardware', (await p.locator('#cvSentence .tok').count()), 2);
    await p.selectOption('.cvgrid select[aria-label="Format"]', 'mp3'); await p.waitForTimeout(400);
    eq(name, 'Audio: Format im Feld', await p.inputValue('#aFormat'), 'mp3');
    eq(name, 'Audio: Qualität-Zeile', await p.locator('.cvgrid .cvk', {hasText: /^Qualität$/i}).count(), 1);
    if (await ov() > 0) errs.push(`${name}: Überlauf in der Audio-Ansicht: ${await ov()}px`);
    await p.screenshot({ path: `${L.SHOTS}/st-${name}-7-audio.png`, fullPage: true });
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
})();
