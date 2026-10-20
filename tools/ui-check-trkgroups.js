// Prüfregel: „Audio & Untertitel“ mit Gruppen, Tabelle, Regeln nach Codec und Sprach-Wünschen (Einstellungen) in allen Ansichten.
// Voraussetzung: Ordner INDIR mit ep01.mkv … ep06.mkv (ep01–05: Ton ger (DTS)/eng/fre + Untertitel ger/eng/fre, ep06: nur eng), Server mit frischem
// Konfigurationsordner und Wurzelordner INDIR und OUTDIR. Aufruf: INDIR=/tmp/season OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-trkgroups.js
const L = require('./ui-lib.js');
const {execFileSync} = require('child_process');
const fs = require('fs');
const OUT = (process.env.OUTDIR || '/tmp/out') + '/season';
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', f]).toString()).streams;
(async () => {
  fs.rmSync(OUT, {recursive: true, force: true});
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    p.on('dialog', d => d.accept());
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    // Sprach-Wünsche zurücksetzen (frischer Zustand je Ansicht)
    await p.evaluate(async () => { const s = await (await fetch('/api/settings')).json(); s.settings.trackPrefs = {audioKeep: [], subKeep: [], audioDefault: [], subDefault: []}; await fetch('/api/settings', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(s.settings)}); });
    await p.goto(L.url); await p.waitForTimeout(1300);
    await L.enter(p, 'video');
    await p.click('#addFiles'); await p.waitForTimeout(300);
    await p.fill('#bPath', L.INDIR); await p.click('#bGo'); await p.waitForTimeout(500);
    await p.click('#bAll'); await p.click('#bAddSel'); await p.waitForTimeout(500);
    await L.goStep(p, 'tracks'); await p.waitForTimeout(2500);
    const T = () => p.textContent('#trackEditor');
    // ---- Gruppen ----
    ok(/6 Dateien in 2 Gruppen/.test(await T()), name + ': Gruppierung 6 Dateien in 2 Gruppen fehlt');
    ok(await p.locator('.trkgrp.odd').count() === 1, name + ': Abweichung nicht markiert');
    ok(!(await p.textContent('#trackSettings')).includes('Nur diese Sprachen behalten'), name + ': „Nur diese Sprachen behalten“ sollte weg sein');
    ok(/Eigene Regeln für diesen Lauf/.test(await p.textContent('#trackSettings')) && /Voreingestellte Regeln/.test(await p.textContent('#trackSettings')), name + ': Regeln-Bereiche fehlen');
    await p.screenshot({path: `${L.SHOTS}/p5c-grp-${name}-1.png`, fullPage: true});
    // Vorschlag „DTS → E-AC-3“ übernehmen
    await p.click('#trackEditor button:has-text("Regel: DTS")'); await p.waitForTimeout(600);
    ok(/→ E-AC-3/.test(await p.textContent('.trkgrp')), name + ': Wirkung „→ E-AC-3“ nicht sichtbar');
    ok(/1 aktiv/.test(await p.textContent('.trkrules summary')), name + ': Regelzähler fehlt');
    ok(await p.locator('.trkrule').count() === 1, name + ': Regelzeile fehlt');
    await p.screenshot({path: `${L.SHOTS}/p5c-grp-${name}-2-regel.png`, fullPage: true});
    // Gruppe: Französisch abwählen (Ton)
    await p.locator('.trkgrp').first().locator('.langchip', {hasText: 'Französisch'}).first().locator('input').uncheck(); await p.waitForTimeout(500);
    ok(await p.locator('.trkgrp').first().locator('.langchip.none').count() >= 1, name + ': abgewählte Sprache nicht markiert');
    ok(/entfernt/.test(await p.textContent('.trkgrp')), name + ': „entfernt“ in der Wirkung fehlt');
    // ---- Tabelle ----
    await p.click('.trkviews button:has-text("Tabelle")'); await p.waitForTimeout(600);
    ok(await p.locator('table.mx tbody tr').count() === 6, name + ': Tabelle hat nicht 6 Zeilen');
    ok(await p.locator('table.mx th.mxcol').count() >= 5, name + ': Tabelle: Sprach-Spalten fehlen');
    await p.screenshot({path: `${L.SHOTS}/p5c-grp-${name}-3-tabelle.png`, fullPage: true});
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov <= 0, `${name}: horizontaler Überlauf der Seite ${ov}px (die Tabelle scrollt in sich)`);
    // Spaltenkopf Englisch (Untertitel) abwählen
    await p.locator('th.mxcol.subtitle label', {hasText: 'Englisch'}).locator('input').uncheck(); await p.waitForTimeout(500);
    ok(await p.locator('td.mxcell.off').count() >= 6, name + ': Spaltenhaken wirkt nicht auf alle Dateien');
    await p.locator('th.mxcol.subtitle label', {hasText: 'Englisch'}).locator('input').check(); await p.waitForTimeout(400);
    // ---- Einzelne Dateien ----
    await p.click('.trkviews button:has-text("Einzelne Dateien")'); await p.waitForTimeout(600);
    ok(await p.locator('.trkcard').count() === 6, name + ': Einzelansicht zeigt nicht 6 Spurkarten der ersten Datei');
    ok(/wird umgewandelt/.test(await T()), name + ': Karte zeigt die Regel nicht („wird umgewandelt“)');
    await p.screenshot({path: `${L.SHOTS}/p5c-grp-${name}-4-einzeln.png`, fullPage: true});
    await p.evaluate(() => { document.querySelectorAll('.trkmore').forEach(b => b.click()); }); await p.waitForTimeout(800);
    ok(/Forced \(erzwungene Untertitel\)/.test(await T()), name + ': Beschriftung „Forced (erzwungene Untertitel)“ fehlt');
    // ---- Sprach-Wünsche in den Einstellungen ----
    await p.evaluate(() => { location.hash = '#settings/tracks'; }); await p.waitForTimeout(600);
    ok(await p.locator('.prefsec').count() === 4, name + ': Einstellungsseite hat nicht 4 Bereiche');
    const sec = i => p.locator('.prefsec').nth(i);
    await sec(0).locator('select').selectOption('ger'); await p.waitForTimeout(500);
    await sec(0).locator('select').selectOption('eng'); await p.waitForTimeout(500);
    await sec(1).locator('select').selectOption('eng'); await p.waitForTimeout(500);
    await sec(1).locator('select').selectOption('ger'); await p.waitForTimeout(500);
    ok(await sec(0).locator('.rankcard').count() === 2, name + ': Rangliste „Ton behalten“ hat nicht 2 Einträge');
    await sec(1).locator('.rankcard').nth(1).locator('button[title="Nach oben"]').click(); await p.waitForTimeout(500); // ger vor eng
    ok(/Deutsch/.test(await sec(1).locator('.rankcard').first().textContent()), name + ': ▲ verschiebt nicht');
    await sec(3).locator('select').selectOption('ger:forced'); await p.waitForTimeout(500);
    await sec(3).locator('select').selectOption('ger'); await p.waitForTimeout(500);
    ok(/Forced/.test(await sec(3).locator('.rankcard').first().textContent()), name + ': Standard-Untertitel „Deutsch (Forced)“ fehlt');
    await p.screenshot({path: `${L.SHOTS}/p5c-grp-${name}-5-einstellungen.png`, fullPage: true});
    const ov2 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov2 <= 0, `${name}/Einstellungen: horizontaler Überlauf ${ov2}px`);
    // zurück zum Konverter: Dateien sind noch da
    await p.evaluate(() => { location.hash = ''; }); await p.waitForTimeout(600);
    await L.goStep(p, 'tracks'); await p.waitForTimeout(1500);
    await p.click('.trkviews button:has-text("Gruppen")'); await p.waitForTimeout(800);
    ok(/Meine Sprach-Wünsche anwenden/.test(await p.textContent('#trackSettings')), name + ': Wunsch-Zeile fehlt');
    const g1 = await p.locator('.trkgrp').first().textContent();
    ok(/Französisch.*entfernt|entfernt.*Sprache nicht in deiner Liste/.test(g1), name + ': Französisch sollte wegen der Sprach-Liste entfernt werden');
    ok(/Standard/.test(g1), name + ': Standard-Spur (Rangliste) nicht gesetzt');
    await p.screenshot({path: `${L.SHOTS}/p5c-grp-${name}-6-wuensche.png`, fullPage: true});
    // Wünsche abschalten → alles wieder unverändert (außer der DTS-Regel)
    await p.locator('.trkpref input[type=checkbox]').uncheck(); await p.waitForTimeout(600);
    ok(!/Sprache nicht in deiner Liste/.test(await p.locator('.trkgrp').first().textContent()), name + ': Wünsche lassen sich nicht abschalten');
    await p.locator('.trkpref input[type=checkbox]').check(); await p.waitForTimeout(600);
    // ---- Zusammenfassung: Wirkung ----
    await L.goStep(p, 'summary'); await p.waitForTimeout(2000);
    const sumTxt = (await p.textContent('#startInfo')).replace(/\s+/g, ' ');
    ok(/Spuren (wegen deiner Sprach-Liste entfernt|von dir abgewählt)/.test(sumTxt) && /Tonspuren umgewandelt/.test(sumTxt), name + ': Wirkung in der Zusammenfassung fehlt: ' + sumTxt.slice(-260));
    await p.screenshot({path: `${L.SHOTS}/p5c-grp-${name}-7-summary.png`, fullPage: true});
    // ---- echter Lauf (nur Desktop): Ergebnis prüfen ----
    if (name === 'desktop') {
      await L.goStep(p, 'dest'); await p.selectOption('#outMode', 'custom'); await p.fill('#outDir', OUT); await p.waitForTimeout(200);
      await p.selectOption('#exists', 'overwrite');
      await L.goStep(p, 'summary'); await p.waitForTimeout(800);
      await p.click('#start'); await p.waitForTimeout(8000);
      const f1 = OUT + '/ep01.mkv', f6 = OUT + '/ep06.mkv';
      ok(fs.existsSync(f1) && fs.existsSync(f6), name + ': Ergebnisdateien fehlen');
      if (fs.existsSync(f1)) {
        const st = probe(f1), a = st.filter(s => s.codec_type === 'audio'), u = st.filter(s => s.codec_type === 'subtitle');
        ok(a.length === 2 && a[0].codec_name === 'eac3' && a[0].tags.language === 'ger', name + ': ep01 Ton: ger muss E-AC-3 sein (DTS-Regel), eng bleiben, fre fehlen: ' + JSON.stringify(a.map(s => [s.codec_name, s.tags && s.tags.language])));
        ok(a[0].disposition.default === 1 && a[1].disposition.default === 0, name + ': ep01: Deutsch sollte Standard-Ton sein');
        ok(u.length === 3 && u[0].disposition.default === 1 && u[1].disposition.default === 0, name + ': ep01 Untertitel: alle 3 bleiben (keine Untertitel-Sprachliste), Deutsch wird Standard');
      }
      if (fs.existsSync(f6)) {
        const a = probe(f6).filter(s => s.codec_type === 'audio');
        ok(a.length === 1 && a[0].tags.language === 'eng', name + ': ep06 (nur Englisch): nichts darf entfernt werden');
      }
    }
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
