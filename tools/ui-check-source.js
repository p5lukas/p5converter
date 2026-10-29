// Prüfregel: Die Quelle ist in der Video-Karte der Konvertieren-Seite zu sehen: die Zeile „Video“ nennt Codec, Höhe und Bit-Tiefe der Quelle, „wie Quelle“ nennt
// den Quellwert (Auflösung, Bit-Tiefe), der Hinweis an der Codec-Wahl nennt die Quelle („Deine Quelle: H.264 → H.265 …“); in allen Ansichten, ohne Überlauf.
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
    const row = lbl => p.locator('.cvgrid .cvr', {has: p.locator('.cvk', {hasText: new RegExp('^' + lbl + '\\s*i?$', 'i')})});
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    await L.enter(p, 'video');
    ok(!(await p.isVisible('#cvTable')), name + ': Schritt 1: die Tabelle darf noch nicht da sein');
    await p.click('#addFiles'); await p.waitForTimeout(300);
    await p.fill('#bPath', L.INDIR); await p.click('#bGo'); await p.waitForTimeout(500);
    await p.click('#bAll'); await p.click('#bAddSel'); await p.waitForTimeout(800);
    await L.toCheck(p); await p.waitForTimeout(1500);
    // Remux: nur die Zeile „Video“ mit der Quelle links
    const v0 = (await row('Video').locator('.cvb').textContent()).replace(/\s+/g, ' ');
    ok(/H\.264/.test(v0) && /\d+p/.test(v0) && /8 Bit/.test(v0), name + ': Quelle in der Zeile Video: ' + v0);
    // H.265 wählen: „wie Quelle“ nennt den Quellwert, der Hinweis nennt die Quelle
    const pick = async label => { await p.selectOption('.cvgrid select[aria-label="Video-Codec"]', label); await p.waitForTimeout(600); return (await p.textContent('.cvgrid .cvhint').catch(() => '')).replace(/\s+/g, ' '); };
    const h265 = await pick('hevc');
    ok(/wie Quelle \(\d+p\)/.test(await p.textContent('.cvgrid select[aria-label="Auflösung"] option:checked')), name + ': Auflösung „wie Quelle“ ohne Quellwert');
    ok(/wie Quelle \(8 Bit\)/.test(await p.textContent('.cvgrid select[aria-label="Bit-Tiefe"] option:checked')), name + ': Bit-Tiefe „wie Quelle“ ohne Quellwert');
    ok(/Deine Quelle: H\.264 → H\.265\. Das spart meist Platz/.test(h265) && await p.locator('.cvgrid .cvhint.good').count() === 1, name + ': Hinweis zu H.265: ' + h265);
    const h264 = await pick('h264');
    ok(/H\.264 läuft fast überall/.test(h264), name + ': Hinweis zu H.264: ' + h264);
    await pick('copy');
    const copy = (await p.textContent('.cvgrid')).replace(/\s+/g, ' ');
    ok(/nicht neu kodiert/.test(copy), name + ': Hinweis zu Kopieren fehlt');
    ok(!/Prozent|%|spart.*GB/i.test(h265 + h264 + copy), name + ': keine Schätzung der Ersparnis an der Codec-Wahl');
    await pick('hevc');
    ok(await ov() <= 0, name + ': Überlauf ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-source-${name}-1-video.png`, fullPage: true});
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
