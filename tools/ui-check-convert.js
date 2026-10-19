// Prüfregel: die Tabelle „Vorher → Nachher“ in allen Ansichten – Gruppen nach Rahmendaten, Kontrolle und Übernahme (✦), Regel-Markierung
// mit „rückgängig“, Änderungen je Zeile, Start mit unkontrollierter Gruppe, kleine Fenster (am Handy als Blatt unten) und ein echter Lauf.
// Voraussetzung: INDIR enthält ep01.mkv … ep06.mkv (ep01–05: Ton ger (DTS)/eng/fre + Untertitel ger/eng/fre, ep06: nur eng), Wurzelordner INDIR und OUTDIR,
// Server mit frischem Konfigurationsordner. Aufruf: INDIR=/tmp/season OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-convert.js
const L = require('./ui-lib.js');
const {execFileSync} = require('child_process');
const fs = require('fs');
const OUT = (process.env.OUTDIR || '/tmp/out') + '/convert';
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
    let dialogs = 0, accept = false;
    p.on('dialog', d => { dialogs++; accept ? d.accept() : d.dismiss(); });
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const row = lbl => p.locator('.cvgrid .cvr', {has: p.locator('.cvk', {hasText: new RegExp('^' + lbl + '$', 'i')})});
    const jobs = async () => (await (await fetch(L.url + '/api/state')).json()).jobs.length;
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    await p.evaluate(async () => { const s = await (await fetch('/api/settings')).json(); s.settings.trackPrefs = {audioKeep: [], subKeep: [], audioDefault: [], subDefault: []}; s.settings.presets = s.settings.presets.slice(0, 2);
      await fetch('/api/settings', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(s.settings)}); });
    await p.goto(L.url); await p.waitForTimeout(1300);
    await L.setWorld(p, 'video'); await p.click('#startFlow'); await p.waitForTimeout(300);
    await p.click('#addFiles'); await p.waitForTimeout(300);
    await p.fill('#bPath', L.INDIR); await p.click('#bGo'); await p.waitForTimeout(500);
    await p.click('#bAll'); await p.click('#bAddSel'); await p.waitForTimeout(2800);

    // ---- Gruppen nach Rahmendaten ----
    ok(await p.locator('.cvg').count() === 2, name + ': 2 Gruppen erwartet, ' + await p.locator('.cvg').count());
    const gt = (await p.locator('.cvg').allTextContents()).join(' | ').replace(/\s+/g, ' ');
    ok(/Gruppe 1.*5 Dateien/.test(gt) && /Gruppe 2.*1 Datei/.test(gt), name + ': Gruppenbeschriftung: ' + gt);
    ok(/noch nicht kontrolliert/.test(gt), name + ': „noch nicht kontrolliert“ fehlt');
    ok(await p.locator('.cvg.todo').count() === 2, name + ': beide Gruppen sollten „todo“ sein');
    ok(/Gruppe 1: Ton: .*Untertitel:/.test(await p.textContent('.cvgline')), name + ': Zeile mit Sprachen der Gruppe fehlt');
    for (const r of ['Video', 'Container', 'Ton 1', 'Ton 2', 'Ton 3', 'Untertitel 1', 'Untertitel 2', 'Untertitel 3', 'Dateiname']) ok(await row(r).count() === 1, name + ': Zeile „' + r + '“ fehlt');
    ok(await p.locator('.cvgrid .cvk', {hasText: /^Qualität$/i}).count() === 0, name + ': bei „Kopieren“ darf es keine Qualitätszeile geben');
    ok(/Remux/.test(await p.textContent('#startInfo')) && /noch nicht kontrolliert/.test(await p.textContent('#startInfo')), name + ': Startleiste ohne Warnung: ' + await p.textContent('#startInfo'));
    ok(await ov() <= 0, name + ': Überlauf ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-cv-${name}-1-gruppen.png`, fullPage: true});

    // ---- ✦ Regel: DTS → AC-3 vorschlagen, anlegen, markieren, rückgängig ----
    await p.click('#cvTable button:has-text("Regel anlegen: DTS")'); await p.waitForTimeout(700);
    ok(await row('Ton 1').locator('select.cvact').inputValue() === 'encode', name + ': Ton 1 sollte „umwandeln“ sein');
    ok(/AC-3 192 kbit\/s/.test(await row('Ton 1').textContent()), name + ': Zielformat „AC-3 192 kbit/s“ fehlt: ' + await row('Ton 1').textContent());
    ok(await row('Ton 1').locator('.cvai .ai').count() === 1 && /Regel/.test(await row('Ton 1').locator('.cvai').textContent()), name + ': ✦ „Automatisch“ mit Regel-Begründung fehlt');
    ok(await row('Ton 2').locator('.cvai').count() === 0, name + ': Ton 2 (unverändert) darf kein ✦ haben – Standardvorschläge leuchten nicht');
    ok(await p.locator('.cvgrid .cvai').count() === 1, name + ': genau eine automatische Markierung erwartet, ' + await p.locator('.cvgrid .cvai').count());
    await p.screenshot({path: `${L.SHOTS}/p5c-cv-${name}-2-regel.png`, fullPage: true});
    await row('Ton 1').locator('.cvai button:has-text("rückgängig")').click(); await p.waitForTimeout(500);
    ok(await row('Ton 1').locator('select.cvact').inputValue() === 'copy' && await row('Ton 1').locator('.cvai').count() === 0, name + ': „rückgängig“ wirkt nicht');
    // jetzt von Hand: Ton 1 wieder „umwandeln“ (= was die Regel ohnehin ergibt, also wieder automatisch markiert), Ton 3 (Französisch) entfernen, Untertitel 2 (Englisch) als Forced
    await row('Ton 1').locator('select.cvact').selectOption('encode'); await p.waitForTimeout(400);
    ok(await row('Ton 1').locator('.cvai').count() === 1, name + ': gleicher Ausgang wie die Regel: ✦ erwartet');
    await row('Ton 2').locator('select.cvact').selectOption('drop'); await p.waitForTimeout(300);
    ok(await row('Ton 2').locator('.cvai').count() === 0, name + ': eigene Entscheidung (entfernen) darf kein ✦ tragen');
    await row('Ton 2').locator('select.cvact').selectOption('copy'); await p.waitForTimeout(300);
    await row('Ton 3').locator('select.cvact').selectOption('drop'); await p.waitForTimeout(400);
    ok(await p.locator('.cvr.dropped').count() === 1, name + ': entfernte Spur nicht durchgestrichen');
    await row('Untertitel 2').locator('.cvflag:has-text("Forced")').click(); await p.waitForTimeout(400);
    ok(await row('Untertitel 2').locator('.cvflag.on:has-text("Forced")').count() === 1, name + ': Forced-Schalter wirkt nicht');
    // Erweitert: Titel ändern
    await row('Untertitel 2').locator('.cvmore').click(); await p.waitForTimeout(300);
    ok(await row('Untertitel 2').locator('.cved').count() === 1, name + ': Erweitert-Bereich fehlt');
    await row('Untertitel 2').locator('.cved input').first().fill('English forced'); await p.keyboard.press('Tab'); await p.waitForTimeout(500);
    ok(await row('Untertitel 2').locator('.cved input').first().inputValue() === 'English forced', name + ': Titel nicht übernommen');
    await row('Untertitel 2').locator('.cvmore').click(); await p.waitForTimeout(200);

    // ---- Gruppe 1 kontrollieren → Übernahme in Gruppe 2 ----
    await p.click('.cvgline button:has-text("ist kontrolliert")'); await p.waitForTimeout(600);
    ok(await p.locator('.cvg.rev').count() === 1 && await p.locator('.cvg.todo').count() === 1, name + ': Gruppe 1 sollte kontrolliert, Gruppe 2 offen sein');
    ok(/noch nicht kontrolliert/.test(await p.textContent('#startInfo')) && /1 Gruppe/.test(await p.textContent('#startInfo')), name + ': Startleiste: noch 1 Gruppe offen erwartet: ' + await p.textContent('#startInfo'));
    await p.locator('.cvg').nth(1).click(); await p.waitForTimeout(600);
    ok(/Gruppe 2/.test(await p.textContent('.cvgline')) && /anders aufgebaut/.test(await p.textContent('.cvgline')), name + ': Hinweis „anders aufgebaut“ fehlt');
    ok(await row('Untertitel 1').locator('.cvflag.on:has-text("Forced")').count() === 1, name + ': Forced wurde nicht in Gruppe 2 übernommen');
    ok(/Übernommen/.test(await row('Untertitel 1').locator('.cvai').textContent()) && /Gruppe 1/.test(await row('Untertitel 1').locator('.cvai').textContent()), name + ': Markierung „Übernommen aus Gruppe 1“ fehlt');
    await p.screenshot({path: `${L.SHOTS}/p5c-cv-${name}-3-uebernahme.png`, fullPage: true});

    // ---- Start mit unkontrollierter Gruppe fragt nach (Nein → es startet nichts) ----
    const before = await jobs();
    await p.click('#start'); await p.waitForTimeout(800);
    ok(dialogs >= 1, name + ': keine Rückfrage bei unkontrollierter Gruppe');
    ok(await jobs() === before, name + ': trotz „Nein“ wurde gestartet');
    await p.click('.cvgline button:has-text("ist kontrolliert")'); await p.waitForTimeout(500);
    ok(await p.locator('.cvg.rev').count() === 2 && !/noch nicht kontrolliert/.test(await p.textContent('#startInfo')), name + ': beide Gruppen sollten kontrolliert sein');
    ok(await ov() <= 0, name + ': Überlauf nach Kontrolle ' + await ov() + 'px');

    // ---- kleines Fenster: am Handy ein Blatt unten ----
    await p.click('#cvSentence .tok >> nth=0'); await p.waitForTimeout(300);
    const box = await p.locator('.cvpop').boundingBox(), vp = p.viewportSize();
    ok(!!box && box.x >= 0 && box.x + box.width <= vp.width + 1, name + ': Fenster ragt seitlich heraus');
    if (vp.width <= 700) ok(box && Math.abs(box.y + box.height - vp.height) <= 3, name + ': am Handy sollte das Fenster unten als Blatt sitzen');
    await p.screenshot({path: `${L.SHOTS}/p5c-cv-${name}-4-fenster.png`});
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(await p.locator('.cvpop').count() === 0, name + ': Fenster schließt nicht mit Esc');
    await p.screenshot({path: `${L.SHOTS}/p5c-cv-${name}-5-fertig.png`, fullPage: true});

    // ---- echter Lauf (nur Desktop): Ergebnis prüfen ----
    if (name === 'desktop') {
      await L.goStep(p, 'dest'); await p.selectOption('#outMode', 'custom'); await p.fill('#outDir', OUT); await p.selectOption('#exists', 'overwrite');
      await L.goStep(p, 'files'); accept = true;
      await p.click('#start'); await p.waitForTimeout(9000);
      for (const e of ['ep01', 'ep03', 'ep05']) {
        const f = OUT + '/' + e + '.mkv';
        if (!fs.existsSync(f)) { fails.push(name + ': ' + e + ' fehlt'); continue; }
        const st = probe(f), a = st.filter(s => s.codec_type === 'audio'), u = st.filter(s => s.codec_type === 'subtitle');
        ok(a.length === 2 && !a.some(s => s.tags && s.tags.language === 'fre'), name + ': ' + e + ': Französisch sollte fehlen (' + a.map(s => s.tags && s.tags.language) + ')');
        ok(a[0].codec_name === 'ac3' && a[0].bit_rate && +a[0].bit_rate <= 200000, name + ': ' + e + ': Ton 1 sollte per Regel in AC-3 umgewandelt sein, ist ' + a[0].codec_name);
        ok(u.length === 3 && u[1].disposition.forced === 1 && u[0].disposition.forced === 0, name + ': ' + e + ': Untertitel 2 sollte Forced sein: ' + JSON.stringify(u.map(s => s.disposition.forced)));
        ok(u[1].tags && u[1].tags.title === 'English forced', name + ': ' + e + ': Titel „English forced“ fehlt');
      }
      const f6 = OUT + '/ep06.mkv';
      if (!fs.existsSync(f6)) fails.push(name + ': ep06 fehlt');
      else { const u6 = probe(f6).filter(s => s.codec_type === 'subtitle'); ok(u6.length === 1 && u6[0].disposition.forced === 1, name + ': ep06: übernommenes Forced fehlt im Ergebnis'); }
    }
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
