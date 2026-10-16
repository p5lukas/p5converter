// Prüft die Log-Seite und den Kopfzeilen-Knopf (Terminal-Symbol mit Zähler) in allen Ansichten.
// Aufruf: SHOTS=/tmp/shots node tools/ui-check-logs.js   (Server auf :8787; beim Start schreibt die Hardware-Erkennung Warnungen)
const L = require('./ui-lib');
(async () => {
  const b = await L.launch();
  const errs = [];
  const eq = (n, what, got, want) => { if (got !== want) errs.push(`${n}: ${what}: ${got} (erwartet ${want})`); };
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt);
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => m.type() === 'error' && errs.push(name + ': ' + m.text()));
    await p.goto(L.url); await p.waitForTimeout(1500);
    eq(name, 'Log-Knopf sichtbar', await p.isVisible('#logbtn'), true);
    eq(name, 'Einstellungen-Knopf sichtbar', await p.isVisible('#gearBtn'), true);
    const cls = await p.getAttribute('#logbtn', 'class');
    if (!/alert-(warn|err)/.test(cls)) errs.push(`${name}: Zähler für neue Warnungen fehlt (${cls})`);
    await p.screenshot({ path: `${L.SHOTS}/lg-${name}-head.png` });
    await p.click('#logbtn'); await p.waitForTimeout(900);
    eq(name, 'Log-Seite sichtbar', await p.isVisible('#viewLogs'), true);
    eq(name, 'Startseite ausgeblendet', await p.isVisible('#viewMain'), false);
    const n = await p.locator('#viewLogs .ll').count();
    if (n < 3) errs.push(`${name}: zu wenige Log-Zeilen: ${n}`);
    const text = await p.textContent('#viewLogs .logview');
    if (!/p5converter/.test(text) || !/\[INFO\]/.test(text)) errs.push(`${name}: Log-Inhalt unerwartet`);
    // Stufenfilter und Suche
    await p.click('.lvl-chip.lv-WARNING'); await p.waitForTimeout(200);
    const only = await p.locator('#viewLogs .ll:not(.lv-WARNING)').count();
    eq(name, 'Filter WARNING zeigt nur Warnungen', only, 0);
    await p.click('.lvl-chip.all'); await p.fill('#viewLogs input[type=search]', 'Hardware-Erkennung'); await p.waitForTimeout(400);
    const hits = await p.locator('#viewLogs .ll').count();
    if (hits < 1) errs.push(`${name}: Suche liefert ${hits} Zeilen`);
    await p.screenshot({ path: `${L.SHOTS}/lg-${name}-page.png`, fullPage: true });
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (ov > 0) errs.push(`${name}: horizontaler Überlauf ${ov}px`);
    // zurück: Zähler ist zurückgesetzt
    await p.click('#viewLogs .sethead button'); await p.waitForTimeout(500);
    eq(name, 'zurück auf der Startseite', await p.isVisible('#startFlow'), true);
    const cls2 = await p.getAttribute('#logbtn', 'class');
    if (/alert-(warn|err)/.test(cls2)) errs.push(`${name}: Zähler nach dem Ansehen nicht zurückgesetzt (${cls2})`);
    await ctx.close();
  }
  await b.close();
  console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'ok');
})();
