// Prüft: Die Oberfläche startet auch, wenn die Hardware-Erkennung noch läuft (der Server liefert dann leere/`null`-Listen),
// zeigt „Beenden“ sofort und füllt die Hardware-Kachel nach Abschluss. Aufruf: node tools/ui-check-hwnull.js (Server auf :8787), alle Ansichten.
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
    let calls = 0;
    await p.route('**/api/info', async route => {
      const r = await route.fetch(); const j = await r.json(); calls++;
      if (calls <= 3) { j.hw = {backends: null, gpus: null, renderNodes: null, diag: null, vainfo: null, done: false, tookMs: 0}; j.canQuit = true; }
      await route.fulfill({response: r, json: j});
    });
    await p.goto(L.url); await p.waitForTimeout(700);
    await p.waitForTimeout(500);
    const toasts = await p.locator('#toasts').textContent();
    if (/Start fehlgeschlagen/.test(toasts)) errs.push(`${name}: „Start fehlgeschlagen“ trotz leerer Hardware-Liste: ${toasts}`);
    eq(name, '„Beenden“ ist sofort sichtbar', await p.locator('#quit').isVisible(), true);
    eq(name, 'Hardware-Kachel zeigt „Erkennung läuft“', /Erkennung läuft/.test(await p.textContent('#hwCard')), true);
    await p.waitForTimeout(5000); // spätere Antworten sind echt
    eq(name, 'danach ist Hardware aufgelistet', (await p.locator('#hwList .hw').count()) >= 1, true);
    eq(name, 'danach keine Meldung „Erkennung läuft“', /Erkennung läuft/.test(await p.textContent('#hwList')), false);
    await ctx.close();
  }
  await b.close();
  console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'ok');
})();
