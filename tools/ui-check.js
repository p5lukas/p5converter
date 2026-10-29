// Prüft den Ablauf in allen Ansichten: Startseite mit Voreinstellungen (nur Video) und den Kacheln Video/Audio, Video in zwei Schritten (Dateien, Konvertieren mit
// den Karten Video, Ton, Untertitel, Regeln, Name & Ziel, Prüfen), Start → Warteschlange/Verlauf; Audio in einer Ansicht (Karten Audio-Datei, Name & Ziel, Prüfen).
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
    eq(name, 'Voreinstellungen nur für Video: Kachel „+ Neue Voreinstellung“', await p.locator('#startPresets #wizStart').count(), 1);
    eq(name, 'mindestens eine Video-Voreinstellung als Knopf', (await p.locator('#startPresets .pbtn[data-preset]').count()) >= 1, true);
    eq(name, 'Hardware und Gewonnener Platz eingeklappt', (await p.evaluate(() => document.querySelector('#hwCard').open)) || (await p.evaluate(() => document.querySelector('#savedCard').open)), false);
    eq(name, 'Startleisten nicht auf der Startseite', (await p.isVisible('#stepnav')) || (await p.isVisible('#wizNav')), false);
    eq(name, 'keine Schritt-Reiter auf der Startseite', await p.isVisible('#cvStepper'), false);
    for (const id of ['#startRename', '#startHistory']) eq(name, id + ' in der Kopfzeile', await p.locator('header.top ' + id).isVisible(), true);
    await p.click('#savedCard summary'); await p.waitForTimeout(200);
    eq(name, 'Gewonnener Platz zeigt Video und Audio', await p.locator('#savedBody .savedcol').count(), 2);
    await p.click('#savedCard summary');
    eq(name, 'Startseite grün', await p.evaluate(() => document.documentElement.dataset.kind || ''), '');
    if (await ov() > 0) errs.push(`${name}: Überlauf auf der Startseite: ${await ov()}px`);
    await p.screenshot({path: `${L.SHOTS}/st-${name}-1-start.png`, fullPage: true});

    // ---- Video: Schritt 1 Dateien ----
    await p.click('#startTiles [data-kind=video]'); await p.waitForTimeout(500);
    eq(name, 'Ablauf sichtbar', await vis(), 'convert');
    eq(name, 'Schrittleiste mit zwei Schritten', await p.locator('#cvStepper .stp').count(), 2);
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

    // ---- Schritt 2 Konvertieren ----
    await p.click('#wizNext'); await p.waitForSelector('.cvgrid .cvr:not(.cvh)'); await p.waitForTimeout(500);
    eq(name, 'Schritt 2 aktiv', await p.locator('#cvStepper .stp.on').getAttribute('data-step'), 'check');
    eq(name, 'Startleiste sichtbar', await p.isVisible('#stepnav'), true);
    eq(name, 'Weiter-Leiste weg', await p.isVisible('#wizNav'), false);
    eq(name, 'keine Kopfzeile „Konvertieren“ mehr (Text-Diät)', await p.locator('#cvHead').count(), 0);
    for (const c of ['video', 'audio', 'subs', 'rules', 'name', 'check']) eq(name, 'Karte ' + c, await p.locator(`#cvTable [data-card=${c}]`).count(), 1);
    eq(name, 'Video-Karte offen, Karten Regeln/Name/Prüfen zu', await p.evaluate(() => ['video', 'rules', 'name', 'check'].map(c => !document.querySelector(`[data-card=${c}]`).classList.contains('closed')).join()), 'true,false,false,false');
    eq(name, 'Zeilen in der Video-Karte (Video, Container)', (await row('Video').count()) + (await row('Container').count()), 2);
    eq(name, 'Codec Remux: keine Qualität/Encoder-Zeile', (await row('Qualität').count()) + (await row('Encoder').count()), 0);
    eq(name, 'Audio-Karte orange', await p.evaluate(() => { const e = document.querySelector('[data-card=audio] .cvchead h2'); return getComputedStyle(e).color !== getComputedStyle(document.querySelector('[data-card=video] .cvchead h2')).color; }), true);
    // Codec setzen: Qualität, Geschwindigkeit, Encoder und Probeclip stehen sichtbar in der Video-Karte (nichts versteckt)
    await p.selectOption('.cvgrid select[aria-label="Video-Codec"]', 'hevc'); await p.waitForTimeout(500);
    eq(name, 'Codec per Auswahl gesetzt', await p.inputValue('#vCodec'), 'hevc');
    for (const r of ['Video', 'Container', 'Qualität', 'Geschwindigkeit', 'Probeclip', 'Encoder']) eq(name, 'Zeile ' + r, await row(r).count(), 1);
    eq(name, 'Auflösung „wie Quelle“ zeigt die Quelle', /wie Quelle \(\d+p\)/.test(await p.textContent('.cvgrid select[aria-label="Auflösung"] option:checked')), true);
    eq(name, 'Geschwindigkeit: vier Pillen, „Mittel“ gewählt', (await p.locator('.cvgrid .pills[aria-label="Geschwindigkeit"] .pill').count()) + ':' + (await p.textContent('.cvgrid .pills[aria-label="Geschwindigkeit"] .pill.on')), '4:Mittel');
    await p.click('.cvgrid .pills[aria-label="Geschwindigkeit"] .pill:has-text("Langsam")'); await p.waitForTimeout(300);
    eq(name, 'Geschwindigkeit im Feld', await p.inputValue('#vPreset'), 'slow');
    eq(name, 'Encoder-Pillen (mindestens Automatisch, CPU)', (await p.locator('.cvgrid .pills[aria-label="Encoder"] .pill').count()) >= 2, true);
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
    // Karte „Name & Ziel“ aufklappen: Zielordner wählen, Name bleibt; Karte „Prüfen“
    await p.click('[data-card=name] .cvchead'); await p.waitForTimeout(400);
    eq(name, 'Name & Ziel: Karte offen', await p.evaluate(() => !document.querySelector('[data-card=name]').classList.contains('closed')), true);
    await p.click('[data-card=name] .pill:has-text("Eigener Ordner")'); await p.waitForTimeout(300);
    await p.fill('[data-card=name] input[aria-label="Zielordner"]', OUTDIR + '/' + name); await p.press('[data-card=name] input[aria-label="Zielordner"]', 'Enter'); await p.waitForTimeout(400);
    eq(name, 'Ziel im Feld', (await p.inputValue('#outDir')).endsWith('/' + name), true);
    eq(name, 'Namensfeld (Muster) im Karteninhalt eingehängt', await p.locator('[data-card=name] #pattern').count(), 1);
    if (await ov() > 0) errs.push(`${name}: Überlauf in Name & Ziel: ${await ov()}px`);
    await p.screenshot({path: `${L.SHOTS}/st-${name}-6-details.png`, fullPage: true});
    await p.click('[data-card=name] .cvtog'); await p.waitForTimeout(300);
    eq(name, 'Name & Ziel einklappbar', await p.evaluate(() => document.querySelector('[data-card=name]').classList.contains('closed')), true);
    eq(name, 'Namensfeld wieder im Speicher, nicht verloren', await p.evaluate(() => !!document.querySelector('#fieldStore #pattern')), true);
    // Stepper: zurück zu Schritt 1, die Auswahl bleibt; wieder vor
    await p.click('#cvStepper [data-step=files]'); await p.waitForTimeout(400);
    eq(name, 'Stepper führt zurück (Schritt 1)', await p.isVisible('#cvFiles'), true);
    await p.click('#wizNext'); await p.waitForSelector('.cvgrid .cvr:not(.cvh)'); await p.waitForTimeout(400);
    eq(name, 'Auswahl blieb: Codec H.265', await p.inputValue('#vCodec'), 'hevc');
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
    eq(name, 'Audio: keine Voreinstellungen (weder Leiste noch Speichern)', (await p.isVisible('#presetBar')) || (await p.isVisible('#savePreset')), false);
    eq(name, 'Audio: Dateikarte und Startleiste', (await p.isVisible('#cvFiles')) && (await p.isVisible('#stepnav')), true);
    await L.addFile(p, 'a.mp3');
    await p.waitForSelector('.cvgrid .cvr:not(.cvh)');
    for (const r of ['Format', 'Samplerate', 'Kanäle']) eq(name, 'Audio: Zeile ' + r, await row(r).count(), 1);
    eq(name, 'Audio: Karten Audio-Datei, Name & Ziel, Prüfen', await p.locator('#cvTable .cvcard').count(), 3);
    eq(name, 'Audio: kein Satz mehr', await p.locator('#cvSentence').count(), 0);
    await p.selectOption('.cvgrid select[aria-label="Format"]', 'mp3'); await p.waitForTimeout(400);
    eq(name, 'Audio: Format im Feld', await p.inputValue('#aFormat'), 'mp3');
    eq(name, 'Audio: Qualität-Zeile', await row('Qualität').count(), 1);
    if (await ov() > 0) errs.push(`${name}: Überlauf in der Audio-Ansicht: ${await ov()}px`);
    await p.screenshot({path: `${L.SHOTS}/st-${name}-8-audio.png`, fullPage: true});
    await p.click('[data-card=name] .cvchead'); await p.waitForTimeout(300);
    eq(name, 'Audio: Name & Ziel aufklappbar', await p.locator('[data-card=name] .pill').count() >= 3, true);
    await ctx.close();
  }
  await b.close();
  console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'ok');
  process.exit(errs.length ? 1 : 0);
})();
