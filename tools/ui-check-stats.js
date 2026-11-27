// Prüfregel: „Gewonnener Platz über die Zeit“ (Startseite, Karte „Gewonnener Platz“) in allen Ansichten: Säulen der letzten zwölf Monate je Art, Umschalter Platz/Dateien/Dauer,
// Zahlen zur gewählten Säule, leerer Zustand, „Zurücksetzen“ leert auch die Monate der Art. Voraussetzung: INDIR enthält a.mp3 und hint.mkv; frischer Server.
// Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out node tools/ui-check-stats.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const OUT = (process.env.OUTDIR || '/tmp/out') + '/stats';
(async () => {
  const b = await L.launch();
  // Erst Zahlen erzeugen: zwei Lieder und ein Video (der Server zählt sie je Art im aktuellen Monat)
  {
    const ctx = await b.newContext(L.views[0][1]); const p = await ctx.newPage();
    await p.goto(L.url); await p.waitForTimeout(1200);
    const api = (path, body) => p.evaluate(async ([path, body]) => (await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json(), [path, body]);
    await api('/api/queue/pause', {on: false});
    await api('/api/jobs', {kind: 'audio', items: [{path: L.INDIR + '/a.mp3'}], output: {dir: OUT, structure: 'flat', exists: 'rename'}, audio: {format: 'flac'}});
    await api('/api/jobs', {kind: 'audio', items: [{path: L.INDIR + '/a.mp3'}], output: {dir: OUT, structure: 'flat', exists: 'rename'}, audio: {format: 'opus', mode: 'vbr', quality: 5}});
    await api('/api/jobs', {kind: 'video', items: [{path: L.INDIR + '/hint.mkv'}], output: {dir: OUT, structure: 'flat', exists: 'rename'}, video: {container: 'mkv', codec: 'hevc', backend: 'cpu', crf: 30, preset: 'ultrafast', audioMode: 'copy', subMode: 'copy'}});
    await p.waitForFunction(() => window.__p5.S.jobs.length >= 3 && window.__p5.S.jobs.every(j => j.status !== 'queued' && j.status !== 'running'), null, {timeout: 120000});
    await ctx.close();
  }
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1500);
    await p.evaluate(() => { document.querySelector('#savedCard').open = true; }); await p.waitForSelector('#savedHist .schart', {timeout: 10000}); await p.waitForTimeout(400);
    ok(await p.locator('#savedHist .sgroup').count() === 12, name + ': zwölf Monate erwartet, ' + await p.locator('#savedHist .sgroup').count());
    ok(await p.locator('#savedHist .sgroup:last-child .sbar').count() === 1 || await p.locator('#savedHist .sgroup.sel .sbar').count() === 1, name + ': der aktuelle Monat sollte eine Säule haben');
    const d = (await p.textContent('#savedHistDetail')).replace(/\s+/g, ' ');
    ok(/1 Datei ·/.test(d) && /gespart|Mehrbedarf/.test(d) && /20\d\d/.test(d), name + ': Zahlen zum Monat (Video: 1 Datei): ' + d);
    // Audio: zwei Lieder
    await p.click('#savedHist .pill[data-v=audio]'); await p.waitForTimeout(250);
    ok(/2 Dateien/.test(await p.textContent('#savedHistDetail')), name + ': Audio sollte 2 Dateien nennen: ' + await p.textContent('#savedHistDetail'));
    await p.click('#savedHist .pill[data-v=count]'); await p.waitForTimeout(250);
    ok(/>2</.test(await p.locator('#savedHist .sval').first().evaluate(e => '>' + e.textContent + '<')) || (await p.locator('#savedHist .sval').allTextContents()).includes('2'), name + ': Anzeige „Dateien“ sollte 2 über der Säule nennen');
    await p.click('#savedHist .pill[data-v=time]'); await p.waitForTimeout(250);
    ok(await p.locator('#savedHist .sval').count() >= 1, name + ': Anzeige „Dauer“ ohne Zahl');
    await p.click('#savedHist .pill[data-v=saved]'); await p.waitForTimeout(250);
    // eine andere Säule (leerer Monat) antippen
    await p.locator('#savedHist .sgroup').first().click({force: true}); await p.waitForTimeout(250);
    ok(/keine Umwandlung/.test(await p.textContent('#savedHistDetail')), name + ': ein leerer Monat sollte „keine Umwandlung“ nennen: ' + await p.textContent('#savedHistDetail'));
    ok(await ov() <= 0, name + ': Überlauf mit Grafik ' + await ov() + 'px');
    const bb = await p.locator('#savedHist .schart').boundingBox(), vp = p.viewportSize();
    ok(bb && bb.x >= -1 && bb.x + bb.width <= vp.width + 1 && bb.height > 60, name + ': Grafik ragt heraus oder ist zu flach');
    await p.screenshot({path: `${L.SHOTS}/p5c-stats-${name}.png`, fullPage: true});
    await ctx.close();
  }
  // Zurücksetzen von Video leert auch die Monate von Video (Audio bleibt)
  {
    const ctx = await b.newContext(L.views[0][1]); const p = await ctx.newPage();
    await p.goto(L.url); await p.waitForTimeout(1500);
    await p.evaluate(() => { document.querySelector('#savedCard').open = true; });
    await p.click('.savedreset[data-kind=video]'); await p.click('#savedResetYes'); await p.waitForTimeout(1500);
    const h = await p.evaluate(async () => (await fetch('/api/stats/history')).json());
    ok(h.video.length === 0 && h.audio.length === 1, 'Zurücksetzen von Video: ' + JSON.stringify({v: h.video.length, a: h.audio.length}));
    await p.waitForSelector('#savedHist', {timeout: 5000});
    await p.click('#savedHist .pill[data-v=video]'); await p.waitForTimeout(300);
    ok(await p.locator('#savedHistEmpty').count() === 1, 'leerer Zustand für Video fehlt');
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
