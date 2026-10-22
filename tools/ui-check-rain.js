// Prüfregel: Matrix-Regen bei erfolgreich fertigen Aufträgen (Startseite: Karte des aktuellen Auftrags, Verlauf: Warteschlange); kurz, abschaltbar
// (Einstellungen → Allgemein), aus bei „Bewegung reduzieren“ und bei Fehlern. Voraussetzung: INDIR enthält hint.mkv, Wurzelordner INDIR und OUTDIR.
// Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-rain.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const OUT = (process.env.OUTDIR || '/tmp/out') + '/rain';
const setNoRain = v => fetch(L.url + '/api/settings').then(r => r.json()).then(s => { s.settings.noRain = v; return fetch(L.url + '/api/settings', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(s.settings)}); });
(async () => {
  await setNoRain(false);
  const b = await L.launch();
  for (const [name, opt] of [L.views[0], L.views[1]]) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const post = (path, body) => p.evaluate(async ([path, body]) => (await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json(), [path, body]);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1500);
    // ---- die Funktion: läuft, ist durchsichtig, räumt auf, läuft nie doppelt ----
    const r1 = await p.evaluate(() => { const a = matrixRain(document.querySelector('#hero')), c = document.querySelectorAll('#hero canvas.rain').length, b2 = matrixRain(document.querySelector('#hero')); return {a, c, b2, n: S.rainCount}; });
    ok(r1.a === true && r1.c === 1 && r1.b2 === false && r1.n === 1, name + ': Regen startet nicht richtig: ' + JSON.stringify(r1));
    await p.screenshot({path: `${L.SHOTS}/p5c-rain-${name}-1.png`});
    await p.waitForTimeout(2600);
    ok(await p.locator('canvas.rain').count() === 0 && await p.locator('.rainhost').count() === 0, name + ': der Regen räumt nicht auf');
    // ---- Einstellung ----
    await p.evaluate(() => { location.hash = '#settings/general'; }); await p.waitForTimeout(500);
    const cb = p.locator('.setrow', {hasText: 'Matrix-Regen'}).locator('input[type=checkbox]');
    ok(await cb.count() === 1 && await cb.isChecked(), name + ': Einstellung „Matrix-Regen“ fehlt oder ist nicht an');
    await cb.uncheck(); await p.waitForTimeout(700);
    ok((await (await fetch(L.url + '/api/settings')).json()).settings.noRain === true, name + ': Abschalten nicht gespeichert');
    ok(await p.evaluate(() => matrixRain(document.body.firstElementChild)) === false && await p.locator('canvas.rain').count() === 0, name + ': ausgeschaltet darf kein Regen laufen');
    await cb.check(); await p.waitForTimeout(700);
    ok((await (await fetch(L.url + '/api/settings')).json()).settings.noRain === false, name + ': Anschalten nicht gespeichert');
    await p.evaluate(() => { location.hash = ''; }); await p.waitForTimeout(500);
    // ---- echter Auftrag: Regen auf der Startseite bei Erfolg, keiner bei einem Fehler ----
    await p.evaluate(() => { window.__rain = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('rain')) window.__rain.push(n.parentElement.id); }))).observe(document.body, {childList: true, subtree: true}); });
    await post('/api/jobs', {kind: 'video', items: [{path: L.INDIR + '/gibt-es-nicht.mkv'}], output: {dir: OUT, structure: 'flat', exists: 'rename'}, video: {container: 'mkv', codec: 'copy'}});
    await p.waitForTimeout(4000);
    ok((await p.evaluate(() => window.__rain)).length === 0, name + ': bei einem Fehler darf es nicht regnen');
    await post('/api/jobs', {kind: 'video', items: [{path: L.INDIR + '/hint.mkv'}], output: {dir: OUT, structure: 'flat', exists: 'overwrite'}, video: {container: 'mkv', codec: 'copy'}});
    await p.waitForTimeout(6000);
    ok((await p.evaluate(() => window.__rain)).includes('hero'), name + ': bei Erfolg sollte es über der Startseiten-Karte regnen: ' + JSON.stringify(await p.evaluate(() => window.__rain)));
    // ---- Verlauf: Regen über der Warteschlange ----
    await p.click('#startHistory'); await p.waitForTimeout(800);
    await p.evaluate(() => { window.__rain = []; });
    await post('/api/jobs', {kind: 'audio', items: [{path: L.INDIR + '/a.mp3'}], output: {dir: OUT, structure: 'flat', exists: 'overwrite'}, audio: {format: 'flac'}});
    await p.waitForTimeout(6000);
    ok((await p.evaluate(() => window.__rain)).includes('queuePanel'), name + ': im Verlauf sollte es über der Warteschlange regnen: ' + JSON.stringify(await p.evaluate(() => window.__rain)));
    await ctx.close();
  }
  // ---- „Bewegung reduzieren“: nie Regen ----
  {
    const ctx = await b.newContext({...L.views[0][1], reducedMotion: 'reduce'}); const p = await ctx.newPage();
    await p.goto(L.url); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => matrixRain(document.querySelector('#hero'))) === false && await p.locator('canvas.rain').count() === 0, 'reduzierte Bewegung: es darf nicht regnen');
    await ctx.close();
  }
  await setNoRain(false);
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
