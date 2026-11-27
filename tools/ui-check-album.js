// Prüfregel: Alben (Audio, mehrere Lieder eines Starts) sind EIN Auftrag: eine Karte mit Gesamtbalken in der Warteschlange und auf der Startseite
// („Lied 5 von 12“), ein ausklappbarer Eintrag im Verlauf; „Alles abbrechen“, „Anhalten“ und Verschieben gelten für das ganze Album; ein einzelnes Lied
// bleibt eine eigene Karte. Voraussetzung: INDIR enthält Album/Lied 01–06.mp3 und a.mp3 (tools/make-fixtures.sh), Wurzelordner INDIR und OUTDIR; frischer Server.
// Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-album.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const OUT = (process.env.OUTDIR || '/tmp/out') + '/album';
(async () => {
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const api = (path, body) => p.evaluate(async ([path, body]) => (await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json(), [path, body]);
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const album = items => api('/api/jobs', {kind: 'audio', items: items.map(f => ({path: L.INDIR + '/' + f})), output: {dir: OUT, structure: 'flat', exists: 'rename'}, audio: {format: 'flac'}});
    const songs = [1, 2, 3, 4, 5, 6].map(i => 'Album/Lied 0' + i + '.mp3');
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    await api('/api/queue/pause', {on: true}); await api('/api/jobs/cancel-all', {kind: ''}); await api('/api/history/clear', {kind: 'all'}); await api('/api/concurrency', {kind: 'audio', n: 1});
    await album(songs); await album(['a.mp3']);
    await p.evaluate(() => { location.hash = '#history'; }); await p.waitForTimeout(1500);
    // ---- Warteschlange: das Album ist eine Karte, das einzelne Lied eine eigene ----
    ok(await p.locator('#queue .job').count() === 2 && await p.locator('#queue .job.album').count() === 1, name + ': erwartet 2 Karten (Album + einzelnes Lied), ' + await p.locator('#queue .job').count());
    const card = p.locator('#queue .job.album');
    ok(/6 Lieder/.test(await card.textContent()) && /0 von 6 Liedern fertig/.test(await card.textContent()), name + ': Albumkarte: ' + (await card.textContent()).replace(/\s+/g, ' ').slice(0, 160));
    ok(await card.locator('.bar').count() === 1 && await p.locator('#queue .job:not(.album) .bar').count() === 1, name + ': ein Gesamtbalken je Karte');
    ok(await ov() <= 0, name + ': Überlauf mit Albumkarte ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-album-${name}-1-wartend.png`, fullPage: true});
    // Verschieben als Block: „nach hinten“ stellt das Album hinter das einzelne Lied
    ok(await p.locator('#queue .job').first().evaluate(e => e.classList.contains('album')), name + ': das Album steht zuerst');
    await card.locator('[data-bmv][data-how=down]').click(); await p.waitForTimeout(1500);
    ok(await p.locator('#queue .job').last().evaluate(e => e.classList.contains('album')), name + ': „nach hinten“ stellt das Album hinter das einzelne Lied');
    await p.locator('#queue .job.album [data-bmv][data-how=top]').click(); await p.waitForTimeout(1500);
    ok(await p.locator('#queue .job').first().evaluate(e => e.classList.contains('album')), name + ': „Zuerst“ stellt das Album wieder nach vorn');
    // Anhalten / Freigeben
    await p.locator('#queue .job.album [data-bhold]').click(); await p.waitForTimeout(1500);
    ok(/angehalten/.test(await p.locator('#queue .job.album').textContent()) && /Freigeben/.test(await p.locator('#queue .job.album').textContent()), name + ': „Anhalten“ markiert das Album');
    await p.locator('#queue .job.album [data-bhold]').click(); await p.waitForTimeout(1500);
    ok(!/angehalten/.test(await p.locator('#queue .job.album').textContent()), name + ': „Freigeben“ hebt das Anhalten auf');
    // ---- das ganze Album abbrechen ----
    p.on('dialog', d => d.accept());
    await p.locator('#queue .job.album [data-bcancel]').click(); await p.waitForTimeout(1800);
    ok(await p.locator('#queue .job.album').count() === 0, name + ': „Alles abbrechen“ entfernt die Albumkarte');
    ok(await p.locator('#queue .job:not(.album)').count() === 1, name + ': das einzelne Lied bleibt');
    await p.waitForTimeout(2500);
    let h = p.locator('.histentry.histalbum');
    ok(await h.count() === 1 && /6 Lieder/.test(await h.textContent()) && /abgebrochen|mit Hinweis/.test(await h.textContent()), name + ': abgebrochenes Album im Verlauf: ' + (await h.allTextContents()).join('|').replace(/\s+/g, ' ').slice(0, 160));
    // ---- Lauf: Startseite „Lied n von 6“, danach EIN Eintrag im Verlauf ----
    await api('/api/jobs/cancel-all', {kind: ''}); await api('/api/history/clear', {kind: 'all'}); await p.waitForTimeout(800);
    await api('/api/queue/pause', {on: true});
    await album(songs);
    await p.evaluate(() => { location.hash = ''; }); await p.waitForTimeout(1800);
    // (die Lieder sind in Sekunden fertig; die Startseite wird deshalb bei angehaltener Warteschlange geprüft)
    const hero = (await p.textContent('#jobNow')) || '';
    ok(/Lied 1 von 6/.test(hero), name + ': Startseite sollte „Lied 1 von 6“ zeigen, zeigt: ' + hero.replace(/\s+/g, ' ').slice(0, 120));
    ok(await p.locator('#jobNow .bar.thin').count() === 0 && await p.locator('#jobNow .bar').count() === 1, name + ': beim Album genau ein Balken auf der Startseite');
    await p.screenshot({path: `${L.SHOTS}/p5c-album-${name}-2-start.png`, fullPage: true});
    await api('/api/queue/pause', {on: false});
    await p.waitForFunction(() => !window.__p5.S.jobs.some(j => j.status === 'queued' || j.status === 'running'), null, {timeout: 120000}); await p.waitForTimeout(500);
    await p.evaluate(() => { location.hash = '#history'; }); await p.waitForSelector('.histentry', {timeout: 10000}); await p.waitForTimeout(3500);
    h = p.locator('.histentry.histalbum');
    ok(await h.count() === 1 && await p.locator('.histentry:not(.histalbum) .kindbadge').count() === 6, name + ': EIN Albumeintrag mit 6 Liedern darunter, ' + await h.count() + ' / ' + await p.locator('.histentry:not(.histalbum)').count());
    const t = (await h.first().locator('> summary').textContent()).replace(/\s+/g, ' ');
    ok(/6 Lieder/.test(t) && /fertig/.test(t) && /→/.test(t), name + ': Zusammenfassung des Albums: ' + t);
    ok(!(await h.first().evaluate(d => d.open)) && !(await p.locator('.histsongs .histentry').first().isVisible()), name + ': das Album ist zugeklappt, die Lieder sind verborgen');
    await h.first().locator('> summary').click(); await p.waitForTimeout(400);
    ok(await p.locator('.histsongs .histentry').first().isVisible() && await p.locator('.histsongs .histentry').count() === 6, name + ': aufgeklappt stehen die 6 Lieder da');
    ok(await ov() <= 0, name + ': Überlauf im Verlauf ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-album-${name}-3-verlauf.png`, fullPage: true});
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
