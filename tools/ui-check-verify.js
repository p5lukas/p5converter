// Prüfregel: Kontrolle nach dem Konvertieren (Details → Prüfen) und Qualitätsstufen (Details → Video) in allen Ansichten.
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
    await L.enter(p, 'video');
    // ---- Qualität in Stufen (Details → Video) ----
    await L.goStep(p, 'video');
    await p.selectOption('#vCodec', 'hevc'); await p.waitForTimeout(400);
    ok(await p.locator('#vMaterial, #vMatRow').count() === 0, name + ': die Materialauswahl sollte es nicht mehr geben');
    ok(await p.locator('#vQualityMount .qs').count() === 4, name + ': vier Qualitätsstufen fehlen');
    ok(await p.inputValue('#vQuality') === 'good', name + ': Standardstufe sollte „Gut“ sein');
    ok(await p.inputValue('#vCrf') === '20', name + ': „Gut“ bei H.265 (CPU) sollte 20 sein, ist ' + await p.inputValue('#vCrf'));
    await p.selectOption('#vHeight', '720'); await p.waitForTimeout(300);
    ok(await p.inputValue('#vCrf') === '20', name + ': feste Stufen, auch bei 720p unverändert 20, ist ' + await p.inputValue('#vCrf'));
    ok(/Stufe „Gut“ = CRF 20/.test(await p.textContent('#vCrfWhy')), name + ': Stufentext fehlt: ' + await p.textContent('#vCrfWhy'));
    await p.fill('#vCrf', '27'); await p.dispatchEvent('#vCrf', 'input'); await p.waitForTimeout(250);
    ok(await p.inputValue('#vQuality') === 'custom', name + ': bewegter Regler sollte „Eigener Wert“ sein, ist ' + await p.inputValue('#vQuality'));
    ok(/Eigener Wert/.test(await p.textContent('#vCrfWhy')), name + ': Text „Eigener Wert“ fehlt');
    await p.screenshot({path: `${L.SHOTS}/p5c-vf-${name}-video.png`, fullPage: true});
    await p.click('#vQualityMount .qs >> nth=0'); await p.waitForTimeout(300);
    ok(await p.inputValue('#vQuality') === 'very' && await p.inputValue('#vCrf') === '17', name + ': Stufe „Sehr gut“ wirkt nicht: ' + await p.inputValue('#vCrf'));
    await p.selectOption('#vCodec', 'h264'); await p.waitForTimeout(300);
    ok(await p.inputValue('#vCrf') === '15', name + ': H.264 „Sehr gut“ sollte 15 sein, ist ' + await p.inputValue('#vCrf'));
    await p.click('#vQualityMount .qs >> nth=1'); await p.waitForTimeout(300);
    ok(await p.inputValue('#vCrf') === '18', name + ': H.264 „Gut“ sollte 18 sein, ist ' + await p.inputValue('#vCrf'));
    await p.selectOption('#vCodec', 'copy'); await p.waitForTimeout(300);
    ok(!(await p.isVisible('#vQualityRow')), name + ': Qualität sollte bei „Kopieren“ weg sein');
    await p.selectOption('#vCodec', 'hevc'); await p.selectOption('#vHeight', '0');
    // ---- Kontrolle im letzten Schritt ----
    await L.goStep(p, 'verify'); await p.waitForTimeout(500);
    ok(await p.isVisible('#vfCard'), name + ': Prüf-Karte fehlt');
    ok(await p.isChecked('#vfTracks') && await p.isChecked('#vfDecode'), name + ': A und B sollten standardmäßig an sein');
    ok(/kaum länger/.test(await p.textContent('#vfTracksT')), name + ': Zeitangabe A fehlt');
    ok(/länger/.test(await p.textContent('#vfDecodeT')), name + ': Zeitangabe B fehlt');
    await p.screenshot({path: `${L.SHOTS}/p5c-vf-${name}-summary-off.png`, fullPage: true});
    await p.check('#deleteSource'); await p.waitForTimeout(200);
    ok(await p.locator('#vfGrace, #vfDays').count() === 0, name + ': Schonfrist-Bedienelemente sollten entfernt sein');
    ok(await p.isVisible('#vfDelHint'), name + ': Warnhinweis „sofort und endgültig“ fehlt');
    await p.screenshot({path: `${L.SHOTS}/p5c-vf-${name}-summary-on.png`, fullPage: true});
    // ---- Arten getrennt ----
    await L.enter(p, 'audio'); await L.goStep(p, 'verify'); await p.waitForTimeout(300);
    ok(!(await p.isChecked('#deleteSource')), name + ': Audio übernimmt „Quelldatei löschen“ aus Video');
    ok(/kaum länger/.test(await p.textContent('#vfDecodeT')), name + ': Audio-Zeitangabe für B sollte „kaum länger“ sein');
    await p.uncheck('#vfDecode');
    await L.enter(p, 'video'); await L.goStep(p, 'verify'); await p.waitForTimeout(300);
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
