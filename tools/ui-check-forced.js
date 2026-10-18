// Prüfregel: Forced-Untertitel nach Größe erkennen (0.2.0) in allen Ansichten: Hinweis „nur N statt M Zeilen“ mit Knopf, Schild „Forced?“,
// Vorauswahl bei Wunsch „Deutsch (Forced)“, Ergebnis-Datei hat das Forced-Kennzeichen.
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
    const open = async () => {
      await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1200);
      await L.setWorld(p, 'video'); await p.click('#startFlow'); await p.waitForTimeout(300);
      await L.addFile(p, 'forced.mkv');
      await L.goStep(p, 'tracks'); await p.waitForSelector('.trkviews');
      await p.click('.trkviews button:has-text("Einzelne Dateien")'); await p.waitForSelector('#trackEditor .trkcard');
    };
    // ---- 1) ohne Wunsch: nur Vorschlag ----
    await setPrefs(p, []);
    await open();
    const hint = (await p.locator('#trackEditor .trkhint2').allTextContents()).join(' | ');
    ok(/nur 4 statt 150 Zeilen/.test(hint) && /wahrscheinlich ein Forced/.test(hint), name + ': Forced-Hinweis fehlt: ' + hint.slice(0, 200));
    ok(await p.locator('#trackEditor .chip:has-text("Forced?")').count() === 1, name + ': Schild „Forced?“ fehlt');
    ok(await p.locator('#trackEditor .chip.acc:text-is("Forced")').count() === 0, name + ': ohne Wunsch darf nichts still auf Forced stehen');
    ok(await ov() <= 0, name + ': Überlauf ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-forced-${name}-1-hint.png`, fullPage: true});
    await p.click('#trackEditor .trkhint2 button:has-text("Als Forced markieren")'); await p.waitForTimeout(300);
    ok(await p.locator('#trackEditor .chip:has-text("Forced?")').count() === 0, name + ': Schild bleibt nach dem Markieren');
    ok(await p.locator('#trackEditor .chip.acc:text-is("Forced")').count() === 1, name + ': Schild „Forced“ fehlt nach dem Markieren');
    // ---- 2) mit Wunsch „Deutsch (Forced)“: vorausgewählt ----
    await setPrefs(p, [{lang: 'ger', forced: true}, {lang: 'ger', forced: false}]);
    await open();
    ok(await p.locator('#trackEditor .chip.acc:text-is("Forced")').count() === 1, name + ': Forced nicht vorausgewählt');
    ok(await p.locator('#trackEditor .chip.acc:text-is("Standard")').count() === 1, name + ': Standard-Untertitel nicht gesetzt');
    ok(!/wahrscheinlich ein Forced/.test((await p.locator('#trackEditor .trkhint2').allTextContents()).join(' ')), name + ': Hinweis trotz Vorauswahl');
    await p.screenshot({path: `${L.SHOTS}/p5c-forced-${name}-2-preselected.png`, fullPage: true});
    if (name === 'desktop') {
      // was die Oberfläche beim Start schickt, wirklich umwandeln: der kleine Untertitel trägt Forced + Standard
      const reqBody = await p.evaluate(async () => { const f = S.files.video[0]; return {path: f.path, overrides: await trackOverridesFor(f)}; });
      ok(reqBody.overrides.tracks && reqBody.overrides.tracks[3] && reqBody.overrides.tracks[3].forced === true, name + ': Start schickt Forced nicht mit: ' + JSON.stringify(reqBody.overrides));
      const r = await p.evaluate(async ([it, dir]) => (await fetch('/api/jobs', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({kind: 'video', items: [it], output: {dir, structure: 'flat', exists: 'overwrite'}, video: {container: 'mkv', codec: 'copy'}})})).json(), [reqBody, OUT]);
      await p.waitForTimeout(4000);
      const out = OUT + '/forced.mkv';
      ok(fs.existsSync(out), name + ': Ergebnis fehlt (' + JSON.stringify(r) + ')');
      if (fs.existsSync(out)) {
        const subs = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-select_streams', 's', out]).toString()).streams;
        ok(subs.length === 2 && subs[1].disposition.forced === 1 && subs[1].disposition.default === 1 && subs[0].disposition.forced === 0 && subs[0].disposition.default === 0,
          name + ': Kennzeichen im Ergebnis falsch: ' + JSON.stringify(subs.map(x => x.disposition)));
      }
    }
    await ctx.close();
  }
  await b.close();
  if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
  console.log('ok');
})();
