// Prüfregel: Kontrolle nach dem Konvertieren (Karte „Prüfen“) und Qualitätsstufen (Karte „Video“) auf der Konvertieren-Seite in allen Ansichten.
// Aufruf (Server mit frischem Konfigurationsordner): SHOTS=/tmp/shots node tools/ui-check-verify.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
(async () => {
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    await L.enter(p, 'video'); await L.addFile(p, 'long.mkv'); await L.toCheck(p); await p.waitForTimeout(900);
    // ---- Qualität in Stufen (Karte „Video“) ----
    const vsel = (aria, v) => p.selectOption(`.cvgrid select[aria-label="${aria}"]`, v);
    await vsel('Video-Codec', 'hevc'); await p.waitForTimeout(500);
    ok(await p.locator('#vMaterial, #vMatRow').count() === 0, name + ': die Materialauswahl sollte es nicht mehr geben');
    ok(await p.locator('.cvgrid .qs').count() === 4, name + ': vier Qualitätsstufen fehlen');
    ok(await p.inputValue('#vQuality') === 'good', name + ': Standardstufe sollte „Gut“ sein');
    ok(await p.inputValue('#vCrf') === '20', name + ': „Gut“ bei H.265 (CPU) sollte 20 sein, ist ' + await p.inputValue('#vCrf'));
    await vsel('Auflösung', '720'); await p.waitForTimeout(400);
    ok(await p.inputValue('#vCrf') === '20', name + ': feste Stufen, auch bei 720p unverändert 20, ist ' + await p.inputValue('#vCrf'));
    ok(/Stufe „Gut“ = CRF 20/.test(await p.textContent('#vCrfWhy')), name + ': Stufentext fehlt: ' + await p.textContent('#vCrfWhy'));
    ok(await p.locator('.cvgrid .qadv input[type=range]').count() === 1, name + ': Regler für den eigenen Wert fehlt (steht immer da)');
    await p.locator('.cvgrid .qadv input[type=range]').fill('28'); await p.waitForTimeout(400); // wie der Nutzer: Regler ziehen
    ok(/Eigener Wert/.test(await p.textContent('.cvgrid .qadv')), name + ': Regler zeigt „Eigener Wert“ nicht');
    ok(await p.inputValue('#vQuality') === 'custom', name + ': bewegter Regler sollte „Eigener Wert“ sein, ist ' + await p.inputValue('#vQuality'));
    ok(/Eigener Wert/.test(await p.textContent('#vCrfWhy')), name + ': Text „Eigener Wert“ fehlt');
    await p.screenshot({path: `${L.SHOTS}/p5c-vf-${name}-video.png`, fullPage: true});
    await p.click('.cvgrid .qs >> nth=0'); await p.waitForTimeout(300);
    ok(await p.inputValue('#vQuality') === 'very' && await p.inputValue('#vCrf') === '17', name + ': Stufe „Sehr gut“ wirkt nicht: ' + await p.inputValue('#vCrf'));
    await vsel('Video-Codec', 'h264'); await p.waitForTimeout(400);
    ok(await p.inputValue('#vCrf') === '15', name + ': H.264 „Sehr gut“ sollte 15 sein, ist ' + await p.inputValue('#vCrf'));
    await p.click('.cvgrid .qs >> nth=1'); await p.waitForTimeout(300);
    ok(await p.inputValue('#vCrf') === '18', name + ': H.264 „Gut“ sollte 18 sein, ist ' + await p.inputValue('#vCrf'));
    await vsel('Video-Codec', 'copy'); await p.waitForTimeout(400);
    ok(await p.locator('.cvgrid .qs').count() === 0, name + ': Qualität sollte bei „Kopieren“ weg sein');
    await vsel('Video-Codec', 'hevc'); await p.waitForTimeout(300); await vsel('Auflösung', '0'); await p.waitForTimeout(300);
    // ---- Kontrolle (Karte „Prüfen“) ----
    const chk = await L.openCard(p, 'verify'); await p.waitForTimeout(500);
    ok(await chk.isVisible() && await chk.locator('.opt').count() === 3, name + ': Karte „Prüfen“ mit drei Auswahlen fehlt');
    ok(await p.isChecked('#vfTracks') && await p.isChecked('#vfDecode'), name + ': A und B sollten standardmäßig an sein');
    ok(/kaum länger/.test(await p.textContent('#vfTracksT')), name + ': Zeitangabe A fehlt');
    ok(/länger/.test(await p.textContent('#vfDecodeT')), name + ': Zeitangabe B fehlt');
    ok(await chk.locator('.opt:has-text("Spuren") input').isChecked() && await chk.locator('.opt:has-text("durchlesen") input').isChecked(), name + ': die Auswahlen in der Karte zeigen A und B nicht an');
    await p.screenshot({path: `${L.SHOTS}/p5c-vf-${name}-summary-off.png`, fullPage: true});
    await chk.locator('.opt:has-text("Original danach löschen") input').check(); await p.waitForTimeout(300);
    ok(await p.locator('#vfGrace, #vfDays').count() === 0, name + ': Schonfrist-Bedienelemente sollten entfernt sein');
    ok(await p.isChecked('#deleteSource') && /GELÖSCHT/.test((await p.locator('.banner.warn').allTextContents()).join(' ')), name + ': Warnhinweis „sofort und endgültig GELÖSCHT“ fehlt');
    await p.screenshot({path: `${L.SHOTS}/p5c-vf-${name}-summary-on.png`, fullPage: true});
    // ---- Arten getrennt ----
    await L.enter(p, 'audio'); if (!(await p.locator('#fileList .file').count())) await L.addFile(p, 'a.mp3'); await L.goStep(p, 'verify'); await p.waitForTimeout(500);
    ok(!(await p.isChecked('#deleteSource')), name + ': Audio übernimmt „Quelldatei löschen“ aus Video');
    ok(/kaum länger/.test(await p.locator('[data-card=check] .opt:has-text("durchlesen")').textContent()), name + ': Audio-Zeitangabe für B sollte „kaum länger“ sein');
    await p.locator('[data-card=check] .opt:has-text("durchlesen") input').uncheck(); await p.waitForTimeout(300);
    await L.enter(p, 'video'); await L.goStep(p, 'verify'); await p.waitForTimeout(500);
    ok(await p.isChecked('#vfDecode') && await p.isChecked('#deleteSource'), name + ': Video hat seine Auswahl verloren');
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov <= 0, `${name}: horizontaler Überlauf ${ov}px`);
    // ---- Einstellungen ----
    await p.evaluate(() => { location.hash = '#settings/general'; }); await p.waitForTimeout(500);
    ok((await p.textContent('#viewSettings')).includes('Kontrolle'), name + ': Einstellungen ohne Kontrolle-Zeilen');
    await p.screenshot({path: `${L.SHOTS}/p5c-vf-${name}-settings.png`, fullPage: true});
    const ov2 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov2 <= 0, `${name}/Einstellungen: horizontaler Überlauf ${ov2}px`);
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
