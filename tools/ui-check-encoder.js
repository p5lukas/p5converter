// Prüfregel: „Bevorzugter Encoder“ (Einstellungen → Hardware) gilt im Video-Schritt bei „Automatisch“; „Wird verwendet“ nennt die Hardware.
// In der Sandbox gibt es keine GPU: geprüft wird mit „CPU“ als bevorzugtem Encoder und mit einem nicht nutzbaren (Quick Sync).
// Aufruf: SHOTS=/tmp/shots node tools/ui-check-encoder.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
(async () => {
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const setPref = v => p.evaluate(async v => { const s = await (await fetch('/api/settings')).json(); s.settings.preferredBackend = v; await fetch('/api/settings', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(s.settings)}); }, v);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear());
    for (const [pref, expectLabel, expectNote] of [['cpu', /bevorzugt: CPU/, true], ['qsv', /schnellste verfügbare/, false], ['auto', /schnellste verfügbare/, false]]) {
      await setPref(pref); await p.goto(L.url); await p.waitForTimeout(2500);
      await L.enter(p, 'video');
      await p.evaluate(() => cvSet('vCodec', 'hevc')); await p.waitForTimeout(400);
      const opt0 = await p.locator('#vBackend option[value=auto]').textContent();
      ok(expectLabel.test(opt0), `${name}/${pref}: Auswahl „Automatisch“ heißt „${opt0}“`);
      const res = await p.textContent('#vResolved');
      ok(/libx265/.test(res) && /CPU/.test(res), `${name}/${pref}: „Wird verwendet“ zeigt nicht libx265 + CPU: ${res}`);
      ok(/bevorzugt laut Einstellungen/.test(res) === expectNote, `${name}/${pref}: Hinweis „bevorzugt laut Einstellungen“ falsch: ${res}`);
      // Zurücksetzen ändert daran nichts
      await p.evaluate(() => openReset()); if (await p.isVisible('#resetYes')) await p.click('#resetYes'); await p.waitForTimeout(400); // ohne Auswahl wird sofort verworfen
      await L.enter(p, 'video'); await p.evaluate(() => cvSet('vCodec', 'hevc')); await p.waitForTimeout(300);
      ok(expectLabel.test(await p.locator('#vBackend option[value=auto]').textContent()), `${name}/${pref}: nach „Zurücksetzen“ stimmt die Auswahl nicht mehr`);
      if (pref === 'cpu') await p.screenshot({path: `${L.SHOTS}/p5c-enc-${name}.png`, fullPage: true});
    }
    await ctx.close();
  }
  await setPrefBack();
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
  async function setPrefBack() { await fetch(L.url + '/api/settings').then(r => r.json()).then(s => { s.settings.preferredBackend = 'auto'; return fetch(L.url + '/api/settings', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(s.settings)}); }); }
})();
