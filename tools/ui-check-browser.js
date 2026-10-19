// Prüfregel: Datei-Browser mit Suche (Filter im Ordner, „Auch in Unterordnern“, Umlaute) und Anzeigenamen der Quellordner in allen Ansichten.
// Voraussetzung: Server mit Wurzelordnern INDIR (hier /tmp/media, enthält long.mkv, a.mp3 …), /tmp/season (ep01.mkv …) und OUTDIR; frischer Konfigurationsordner.
// Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-browser.js
const L = require('./ui-lib.js');
const fs = require('fs');
const OUT = process.env.OUTDIR || '/tmp/out';
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
(async () => {
  fs.rmSync(OUT + '/suche', {recursive: true, force: true});
  fs.mkdirSync(OUT + '/suche/Müller Serie/Staffel 1', {recursive: true});
  fs.mkdirSync(OUT + '/suche/Anderes', {recursive: true});
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const rows = () => p.locator('#bList .bi');
    await p.goto(L.url); await p.evaluate(() => localStorage.clear());
    await p.evaluate(async media => { const s = await (await fetch('/api/settings')).json(); s.settings.rootNames = {[media]: 'Testfilme'};
      await fetch('/api/settings', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(s.settings)}); }, L.INDIR);
    await p.goto(L.url); await p.waitForTimeout(1300);
    await L.setWorld(p, 'video'); await p.click('#startFlow'); await p.waitForTimeout(300);
    await p.click('#addFiles'); await p.waitForTimeout(500);
    // Wurzelordner mit Anzeigenamen
    const rootTxt = (await p.locator('#bList').textContent()).replace(/\s+/g, ' ');
    ok(/Testfilme/.test(rootTxt) && rootTxt.includes(L.INDIR), name + ': Wurzelordner ohne Anzeigename + Pfad: ' + rootTxt.slice(0, 160));
    await p.locator('#bList .bi', {hasText: 'Testfilme'}).click(); await p.waitForTimeout(500);
    ok(await p.inputValue('#bPath') === L.INDIR, name + ': echter Pfad steht im Pfadfeld');
    ok(/Angezeigt als: Testfilme/.test(await p.textContent('#bWhere')), name + ': „Angezeigt als“ fehlt: ' + await p.textContent('#bWhere'));
    // Filter im Ordner
    const total = await rows().count();
    ok(total >= 3, name + ': zu wenig Einträge im Testordner: ' + total);
    await p.fill('#bSearch', 'LONG'); await p.waitForTimeout(200);
    ok(await rows().count() === 1 && /long\.mkv/.test(await rows().first().textContent()), name + ': Filter „LONG“ sollte nur long.mkv zeigen');
    ok(new RegExp('1 von ' + total).test(await p.textContent('#bInfo')), name + ': Zähler „1 von N“ fehlt: ' + await p.textContent('#bInfo'));
    await p.click('#bAll'); await p.waitForTimeout(150);
    ok(/1 ausgewählt/.test(await p.textContent('#bCount')), name + ': „Alle auswählen“ gilt nur für die Treffer');
    await p.fill('#bSearch', 'gibtesnicht'); await p.waitForTimeout(200);
    ok(/Nichts gefunden/.test(await p.textContent('#bList')), name + ': „Nichts gefunden“ fehlt');
    ok(await ov() <= 0, name + ': Überlauf im Browser ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-br-${name}-1-filter.png`});
    await p.fill('#bSearch', ''); await p.waitForTimeout(150);
    ok(await rows().count() === total, name + ': ohne Suchtext fehlen Einträge');
    // Eine Ebene hoch → Wurzelliste → Suche in allen Unterordnern
    await p.click('#bUp'); await p.waitForTimeout(500);
    ok(await p.locator('#bList .bi', {hasText: 'Testfilme'}).count() === 1, name + ': Wurzelliste nach „hoch“ fehlt');
    await p.check('#bDeep'); await p.fill('#bSearch', 'ep0'); await p.waitForTimeout(900);
    ok(await rows().count() >= 6, name + ': Suche in Unterordnern findet die 6 Folgen nicht: ' + await rows().count());
    ok(/Treffer/.test(await p.textContent('#bInfo')), name + ': Trefferzähler fehlt');
    await p.locator('#bList .bi', {hasText: 'ep01.mkv'}).first().click(); await p.waitForTimeout(150);
    ok(/1 ausgewählt/.test(await p.textContent('#bCount')), name + ': Auswahl in den Treffern klappt nicht');
    await p.screenshot({path: `${L.SHOTS}/p5c-br-${name}-2-tief.png`});
    await p.click('#bAddSel'); await p.waitForTimeout(1500);
    ok(/ep01\.mkv/.test(await p.textContent('#fileSummary')) && /1 Datei/.test(await p.textContent('#fileSummary')), name + ': Treffer wurde nicht hinzugefügt: ' + await p.textContent('#fileSummary'));
    // Ordner wählen: nur Ordner, Umlaute egal
    await p.click('#clearFiles'); await p.waitForTimeout(200);
    await p.click('#addFolder'); await p.waitForTimeout(500);
    await p.check('#bDeep');
    for (const q of ['muller', 'MUELLER', 'müller']) {
      await p.fill('#bSearch', q); await p.waitForTimeout(900);
      const t = (await p.locator('#bList').textContent()).replace(/\s+/g, ' ');
      ok(/Müller Serie/.test(t) && !/\.mkv|\.mp3/.test(t), name + ': „' + q + '“ sollte den Ordner „Müller Serie“ (und nur Ordner) finden: ' + t.slice(0, 120));
    }
    await p.locator('#bList .bi', {hasText: 'Müller Serie'}).first().click(); await p.waitForTimeout(500);
    ok(/Müller Serie$/.test(await p.inputValue('#bPath')), name + ': Klick auf einen Treffer-Ordner öffnet ihn nicht');
    ok(await p.inputValue('#bSearch') === '', name + ': Suchfeld wird nach dem Öffnen geleert');
    await p.click('#bCancel'); await p.waitForTimeout(200);
    // Einstellungen: Anzeigenamen
    await p.evaluate(() => { location.hash = '#settings/general'; }); await p.waitForTimeout(600);
    ok(await p.locator('.rootname').count() >= 3, name + ': Einstellungen zeigen die Quellordner nicht');
    const inp = p.locator('.rootname', {hasText: L.INDIR}).locator('input');
    ok(await inp.inputValue() === 'Testfilme', name + ': gespeicherter Name fehlt');
    await inp.fill('Meine Filme'); await inp.press('Tab'); await p.waitForTimeout(700);
    const saved = await p.evaluate(async () => (await (await fetch('/api/settings')).json()).settings.rootNames);
    ok(saved && saved['/tmp/media'] === 'Meine Filme', name + ': neuer Name nicht gespeichert: ' + JSON.stringify(saved));
    await inp.fill(''); await inp.press('Tab'); await p.waitForTimeout(600);
    const gone = await p.evaluate(async () => (await (await fetch('/api/settings')).json()).settings.rootNames);
    ok(!gone || !gone['/tmp/media'], name + ': leerer Name sollte den Eintrag löschen');
    ok(await ov() <= 0, name + ': Überlauf in den Einstellungen ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-br-${name}-3-einstellungen.png`, fullPage: true});
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
