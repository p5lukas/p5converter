// Prüfregel: Verlauf und Warteschlange werden alle paar Sekunden neu gezeichnet. Dabei dürfen sich geöffnete Details („ffmpeg-Befehl und Log“), der Scrollstand
// in den Textfeldern, eine Textauswahl und die Scrollposition der Seite nicht ändern (früher schloss sich das Fenster sofort und die Seite wanderte von selbst).
// Dazu die Kopieren-Knöpfe. Voraussetzung: INDIR enthält long.mkv und multi.mkv (Testvideos), Wurzelordner INDIR und OUTDIR; frischer Server.
// Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-historyscroll.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const OUT = (process.env.OUTDIR || '/tmp/out') + '/hscroll';
(async () => {
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext({...opt, permissions: ['clipboard-read', 'clipboard-write']}); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const api = (path, body) => p.evaluate(async ([path, body]) => (await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json(), [path, body]);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    await api('/api/queue/pause', {on: false}); await api('/api/jobs/cancel-all', {kind: ''}); await api('/api/history/clear', {kind: 'all'}); await api('/api/concurrency', {kind: 'video', n: 2});
    for (let i = 0; i < 24; i++) await api('/api/jobs', {kind: 'video', items: [{path: L.INDIR + '/gibt-es-nicht-' + i + '.mkv'}], output: {dir: OUT, structure: 'flat', exists: 'rename'}, video: {container: 'mkv', codec: 'copy'}});
    for (let i = 0; i < 3; i++) await api('/api/jobs', {kind: 'video', items: [{path: L.INDIR + '/hint.mkv'}], output: {dir: OUT, structure: 'flat', exists: 'rename'}, video: {container: 'mkv', codec: 'hevc', backend: 'cpu', crf: 24, preset: 'veryfast', height: 2}}); // scheitert in ffmpeg: nur Fehler-Einträge behalten Befehl und Log
    await p.waitForTimeout(9000);
    await p.click('#startHistory'); await p.waitForSelector('.histentry', {timeout: 10000}); await p.waitForTimeout(500);

    // ---- geöffnete Details bleiben offen (mehrere Neuladevorgänge, alle 3 s), Textfeld und Auswahl bleiben unberührt ----
    const entry = p.locator('.histentry', {hasText: 'hint.mkv'}).first();
    await entry.locator('summary').first().click();
    const inner = entry.locator('details');
    ok(await inner.count() === 1, name + ': innere Details „ffmpeg-Befehl und Log“ fehlen');
    await inner.locator('summary').click(); await p.waitForTimeout(300);
    await p.evaluate(() => { const pre = [...document.querySelectorAll('.histentry')].find(e => /hint\.mkv/.test(e.textContent)).querySelector('details details pre'); pre.style.maxHeight = '30px'; pre.scrollTop = 12; window.__pre = pre;
      const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); window.__sel = s.toString(); });
    await p.waitForTimeout(7500); // mehr als zwei Neuladevorgänge
    ok(await entry.locator('details').first().evaluate(d => d.open) && await inner.evaluate(d => d.open), name + ': die Details haben sich von selbst geschlossen');
    const keep = await p.evaluate(() => { const pre = [...document.querySelectorAll('.histentry')].find(e => /hint\.mkv/.test(e.textContent)).querySelector('details details pre'); return {same: pre === window.__pre, top: pre.scrollTop, sel: getSelection().toString() === window.__sel && window.__sel.length > 0}; });
    ok(keep.same, name + ': das Textfeld wurde neu aufgebaut (Scrollstand und Auswahl gingen verloren)');
    ok(keep.top === 12, name + ': Scrollstand im Textfeld springt (' + keep.top + ')');
    ok(keep.sel, name + ': die Textauswahl ging verloren');
    await p.screenshot({path: `${L.SHOTS}/p5c-hscroll-${name}-1-offen.png`});

    // ---- Kopieren ----
    const cmd = await p.evaluate(() => window.__pre.textContent);
    await inner.getByRole('button', {name: /Befehl kopieren/}).click(); await p.waitForTimeout(300);
    ok((await p.evaluate(() => navigator.clipboard.readText())) === cmd && cmd.length > 10, name + ': „Befehl kopieren“ legt den Befehl nicht in die Zwischenablage');
    await inner.getByRole('button', {name: /Alles kopieren/}).click(); await p.waitForTimeout(300);
    ok((await p.evaluate(() => navigator.clipboard.readText())).startsWith(cmd), name + ': „Alles kopieren“');
    ok(await inner.getByRole('button', {name: /Log kopieren/}).count() === 1, name + ': „Log kopieren“ fehlt');

    // ---- die Seite wandert nicht, während Aufträge laufen und fertig werden ----
    for (const f of ['multi.mkv', 'long.mkv']) await api('/api/jobs', {kind: 'video', items: [{path: L.INDIR + '/' + f}], output: {dir: OUT, structure: 'flat', exists: 'rename'}, video: {codec: 'hevc', backend: 'cpu', crf: 24, preset: 'slow'}});
    await p.waitForSelector('#queue .job.running', {timeout: 15000});
    await entry.locator('summary').first().click(); await p.waitForTimeout(200); // Eintrag zu: kürzere Seite
    const target = p.locator('.histentry', {hasText: 'gibt-es-nicht-3.mkv'}).first();
    await target.scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, 160)); await p.waitForTimeout(400);
    const top0 = await target.evaluate(e => e.getBoundingClientRect().top), ys = [];
    for (let i = 0; i < 18; i++) { ys.push(Math.round(await target.evaluate(e => e.getBoundingClientRect().top))); await p.waitForTimeout(1000); }
    const dev = Math.max(...ys.map(y => Math.abs(y - top0)));
    ok(dev <= 2, name + ': der sichtbare Eintrag wandert um ' + dev + ' px (' + ys.join(',') + ')');
    // wirklich etwas passiert: ein Auftrag wurde fertig (neuer Eintrag oben)?
    ok(await p.locator('.histentry', {hasText: 'multi.mkv'}).count() >= 1 || await p.locator('#queue .job').count() >= 1, name + ': im Test hat sich nichts verändert');

    // ---- Details in der Warteschlange bleiben offen ----
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
    const det = p.locator('#queue .job.running details').first();
    if (await det.count()) {
      await det.locator('summary').click(); await p.waitForTimeout(3500);
      ok(await p.locator('#queue .job.running details').first().evaluate(d => d.open), name + ': Details der Warteschlange schließen sich von selbst');
      ok(await p.locator('#queue .job.running [data-copy=cmd]').count() >= 1, name + ': Kopieren-Knopf in der Warteschlange fehlt');
    }
    await p.screenshot({path: `${L.SHOTS}/p5c-hscroll-${name}-2-lauf.png`, fullPage: true});
    await api('/api/jobs/cancel-all', {kind: ''}); await p.waitForTimeout(800);
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
