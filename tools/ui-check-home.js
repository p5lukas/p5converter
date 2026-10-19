// Prüfregel: aufgeräumte Startseite (Kopfzeile mit Konvertieren/Umbenennen/Verlauf, Schritt-Reiter erst im Assistenten, gleich große Kacheln,
// aktueller Auftrag „Datei X von Y“ statt Kreis, Warteschlange im Verlauf) in allen Ansichten.
// Voraussetzung: INDIR enthält long.mkv, Wurzelordner enthalten INDIR und OUTDIR. Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-home.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const OUT = (process.env.OUTDIR || '/tmp/out') + '/home';
(async () => {
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const post = (path, body) => p.evaluate(async ([path, body]) => (await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json(), [path, body]);
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    await L.setWorld(p, 'video'); await p.waitForTimeout(800);
    await post('/api/jobs/cancel-all', {kind: 'video'}); await p.waitForTimeout(1500);
    // ---- ruhige Startseite ----
    ok(!(await p.isVisible('#convertView')) && !(await p.isVisible('#stepnav')), name + ': Konvertieren-Ansicht auf der Startseite sichtbar');
    ok(await p.locator('#ring').count() === 0, name + ': der Kreis ist noch da');
    ok(/Gerade nichts los/.test(await p.textContent('#jobNow')), name + ': „Gerade nichts los“ fehlt');
    ok(await p.locator('#monitor .meter').count() >= 1, name + ': Auslastung fehlt');
    for (const id of ['#startFlow', '#startRename', '#startHistory']) ok(await p.locator('header.top ' + id).isVisible(), name + ': ' + id + ' nicht in der Kopfzeile');
    ok(await p.locator('#queue').count() === 1 && !(await p.locator('#viewMain #queue').count()), name + ': die Warteschlange steht noch auf der Startseite');
    if (opt.viewport.width > 1000) {
      const h = await p.evaluate(() => [document.querySelector('#savedCard').getBoundingClientRect().height, document.querySelector('#hwCard').getBoundingClientRect().height]);
      ok(Math.abs(h[0] - h[1]) <= 1.5, name + ': Hardware und Gewonnener Platz sind nicht gleich hoch: ' + h.join(' / '));
    }
    ok(await ov() <= 0, name + ': Überlauf auf der Startseite ' + await ov() + 'px');
    // Beschriftungen der Kopfzeilen-Knöpfe werden nicht abgeschnitten
    const clipped = await p.evaluate(() => [...document.querySelectorAll('.hactions .tb')].filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.id));
    ok(!clipped.length, name + ': Knöpfe in der Kopfzeile werden abgeschnitten: ' + clipped.join(','));
    await p.screenshot({path: `${L.SHOTS}/p5c-home-${name}-1-idle.png`});
    // ---- laufende Aufträge: „Datei 1 von 3“ ----
    for (let i = 0; i < 3; i++) await post('/api/jobs', {kind: 'video', items: [{path: L.INDIR + '/long.mkv'}], output: {dir: OUT, structure: 'flat', exists: 'rename'}, video: {codec: 'hevc', backend: 'cpu', crf: 24, preset: 'slow'}});
    await p.waitForTimeout(3200);
    const now = await p.textContent('#jobNow');
    ok(/Datei 1 von 3/.test(now), name + ': „Datei 1 von 3“ fehlt: ' + now.replace(/\s+/g, ' ').slice(0, 160));
    ok(/long\.mkv/.test(now) && /Schreiben: CPU/.test(now), name + ': aktueller Auftrag zeigt Datei/Hardware nicht: ' + now.replace(/\s+/g, ' ').slice(0, 200));
    ok(await p.locator('#jobNow .bar i').count() >= 1, name + ': Fortschrittsbalken fehlt');
    ok(/3/.test(await p.textContent('#histBadge')), name + ': Zähler am Verlauf-Knopf zeigt nicht 3');
    await p.screenshot({path: `${L.SHOTS}/p5c-home-${name}-2-run.png`});
    // ---- Verlauf: Warteschlange oben ----
    await p.click('#startHistory'); await p.waitForTimeout(1000);
    ok(await p.locator('#viewHistory #queue .job').count() === 3, name + ': Warteschlange im Verlauf zeigt nicht 3 Aufträge');
    ok(await p.isVisible('#cancelAll') && await p.isVisible('#conc'), name + ': „Alle abbrechen“/„Parallel“ fehlen im Verlauf');
    ok(await ov() <= 0, name + ': Überlauf im Verlauf ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-home-${name}-3-verlauf.png`, fullPage: true});
    await p.click('#cancelAll'); await p.waitForTimeout(1500);
    ok(await p.locator('#viewHistory #queue .job').count() === 0, name + ': Warteschlange nach „Alle abbrechen“ nicht leer');
    ok(await p.locator('.histentry').count() >= 3, name + ': abgebrochene Aufträge fehlen im Verlauf');
    // ---- Knöpfe der Kopfzeile aus anderen Ansichten ----
    await p.evaluate(() => { location.hash = '#settings'; }); await p.waitForTimeout(500);
    await p.click('#startFlow'); await p.waitForTimeout(600);
    ok(await p.isVisible('#convertView'), name + ': „Konvertieren“ aus den Einstellungen öffnet die Ansicht nicht');
    await L.goStep(p, 'start');
    ok(!(await p.isVisible('#convertView')), name + ': Konvertieren-Ansicht nach „Start“ nicht ausgeblendet');
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
