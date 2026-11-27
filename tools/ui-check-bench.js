// Prüfregel: Encoder-Schnelltest (Einstellungen → Hardware) in allen Ansichten: Knopf, Fortschritt, Tabelle (Encoder, Geschwindigkeit, Größe), Empfehlung bzw.
// Hinweis „nur ein Encoder“, „Als bevorzugt übernehmen“, Abbrechen. Der Server misst mit einer 2-Sekunden-Quelle (P5_TEST_BENCH_SECONDS, tools/run-ui-checks.sh).
// Voraussetzung: frischer Server (kein gemerktes Ergebnis). Aufruf: P5_TEST_BENCH_SECONDS=2 node tools/ui-check-bench.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
(async () => {
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung|409/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const api = (path, body) => p.evaluate(async ([path, body]) => (await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json(), [path, body]);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear());
    await api('/api/queue/pause', {on: false}); await api('/api/jobs/cancel-all', {kind: ''});
    await p.goto(L.url + '/#settings/hardware'); await p.waitForSelector('#benchStart', {timeout: 15000}); await p.waitForTimeout(500);
    ok(/Schnelltest/.test(await p.textContent('#viewSettings')) && await p.locator('#benchBox').isVisible(), name + ': Abschnitt „Schnelltest“ fehlt');
    ok(/etwa eine Minute/.test(await p.textContent('#benchBox')) && /nichts von deinen Dateien/.test(await p.textContent('#benchBox')), name + ': Erklärung fehlt');
    // Abbrechen
    await p.click('#benchStart'); await p.waitForSelector('#benchCancel', {timeout: 5000});
    await p.click('#benchCancel'); await p.waitForSelector('#benchStart', {timeout: 30000}); await p.waitForTimeout(600);
    ok(/Abgebrochen/.test(await p.textContent('#benchBox')), name + ': nach „Abbrechen“ steht „Abgebrochen“ da: ' + (await p.textContent('#benchBox')).replace(/\s+/g, ' ').slice(0, 120));
    // voller Lauf
    await p.click('#benchStart');
    await p.waitForFunction(() => document.querySelectorAll('#benchBox .benchrow').length > 0, null, {timeout: 15000});
    await p.screenshot({path: `${L.SHOTS}/p5c-bench-${name}-1-laeuft.png`, fullPage: true});
    await p.waitForSelector('#benchStart', {timeout: 150000}); await p.waitForTimeout(600);
    const rows = await p.locator('#benchBox .benchrow').count();
    ok(rows >= 3, name + ': mindestens CPU mit H.264, H.265 und AV1 erwartet, ' + rows + ' Zeilen');
    const t = (await p.textContent('#benchBox')).replace(/\s+/g, ' ');
    ok(/× Echtzeit/.test(t) && /fps/.test(t) && /Mbit\/s/.test(t) && /MB|KB/.test(t), name + ': Zahlen fehlen: ' + t.slice(0, 200));
    ok(/Noch einmal messen/.test(await p.textContent('#benchStart')), name + ': nach dem Lauf: „Noch einmal messen“');
    ok(await p.locator('#benchOnly').count() === 1 || await p.locator('.benchrec').count() === 1, name + ': weder Empfehlung noch Hinweis „nur ein Encoder“');
    ok(await ov() <= 0, name + ': Überlauf mit Tabelle ' + await ov() + 'px');
    const tb = await p.locator('#benchBox .tbody').boundingBox(), vp = p.viewportSize();
    ok(tb && tb.x + tb.width <= vp.width + 1, name + ': Tabelle ragt rechts heraus');
    await p.screenshot({path: `${L.SHOTS}/p5c-bench-${name}-2-ergebnis.png`, fullPage: true});
    // gemerkt: nach dem Neuladen steht das Ergebnis wieder da
    await p.reload(); await p.waitForSelector('#benchBox .benchrow', {timeout: 15000});
    ok(await p.locator('#benchBox .benchrow').count() === rows, name + ': das gemerkte Ergebnis fehlt nach dem Neuladen');
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
