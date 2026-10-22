// Prüfregel: Übersicht der Quelldateien in Schritt 2 „Regeln“ und 3 „Wie umwandeln?“ (eine Zeile mit Dateien, Größe, Codec, Auflösung, Ton, Untertitel; Klick zeigt
// jede Datei) und der Hinweis zur Quelle an der Codec-Wahl in Schritt 3; in allen Ansichten, ohne Überlauf; in Schritt 1 und 4 nicht sichtbar.
// Voraussetzung: INDIR enthält ep01.mkv … ep06.mkv (H.264). Aufruf: INDIR=/tmp/season SHOTS=/tmp/shots node tools/ui-check-source.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
(async () => {
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    await L.enter(p, 'video');
    ok(!(await p.isVisible('#cvSource')), name + ': Schritt 1: die Übersicht darf noch nicht da sein');
    await p.click('#addFiles'); await p.waitForTimeout(300);
    await p.fill('#bPath', L.INDIR); await p.click('#bGo'); await p.waitForTimeout(500);
    await p.click('#bAll'); await p.click('#bAddSel'); await p.waitForTimeout(800);
    const n = await p.evaluate(() => S.files.video.length);
    ok(!(await p.isVisible('#cvSource')), name + ': Schritt 1 mit Dateien: keine Übersicht');
    // ---- Schritt 2 ----
    await p.click('#wizNext'); await p.waitForSelector('#cvRules .cvcard'); await p.waitForSelector('#cvSource details.cvsrc', {timeout: 15000}); await p.waitForTimeout(500);
    const t2 = (await p.textContent('#cvSource summary')).replace(/\s+/g, ' ');
    ok(new RegExp(n + ' Dateien').test(t2) && /Video: H\.264/.test(t2) && /Ton: /.test(t2) && /Untertitel: /.test(t2) && /GB|MB/.test(t2), name + ': Übersicht in Schritt 2: ' + t2);
    ok(!(await p.locator('#cvSource .cvsrcfile').first().isVisible()), name + ': die Dateiliste sollte erst nach dem Klick zu sehen sein');
    await p.click('#cvSource summary'); await p.waitForTimeout(250);
    ok(await p.locator('#cvSource .cvsrcfile').count() === n && await p.locator('#cvSource .cvsrcfile').first().isVisible(), name + ': nach dem Klick eine Zeile je Datei (' + await p.locator('#cvSource .cvsrcfile').count() + ' von ' + n + ')');
    ok(/H\.264/.test(await p.locator('#cvSource .cvsrcfile').first().textContent()), name + ': Datei-Zeile ohne Codec');
    ok(await ov() <= 0, name + ': Überlauf Schritt 2 ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-source-${name}-1-schritt2.png`, fullPage: true});
    // ---- Schritt 3 ----
    await p.click('#wizNext'); await p.waitForSelector('#cvHow .cvtiles'); await p.waitForSelector('#cvCodecHint:not(.hidden)', {timeout: 15000}).catch(() => {}); await p.waitForTimeout(500);
    ok(await p.isVisible('#cvSource') && /Video: H\.264/.test(await p.textContent('#cvSource summary')), name + ': Übersicht in Schritt 3 fehlt');
    ok(await p.locator('#cvSource details').evaluate(d => d.open), name + ': die geöffnete Liste sollte beim Schrittwechsel offen bleiben');
    const pick = async label => { await p.click(`#cvHow .pills button:has-text("${label}")`); await p.waitForTimeout(600); return (await p.textContent('#cvCodecHint').catch(() => '')).replace(/\s+/g, ' '); };
    const h265 = await pick('H.265');
    ok(/Deine Quelle: H\.264 → H\.265\. Das spart meist Platz/.test(h265) && await p.locator('#cvCodecHint.good').count() === 1, name + ': Hinweis zu H.265: ' + h265);
    const h264 = await pick('H.264');
    ok(/H\.264 läuft fast überall/.test(h264), name + ': Hinweis zu H.264: ' + h264);
    const copy = await pick('Kopieren');
    ok(/nur neu verpackt/.test(copy), name + ': Hinweis zu Kopieren: ' + copy);
    ok(!/Prozent|%|spart.*GB/i.test(h265 + h264 + copy), name + ': keine Schätzung der Ersparnis erlaubt');
    await pick('H.265');
    ok(await ov() <= 0, name + ': Überlauf Schritt 3 ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-source-${name}-2-schritt3.png`, fullPage: true});
    // ---- Schritt 4: nicht mehr (dort steht die Tabelle) ----
    await L.toCheck(p); await p.waitForTimeout(600);
    ok(!(await p.isVisible('#cvSource')), name + ': Schritt 4: die Übersicht gehört nicht mehr dorthin');
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
