// Prüfregel: Fortschrittsbalken mit Regen („Regenfront“) bei laufenden Aufträgen, Startseite und Verlauf, in allen Ansichten: dicker Balken,
// Canvas mit Zeichen in der Füllung (bewegt sich, bleibt in der Füllung), abschaltbar (Einstellung), aus bei „Bewegung reduzieren“,
// normaler Balken bei fertigen Aufträgen, nie mehr als RAINBAR_MAX Balken gleichzeitig. Voraussetzung: INDIR enthält long.mkv und multi.mkv
// (Testvideos), Wurzelordner INDIR und OUTDIR; frischer Server. Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-rainbar.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const OUT = (process.env.OUTDIR || '/tmp/out') + '/rainbar';
const setNoRain = v => fetch(L.url + '/api/settings').then(r => r.json()).then(s => { s.settings.noRain = v; return fetch(L.url + '/api/settings', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(s.settings)}); });
// wie der Nutzer: Einstellungen → Allgemein → „Matrix-Regen“ (die Oberfläche übernimmt den Wert sofort)
const toggleRain = async (p, on) => { await p.evaluate(() => { location.hash = '#settings/general'; }); await p.waitForTimeout(500); const cb = p.locator('.setrow', {hasText: 'Matrix-Regen'}).locator('input[type=checkbox]'); on ? await cb.check() : await cb.uncheck(); await p.waitForTimeout(700); await p.evaluate(() => { location.hash = '#history'; }); await p.waitForTimeout(900); };
// wie viele Pixel der Zeichenfläche sind belegt, und bis wohin (Anteil der Breite)
const paint = (p, sel) => p.evaluate(sel => { const c = document.querySelector(sel); if (!c) return null; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, maxX = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 20) { n++; if (x > maxX) maxX = x; }
  return {n, maxX: maxX / c.width, sum: d.reduce((a, v, i) => (i % 97 === 0 ? a + v : a), 0)}; }, sel);
(async () => {
  await setNoRain(false);
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const api = (path, body) => p.evaluate(async ([path, body]) => (await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json(), [path, body]);
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    await api('/api/queue/pause', {on: false}); await api('/api/jobs/cancel-all', {kind: ''}); await api('/api/concurrency', {kind: 'video', n: 2}); await p.waitForTimeout(1000);
    for (const f of ['long.mkv', 'multi.mkv']) await api('/api/jobs', {kind: 'video', items: [{path: L.INDIR + '/' + f}], output: {dir: OUT, structure: 'flat', exists: 'rename'}, video: {codec: 'hevc', backend: 'cpu', crf: 24, preset: 'slow'}});
    await p.waitForSelector('#jobNow .bar.rain', {timeout: 15000}); await p.waitForTimeout(2500);
    // ---- Startseite ----
    const hb = await p.locator('#jobNow .bar.rain').first().boundingBox();
    ok(hb && hb.height >= 20, name + ': Balken auf der Startseite nicht dick genug: ' + (hb && hb.height));
    ok(await p.locator('#jobNow .bar.thin.rain').count() === 0, name + ': der dünne Gesamtbalken darf keinen Regen tragen');
    ok(await p.locator('#jobNow .bar.rain canvas.rainbar').count() === 1, name + ': Canvas im Balken fehlt');
    const pa = await paint(p, '#jobNow .bar.rain canvas.rainbar');
    ok(pa && pa.n > 200, name + ': im Balken wird nichts gezeichnet: ' + JSON.stringify(pa));
    const prog = await p.evaluate(() => { const r = document.querySelector('#jobNow .bar.rain'), i = r.querySelector('i'); return i.getBoundingClientRect().width / r.getBoundingClientRect().width; });
    ok(pa && pa.maxX <= prog + 0.03, name + ': Regen reicht über die Füllung hinaus (Füllung ' + prog.toFixed(2) + ', Regen bis ' + (pa && pa.maxX.toFixed(2)) + ')');
    const f1 = await p.evaluate(() => S.rainBarFrames); const s1 = (await paint(p, '#jobNow .bar.rain canvas.rainbar')).sum; await p.waitForTimeout(700);
    const f2 = await p.evaluate(() => S.rainBarFrames); const s2 = (await paint(p, '#jobNow .bar.rain canvas.rainbar')).sum;
    ok(f2 - f1 >= 8, name + ': Animation läuft nicht (Bilder ' + f1 + ' → ' + f2 + ')');
    ok(s1 !== s2, name + ': Bild verändert sich nicht');
    ok(await ov() <= 0, name + ': Überlauf Startseite ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-rainbar-${name}-1-start.png`});
    // ---- Verlauf: alle laufenden, Wartende normal ----
    await p.click('#startHistory'); await p.waitForTimeout(900);
    const nrun = await p.locator('#queue .job.running').count();
    ok(nrun >= 1 && await p.locator('#queue .job.running .bar.rain canvas.rainbar').count() === nrun, name + ': Verlauf: jeder laufende Auftrag braucht den Regen-Balken (' + nrun + ')');
    ok(await p.locator('#queue .job:not(.running) .bar.rain').count() === 0, name + ': nur laufende Aufträge bekommen den Regen-Balken');
    const jb = await p.locator('#queue .job.running .bar.rain').first().boundingBox();
    ok(jb && jb.height >= 20, name + ': Balken im Verlauf nicht dick genug');
    ok(await ov() <= 0, name + ': Überlauf Verlauf ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-rainbar-${name}-2-verlauf.png`});
    // der Neuaufbau der Karten (jede Abfrage) zerstört den Regen nicht dauerhaft
    await p.waitForTimeout(2500);
    const nrun2 = await p.locator('#queue .job.running').count();
    ok(nrun2 >= 1 && await p.locator('#queue .job.running .bar.rain canvas.rainbar').count() === nrun2, name + ': nach dem Neuaufbau fehlt der Regen im Balken');
    // ---- abschaltbar ----
    await toggleRain(p, false); await p.waitForTimeout(1800);
    ok(await p.locator('.bar.rain').count() === 0 && await p.locator('canvas.rainbar').count() === 0, name + ': ausgeschaltet darf es keinen Regen-Balken geben');
    const nb = await p.locator('#queue .job.running .bar').first().boundingBox();
    ok(nb && nb.height <= 10, name + ': ausgeschaltet soll der Balken wieder dünn sein: ' + (nb && nb.height));
    await toggleRain(p, true); await p.waitForTimeout(1800);
    ok(await p.locator('#queue .job.running .bar.rain').count() === await p.locator('#queue .job.running').count() && await p.locator('#queue .job.running').count() >= 1, name + ': wieder eingeschaltet kommt der Regen zurück');
    await api('/api/jobs/cancel-all', {kind: ''}); await p.waitForTimeout(1500);
    ok(await p.locator('.bar.rain').count() === 0, name + ': nach dem Abbruch bleibt ein Regen-Balken stehen');
    await ctx.close();
  }
  // ---- „Bewegung reduzieren“: nie Regen-Balken ----
  {
    const ctx = await b.newContext({...L.views[0][1], reducedMotion: 'reduce'}); const p = await ctx.newPage();
    await p.goto(L.url); await p.waitForTimeout(1300);
    await p.evaluate(async path => { await fetch('/api/jobs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({kind: 'video', items: [{path}], output: {dir: '/tmp/out/rainbar', structure: 'flat', exists: 'rename'}, video: {codec: 'hevc', backend: 'cpu', crf: 24, preset: 'slow'}})}); }, L.INDIR + '/long.mkv');
    await p.waitForSelector('#jobNow .bar', {timeout: 15000}); await p.waitForTimeout(2500);
    ok(await p.locator('.bar.rain').count() === 0 && await p.locator('canvas.rainbar').count() === 0, 'reduzierte Bewegung: kein Regen-Balken erlaubt');
    await p.evaluate(async () => { await fetch('/api/jobs/cancel-all', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({kind: ''})}); });
    await ctx.close();
  }
  await setNoRain(false);
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
