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
    const row = lbl => p.locator('.cvgrid .cvr', {has: p.locator('.cvk', {hasText: new RegExp('^' + lbl + '\\s*i?$', 'i')})});
    const jobs = async () => (await (await fetch(L.url + '/api/state')).json()).jobs.length;
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    await p.evaluate(async () => { const s = await (await fetch('/api/settings')).json(); s.settings.trackPrefs = {audioKeep: [], subKeep: [], audioDefault: [], subDefault: []}; s.settings.presets = s.settings.presets.slice(0, 2);
      await fetch('/api/settings', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(s.settings)}); });
    await p.goto(L.url); await p.waitForTimeout(1300);
    await L.enter(p, 'video');
    await p.click('#addFiles'); await p.waitForTimeout(300);
    await p.fill('#bPath', L.INDIR); await p.click('#bGo'); await p.waitForTimeout(500);
    await p.click('#bAll'); await p.click('#bAddSel'); await p.waitForTimeout(800);
    // Schritt 2: Regel-Vorschlag DTS → E-AC-3 (nur für diesen Lauf) anlegen; Schritt 4: Kontrolle
    await p.click('#wizNext'); await p.waitForSelector('#cvRules .cvcard'); await p.waitForTimeout(500);
    ok(/DTS/.test(await p.textContent('#cvRules .trkhints')), name + ': Regel-Vorschlag für DTS fehlt in Schritt 2');
    ok(await p.locator('#cvRules .trkhints button:has-text("Immer anwenden")').count() >= 1, name + ': „Immer anwenden“ fehlt');
    await p.click('#cvRules button:has-text("Regel: DTS")'); await p.waitForTimeout(600);
    ok(await p.locator('#cvRules .trkrule').count() === 1, name + ': die Regel steht nicht bei „Eigene Regeln“');
    await L.toCheck(p); await p.waitForTimeout(2200);

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
    ok(await row('Ton 1').locator('select.cvact').inputValue() === 'encode', name + ': Ton 1 sollte „umwandeln“ sein');
    ok(/E-AC-3 \(Dolby Digital Plus\) Mono · 256 kbit\/s/.test(await row('Ton 1').textContent()), name + ': Zielformat „E-AC-3 (Dolby Digital Plus) Mono · 256 kbit/s“ fehlt: ' + await row('Ton 1').textContent());
    ok(/DTS Mono · 1411 kbit\/s|DTS Mono · \d+ kbit\/s/.test(await row('Ton 1').textContent()), name + ': Kennung mit Bitrate links fehlt: ' + await row('Ton 1').textContent());
    ok(/AC-3 \(Dolby Digital\) Mono/.test(await row('Ton 2').textContent()), name + ': Kennung „AC-3 (Dolby Digital)“ links fehlt');
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

    await p.locator('.cvg').nth(0).click(); await p.waitForTimeout(600); // zurück in Gruppe 1 (dort wird Ton 1 umgewandelt)
    // ---- Ziel anklicken: kleines Fenster (am Handy ein Blatt unten), Format und Bitrate direkt ändern ----
    await p.click('#cvTable .cvr:has(.cvk:has-text("Ton 1")) button.cvenc'); await p.waitForTimeout(300);
    const box = await p.locator('.cvpop').boundingBox(), vp = p.viewportSize();
    ok(!!box && box.x >= 0 && box.x + box.width <= vp.width + 1, name + ': Fenster ragt seitlich heraus');
    if (vp.width <= 700) ok(box && Math.abs(box.y + box.height - vp.height) <= 3, name + ': am Handy sollte das Fenster unten als Blatt sitzen');
    ok(await p.locator('.cvpop select[aria-label="Zielformat"]').count() === 1 && await p.locator('.cvpop input[aria-label="Bitrate je Stereo-Paar"]').count() === 1, name + ': Format und Bitrate im Fenster fehlen');
    await p.screenshot({path: `${L.SHOTS}/p5c-cv-${name}-4-fenster.png`});
    await p.selectOption('.cvpop select[aria-label="Zielformat"]', 'ac3'); await p.waitForTimeout(500);
    ok(/AC-3 \(Dolby Digital\) Mono · 192 kbit\/s/.test(await row('Ton 1').textContent()), name + ': Wechsel auf AC-3 im Fenster wirkt nicht: ' + await row('Ton 1').textContent());
    await p.selectOption('.cvpop select[aria-label="Zielformat"]', 'eac3'); await p.waitForTimeout(500);
    await p.fill('.cvpop input[aria-label="Bitrate je Stereo-Paar"]', '256'); await p.press('.cvpop input[aria-label="Bitrate je Stereo-Paar"]', 'Enter'); await p.waitForTimeout(600);
    ok(/E-AC-3 \(Dolby Digital Plus\) Mono · 256 kbit\/s/.test(await row('Ton 1').textContent()), name + ': Bitrate 256 im Fenster wirkt nicht');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(await p.locator('.cvpop').count() === 0, name + ': Fenster schließt nicht mit Esc');
    // Deckel: 5.1 mit 256 je Stereo-Paar = 768 → höchstens 640, mit Erklärung
    const cap = await p.evaluate(() => { const r = {s: {channels: 6, type: 'audio'}, codec: 'eac3', kbps: 256}; return {i: trkEncInfo(r), d: trkTargetDesc(r), e: trkEncExplain(r)}; });
    ok(cap.i.kbps === 640 && cap.i.capped && cap.i.raw === 768 && /640 kbit\/s \(Maximum\)/.test(cap.d) && /gedeckelt/.test(cap.e), name + ': 640er-Deckel: ' + JSON.stringify(cap));
    // Codec-Kennung mit Bitrate
    const kn = await p.evaluate(() => [trkDesc({type: 'audio', codec: 'eac3', channels: 6, bitRate: 640000}), trkDesc({type: 'audio', codec: 'aac', channels: 2, bitRate: 128000}), trkDesc({type: 'audio', codec: 'dts', profile: 'DTS-HD MA', channels: 8}), trkDesc({type: 'subtitle', codec: 'hdmv_pgs_subtitle'}), trkDesc({type: 'audio', codec: 'truehd', channels: 8})]);
    ok(kn[0] === 'E-AC-3 (Dolby Digital Plus) 5.1 · 640 kbit/s' && kn[1] === 'AAC Stereo · 128 kbit/s' && kn[2] === 'DTS-HD MA 7.1' && kn[3] === 'PGS (Bild)' && kn[4] === 'TrueHD (Dolby TrueHD) 7.1', name + ': Codec-Kennung: ' + JSON.stringify(kn));

    // ---- genau eine Standard-Tonspur (Fehler: zweite Standard-Spur ließ sich nicht abwählen) ----
    await row('Ton 3').locator('select.cvact').selectOption('copy'); await p.waitForTimeout(400); // Ton 3 war entfernt (Flags gibt es nur bei behaltenen Spuren)
    const stdOn = async () => (await p.locator('.cvr:has(.cvk:has-text("Ton")) .cvflag.on:has-text("Standard")').count());
    const stdBtn = n => row('Ton ' + n).locator('.cvflag:has-text("Standard")');
    ok(await stdOn() === 1, name + ': vorher genau eine Standard-Tonspur erwartet, ' + await stdOn());
    await stdBtn(1).click(); await p.waitForTimeout(500);
    ok(await stdOn() === 1 && await stdBtn(1).evaluate(e => e.classList.contains('on')), name + ': Standard auf Ton 1: nur Ton 1 darf Standard sein, ' + await stdOn());
    await stdBtn(3).click(); await p.waitForTimeout(500);
    ok(await stdOn() === 1 && await stdBtn(3).evaluate(e => e.classList.contains('on')), name + ': Standard auf Ton 3: nur Ton 3, ' + await stdOn());
    await stdBtn(3).click(); await p.waitForTimeout(500);
    ok(await stdOn() === 1 && await stdBtn(2).evaluate(e => e.classList.contains('on')), name + ': zweiter Klick nimmt die eigene Wahl zurück: wieder die Standard-Spur der Quelle (Ton 2), ' + await stdOn());
    await stdBtn(2).click(); await p.waitForTimeout(500);
    ok(await stdOn() === 0, name + ': Klick auf die gesetzte Quell-Standard-Spur: keine Spur mehr Standard, ' + await stdOn());
    await stdBtn(2).click(); await p.waitForTimeout(500);
    ok(await stdOn() === 1 && await stdBtn(2).evaluate(e => e.classList.contains('on')), name + ': Standard wieder auf Ton 2');
    await row('Ton 3').locator('select.cvact').selectOption('drop'); await p.waitForTimeout(400); // wieder wie vorher: Französisch entfernen
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
        ok(a[0].codec_name === 'eac3' && a[0].bit_rate && +a[0].bit_rate <= 270000, name + ': ' + e + ': Ton 1 sollte per Regel in E-AC-3 umgewandelt sein, ist ' + a[0].codec_name);
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
