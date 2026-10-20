// Prüfregel: Warteschlange verwalten in allen Ansichten – Reihenfolge ändern („Zuerst“, nach vorn/hinten), einzelne Aufträge anhalten und freigeben,
// die ganze Warteschlange pausieren und fortsetzen (Hinweis auch auf der Startseite), und die Rückfrage „unterbrochene Aufträge fortsetzen?“.
// Voraussetzung: INDIR enthält long.mkv, multi.mkv, multi2.mkv, hint.mkv (Testvideos), Wurzelordner INDIR und OUTDIR; frischer Server.
// Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-queue.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const OUT = (process.env.OUTDIR || '/tmp/out') + '/queue';
(async () => {
  const b = await L.launch();
  for (const [name, opt] of [L.views[0], L.views[1], L.views[3]]) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const api = (path, body) => p.evaluate(async ([path, body]) => (await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json(), [path, body]);
    const queuedNames = () => p.evaluate(async () => (await (await fetch('/api/state')).json()).jobs.filter(j => j.status === 'queued').map(j => j.name));
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    await api('/api/jobs/cancel-all', {kind: ''}); await api('/api/queue/pause', {on: false}); await api('/api/concurrency', {kind: 'video', n: 1}); await p.waitForTimeout(1200);
    // pausieren, dann vier Aufträge einreihen: es startet keiner
    await p.click('#startHistory'); await p.waitForTimeout(600);
    ok(await p.locator('#pauseQueue').isVisible() && /Pausieren/.test(await p.textContent('#pauseQueue')), name + ': Knopf „Pausieren“ fehlt');
    await p.click('#pauseQueue'); await p.waitForTimeout(1500);
    ok(/Fortsetzen/.test(await p.textContent('#pauseQueue')) && await p.locator('#queuePaused').isVisible(), name + ': pausiert: Knopf und Hinweis fehlen');
    for (const f of ['long.mkv', 'multi.mkv', 'multi2.mkv', 'hint.mkv']) await api('/api/jobs', {kind: 'video', items: [{path: L.INDIR + '/' + f}], output: {dir: OUT, structure: 'flat', exists: 'rename'}, video: {codec: 'hevc', backend: 'cpu', crf: 24, preset: 'slow'}});
    await p.waitForTimeout(1800);
    ok((await p.locator('#queue .job.queued').count()) === 4 && await p.locator('#queue .job.running').count() === 0, name + ': pausiert: vier wartende, keiner läuft (' + await p.locator('#queue .job.queued').count() + ')');
    ok((await p.locator('#queue .job.queued .chip.warn:has-text("pausiert")').count()) === 4, name + ': Aufträge zeigen „pausiert“');
    await p.screenshot({path: `${L.SHOTS}/p5c-queue-${name}-1-pausiert.png`, fullPage: true});
    // Reihenfolge
    ok((await queuedNames()).join() === 'long.mkv,multi.mkv,multi2.mkv,hint.mkv', name + ': Ausgangsreihenfolge ' + (await queuedNames()).join());
    await p.locator('#queue .job', {hasText: 'hint.mkv'}).locator('[data-how=top]').click(); await p.waitForTimeout(1500);
    ok((await queuedNames()).join() === 'hint.mkv,long.mkv,multi.mkv,multi2.mkv', name + ': „Zuerst“ wirkt nicht: ' + (await queuedNames()).join());
    ok((await p.locator('#queue .job .n').allTextContents())[0] === 'hint.mkv', name + ': Anzeige folgt nicht (oben soll hint.mkv stehen)');
    await p.locator('#queue .job', {hasText: 'hint.mkv'}).locator('[data-how=down]').click(); await p.waitForTimeout(1500);
    ok((await queuedNames()).join() === 'long.mkv,hint.mkv,multi.mkv,multi2.mkv', name + ': „nach hinten“ wirkt nicht: ' + (await queuedNames()).join());
    await p.locator('#queue .job', {hasText: 'multi2.mkv'}).locator('[data-how=up]').click(); await p.waitForTimeout(1500);
    ok((await queuedNames()).join() === 'long.mkv,hint.mkv,multi2.mkv,multi.mkv', name + ': „nach vorn“ wirkt nicht: ' + (await queuedNames()).join());
    // einen Auftrag anhalten
    const hintCard = p.locator('#queue .job', {hasText: 'hint.mkv'});
    await hintCard.locator('[data-hold]').click(); await p.waitForTimeout(1500);
    ok(/angehalten/.test(await p.locator('#queue .job', {hasText: 'hint.mkv'}).textContent()) && /Freigeben/.test(await p.locator('#queue .job', {hasText: 'hint.mkv'}).textContent()), name + ': Anhalten ist nicht sichtbar');
    // Startseite zeigt den Hinweis „pausiert“
    await p.click('#histBack'); await p.waitForTimeout(600);
    ok(/Warteschlange pausiert/.test(await p.textContent('#jobNow')), name + ': Startseite zeigt „Warteschlange pausiert“ nicht');
    if (await ov() > 0) fails.push(name + ': Überlauf Startseite ' + await ov() + 'px');
    await p.click('#startHistory'); await p.waitForTimeout(600);
    // fortsetzen: der erste startet, der angehaltene bleibt stehen
    await p.click('#pauseQueue'); await p.waitForTimeout(3000);
    ok(await p.locator('#queue .job.running').count() === 1 && /long\.mkv/.test(await p.locator('#queue .job.running').textContent()), name + ': nach „Fortsetzen“ sollte long.mkv laufen');
    ok(!(await p.locator('#queuePaused').isVisible()), name + ': Hinweis „pausiert“ bleibt stehen');
    ok(/angehalten/.test(await p.locator('#queue .job', {hasText: 'hint.mkv'}).textContent()), name + ': der angehaltene Auftrag muss angehalten bleiben');
    await p.click('#queue .job:has-text("hint.mkv") [data-hold]'); await p.waitForTimeout(800);
    ok(!/angehalten/.test(await p.locator('#queue .job', {hasText: 'hint.mkv'}).textContent()), name + ': „Freigeben“ wirkt nicht');
    if (await ov() > 0) fails.push(name + ': Überlauf Verlauf ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-queue-${name}-2-lauft.png`, fullPage: true});
    await api('/api/jobs/cancel-all', {kind: ''}); await p.waitForTimeout(1200);
    await api('/api/concurrency', {kind: 'video', n: 1});

    // ---- Rückfrage nach einem Neustart: der Server meldet unterbrochene Aufträge ----
    const ctx2 = await b.newContext(opt); const q = await ctx2.newPage();
    let posted = null;
    await q.route('**/api/state', async route => { const r = await route.fetch(); const j = await r.json(); j.restorable = {count: 3, video: 2, audio: 1}; await route.fulfill({response: r, json: j}); });
    await q.route('**/api/queue/restore', async route => { posted = route.request().postDataJSON(); await route.fulfill({json: {resumed: posted.action === 'resume' ? 3 : 0}}); });
    q.on('pageerror', e => fails.push(name + ' JS(restore): ' + e.message));
    await q.goto(L.url); await q.waitForTimeout(2500);
    ok(await q.locator('#restoreDlg').isVisible(), name + ': Rückfrage zu unterbrochenen Aufträgen fehlt');
    const rt = (await q.textContent('#restoreText')).replace(/\s+/g, ' ');
    ok(/3 Aufträge/.test(rt) && /2 Video/.test(rt) && /1 Audio/.test(rt), name + ': Text der Rückfrage: ' + rt);
    await q.screenshot({path: `${L.SHOTS}/p5c-queue-${name}-3-rueckfrage.png`});
    await q.click('#restoreYes'); await q.waitForTimeout(600);
    ok(posted && posted.action === 'resume' && !(await q.locator('#restoreDlg').isVisible()), name + ': „Fortsetzen“ sendet nicht resume');
    await q.waitForTimeout(2200);
    ok(!(await q.locator('#restoreDlg').isVisible()), name + ': die Rückfrage darf nur einmal kommen');
    await ctx2.close(); await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
