// Prüfregel: Forced-Untertitel nach Größe erkennen (seit 0.2.0) in der Tabelle „Vorher → Nachher“, in allen Ansichten:
// Vorschlag „nur N statt M Zeilen“ mit Knopf (✦ „Vorschlag“), Vorauswahl bei Wunsch „Deutsch (Forced)“ (✦ „Automatisch“), Ergebnis-Datei hat das Forced-Kennzeichen.
// Voraussetzung: INDIR enthält forced.mkv (Ton ger, Untertitel ger 150 Zeilen und ger 4 Zeilen, Größenangaben als MKV-Tags),
// Wurzelordner INDIR und OUTDIR. Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-forced.js
const L = require('./ui-lib.js');
const {execFileSync} = require('child_process');
const fs = require('fs');
const OUT = (process.env.OUTDIR || '/tmp/out') + '/forced';
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const setPrefs = async (p, subDefault) => { if (p.url() === 'about:blank') await p.goto(L.url); return p.evaluate(async subDefault => {
  const s = await (await fetch('/api/settings')).json();
  s.settings.trackPrefs = {audioKeep: [], subKeep: [], audioDefault: [], subDefault};
  await fetch('/api/settings', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(s.settings)});
}, subDefault); };
(async () => {
  fs.rmSync(OUT, {recursive: true, force: true});
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const row = lbl => p.locator('.cvgrid .cvr', {has: p.locator('.cvk', {hasText: new RegExp('^' + lbl + '\\s*i?$', 'i')})});
    const open = async () => {
      await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1200);
      await L.enter(p, 'video');
      await L.addFile(p, 'forced.mkv'); await L.toCheck(p); await p.waitForSelector('.cvgrid .cvr:not(.cvh)'); await p.waitForTimeout(400);
    };
    // ---- 1) ohne Wunsch: nur Vorschlag, nichts wird still gesetzt ----
    await setPrefs(p, []);
    await open();
    const sub2 = row('Untertitel 2');
    ok(await sub2.locator('.cvai').count() === 1, name + ': Vorschlag am zweiten Untertitel fehlt');
    const txt = await sub2.locator('.cvai').textContent();
    ok(/Vorschlag/.test(txt) && /nur 4 statt 150 Zeilen/.test(txt) && /Forced/.test(txt), name + ': Vorschlagstext: ' + txt);
    ok(await p.locator('.cvgrid .cvflag.on:has-text("Forced")').count() === 0, name + ': ohne Wunsch darf nichts still auf Forced stehen');
    ok(await row('Untertitel 1').locator('.cvai').count() === 0, name + ': der vollständige Untertitel hat keine Markierung');
    ok(await ov() <= 0, name + ': Überlauf ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-forced-${name}-1-vorschlag.png`, fullPage: true});
    await sub2.locator('.cvai button:has-text("Als Forced markieren")').click(); await p.waitForTimeout(500);
    ok(await sub2.locator('.cvflag.on:has-text("Forced")').count() === 1, name + ': nach „Als Forced markieren“ steht Forced nicht an');
    ok(await sub2.locator('.cvai').count() === 0, name + ': Vorschlag bleibt nach dem Markieren stehen');
    // ---- 2) mit Wunsch „Deutsch (Forced)“: vorausgewählt und als automatisch markiert ----
    await setPrefs(p, [{lang: 'ger', forced: true}, {lang: 'ger', forced: false}]);
    await open();
    ok(await row('Untertitel 2').locator('.cvflag.on:has-text("Forced")').count() === 1, name + ': Forced nicht vorausgewählt');
    ok(await row('Untertitel 2').locator('.cvflag.on:has-text("Standard")').count() === 1, name + ': Standard-Untertitel nicht gesetzt');
    const ai = (await row('Untertitel 2').locator('.cvai').allTextContents()).join(' | ');
    ok(/Automatisch/.test(ai) && /Forced/.test(ai) && /Rangliste/.test(ai), name + ': Markierung „Automatisch“ mit Begründung fehlt: ' + ai);
    ok(await row('Untertitel 1').locator('.cvflag.on').count() === 0, name + ': Untertitel 1 sollte weder Forced noch Standard sein');
    await p.screenshot({path: `${L.SHOTS}/p5c-forced-${name}-2-vorausgewaehlt.png`, fullPage: true});
    // „rückgängig“ nimmt die Vorauswahl zurück
    await row('Untertitel 2').locator('.cvai button:has-text("rückgängig")').first().click(); await p.waitForTimeout(500);
    ok(await row('Untertitel 2').locator('.cvflag.on:has-text("Forced")').count() === 0, name + ': „rückgängig“ nimmt Forced nicht zurück');
    await p.reload(); await p.waitForTimeout(1500);
    // ---- 3) echter Lauf (nur Desktop): Ergebnis prüfen ----
    if (name === 'desktop') {
      await open();
      await L.goStep(p, 'dest'); await p.selectOption('#outMode', 'custom'); await p.fill('#outDir', OUT); await p.selectOption('#exists', 'overwrite');
      await L.goStep(p, 'files');
      await p.click('#start'); await p.waitForTimeout(5000);
      const out = OUT + '/forced.mkv';
      ok(fs.existsSync(out), name + ': Ergebnis fehlt');
      if (fs.existsSync(out)) {
        const subs = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-select_streams', 's', out]).toString()).streams;
        ok(subs.length === 2 && subs[1].disposition.forced === 1 && subs[1].disposition.default === 1 && subs[0].disposition.forced === 0 && subs[0].disposition.default === 0,
          name + ': Kennzeichen im Ergebnis falsch: ' + JSON.stringify(subs.map(x => x.disposition)));
      }
    }
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
