// Prüfregel: Die Verlauf-Seite zeigt oben die laufende Warteschlange und wird alle paar Sekunden neu gezeichnet. Dabei darf die Seite nicht von selbst
// nach oben wandern (Fehler bis 0.5.4: neu gezeichnete Balken waren kurz dünn, keepView glich das aus, beim Dickermachen rutschte die Seite jedes Mal um 16 px).
// Voraussetzung: INDIR enthält long.mkv, Wurzelordner INDIR und OUTDIR; frischer Server. Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out node tools/ui-check-histdrift.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const OUT = (process.env.OUTDIR || '/tmp/out') + '/histdrift';
(async () => {
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    const api = (path, body) => p.evaluate(async ([path, body]) => (await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json(), [path, body]);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    await api('/api/queue/pause', {on: false}); await api('/api/jobs/cancel-all', {kind: ''}); await api('/api/history/clear', {kind: 'all'}); await api('/api/concurrency', {kind: 'video', n: 1});
    // lange Liste im Verlauf (fehlgeschlagene Aufträge sind sofort fertig), danach ein laufender und zwei wartende Aufträge
    for (let i = 0; i < 40; i++) await api('/api/jobs', {kind: 'video', items: [{path: L.INDIR + '/gibt-es-nicht-' + i + '.mkv'}], output: {dir: OUT, structure: 'flat', exists: 'rename'}, video: {container: 'mkv', codec: 'copy'}});
    await p.waitForTimeout(6000);
    for (let i = 0; i < 3; i++) await api('/api/jobs', {kind: 'video', items: [{path: L.INDIR + '/long.mkv'}], output: {dir: OUT, structure: 'flat', exists: 'rename'}, video: {container: 'mkv', codec: 'hevc', backend: 'cpu', crf: 24, preset: 'slow'}});
    await p.waitForTimeout(3000);
    await p.click('#startHistory'); await p.waitForSelector('.histentry', {timeout: 10000}); await p.waitForTimeout(1000);
    await p.evaluate(() => window.scrollTo(0, 600)); await p.waitForTimeout(300);
    const y0 = await p.evaluate(() => Math.round(scrollY));
    ok(y0 >= 300, name + ': Testaufbau: die Seite lässt sich nicht weit genug scrollen (' + y0 + ')');
    const ys = [];
    for (let i = 0; i < 16; i++) { ys.push(await p.evaluate(() => Math.round(scrollY))); await p.waitForTimeout(500); }
    ok(Math.max(...ys.map(y => Math.abs(y - y0))) <= 2, name + ': Verlauf wandert von selbst: ' + [...new Set(ys)].join(' → '));
    await api('/api/jobs/cancel-all', {kind: ''});
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
