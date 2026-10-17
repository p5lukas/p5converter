// Prüfregel: Verlauf der Konvertierungen in allen Ansichten (Desktop, iPhone/iPad hoch/quer).
// Voraussetzung (Testserver, ROOTS enthalten INDIR und OUTDIR; Datei a.mp3 in INDIR): das Skript leert beide Verläufe und legt im Audio-Verlauf
// einen fertigen und einen fehlgeschlagenen Auftrag an.
// Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-history.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const OUT = process.env.OUTDIR || '/tmp/out';
(async () => {
  const post = (p, b) => fetch(L.url + p, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)}).then(r => r.json());
  const mk = file => ({kind: 'audio', items: [{path: file}], output: {dir: OUT + '/hist', structure: 'flat', exists: 'rename', verifyTracks: true}, audio: {format: 'flac', flacLevel: 5}});
  await post('/api/history/clear', {kind: 'video'}); await post('/api/history/clear', {kind: 'audio'});
  await post('/api/jobs', mk(L.INDIR + '/a.mp3'));
  await post('/api/jobs', mk(L.INDIR + '/gibt-es-nicht.mp3'));
  await new Promise(r => setTimeout(r, 4000));
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    p.on('dialog', d => d.dismiss());
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    await L.setWorld(p, 'audio');
    ok(await p.isVisible('#startHistory'), name + ': Verlauf-Knopf fehlt');
    await p.click('#startHistory'); await p.waitForTimeout(800);
    ok(await p.evaluate(() => location.hash) === '#history', name + ': Hash #history fehlt');
    ok(await p.locator('.histentry').count() >= 2, name + ': weniger als 2 Einträge');
    const total = await p.locator('.histentry').count();
    ok(/Verlauf · Audio/.test(await p.textContent('#viewHistory h1')), name + ': Überschrift ohne Weltname');
    await p.screenshot({path: `${L.SHOTS}/p5c-hist-${name}.png`, fullPage: true});
    // Filter nach Ergebnis
    await p.click('#viewHistory .lvl-chip:has-text("Fehler")'); await p.waitForTimeout(200);
    ok(await p.locator('.histentry').count() >= 1 && await p.locator('.histentry .chip.err').count() === await p.locator('.histentry').count(), name + ': Fehler-Filter zeigt nicht nur Fehler');
    await p.click('#viewHistory .lvl-chip:has-text("Alle")'); await p.waitForTimeout(200);
    // Suche
    await p.fill('#viewHistory input[type=search]', 'gibt-es-nicht'); await p.waitForTimeout(400);
    ok(await p.locator('.histentry').count() === 1, name + ': Suche findet nicht genau 1 Eintrag');
    await p.fill('#viewHistory input[type=search]', 'zzz-nichts'); await p.waitForTimeout(400);
    ok(/Keine Einträge für diesen Filter/.test(await p.textContent('#viewHistory')), name + ': Hinweis „Keine Einträge“ fehlt');
    await p.fill('#viewHistory input[type=search]', ''); await p.waitForTimeout(300);
    // Details aufklappen (Fehler mit Befehl/Log, fertig mit Prüfergebnis)
    await p.locator('.histentry > summary').first().click(); await p.waitForTimeout(200);
    await p.locator('.histentry > summary').nth(1).click(); await p.waitForTimeout(200);
    const t = await p.textContent('#viewHistory');
    ok(/Quelle:/.test(t) && /Ziel:/.test(t), name + ': Details ohne Quelle/Ziel');
    ok(/Spuren vollständig/.test(t), name + ': Prüfergebnis fehlt in den Details');
    await p.screenshot({path: `${L.SHOTS}/p5c-hist-${name}-open.png`, fullPage: true});
    // Zeitraum „Heute“ zeigt die neuen Einträge
    await p.selectOption('#viewHistory select', 'today'); await p.waitForTimeout(200);
    ok(await p.locator('.histentry').count() >= 2, name + ': Zeitraum „Heute“ blendet neue Einträge aus');
    // CSV-Link
    await p.locator('a.btnlink:has-text("CSV")').evaluate(a => a.dispatchEvent(new MouseEvent('click', {bubbles: true})));
    ok((await p.getAttribute('a.btnlink:has-text("CSV")', 'href')).includes('/api/history.csv?kind=audio'), name + ': CSV-Link falsch');
    // Welt wechseln: Video ist getrennt (leer)
    await p.click('[data-world=video]'); await p.waitForTimeout(3600);
    ok(/Verlauf · Video/.test(await p.textContent('#viewHistory h1')), name + ': Weltwechsel ändert die Überschrift nicht');
    ok(await p.locator('.histentry').count() === 0, name + ': Video-Verlauf sollte leer sein');
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov <= 0, `${name}: horizontaler Überlauf ${ov}px`);
    // Startseite: drei Knöpfe ohne Überlauf
    await p.evaluate(() => { location.hash = ''; }); await p.waitForTimeout(500);
    const ov2 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov2 <= 0, `${name}/Start: horizontaler Überlauf ${ov2}px`);
    await p.screenshot({path: `${L.SHOTS}/p5c-hist-${name}-start.png`, fullPage: false});
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
