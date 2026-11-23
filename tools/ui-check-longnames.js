// Prüfregel: Lange Dateinamen werden in der Namensliste („Name & Ziel“) und auf der Seite „Umbenennen“ nie abgeschnitten: alter Name oben, neuer darunter,
// lange Namen brechen um (Variante A). Voraussetzung: INDIR enthält eine Datei „Hellsing Ultimate (2006) - S01E01 …“ (tools/make-fixtures.sh), Wurzelordner INDIR.
// Aufruf: INDIR=/tmp/media SHOTS=/tmp/shots node tools/ui-check-longnames.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
// Alle Namenszeilen: nichts abgeschnitten (scrollWidth <= clientWidth, keine Ellipse), zwei Zeilen (alt oben, neu darunter)
const clipped = (p, rows, oldSel, newSel) => p.evaluate(([rows, o, n]) => [...document.querySelectorAll(rows)].map(r => {
  const a = r.querySelector(o), b = r.querySelector(n);
  return !(a.scrollWidth <= a.clientWidth + 1 && b.scrollWidth <= b.clientWidth + 1 && getComputedStyle(a).textOverflow !== 'ellipsis' && getComputedStyle(b).textOverflow !== 'ellipsis' && b.getBoundingClientRect().top > a.getBoundingClientRect().top + 4);
}).filter(Boolean).length, [rows, oldSel, newSel]);
(async () => {
  const b = await L.launch();
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1300);
    // Name & Ziel
    await L.enter(p, 'video'); await L.addFile(p, 'Hellsing Ultimate'); await L.toCheck(p); await p.waitForTimeout(800);
    await p.evaluate(() => { const {cvSet} = window.__p5; cvSet('suffix', ' [X]'); });
    const nc = await L.openCard(p, 'name'); await p.waitForSelector('.cvnamelist .cvnl', {timeout: 8000}); await p.waitForTimeout(500);
    const full = 'Hellsing Ultimate (2006) - S01E01 - Hellsing I [Bluray-1080p][DTS 5.1][x265][10bit]-GRUPPE';
    const txt = (await nc.locator('.cvnamelist').textContent()).replace(/\s+/g, ' ');
    ok(txt.includes(full + '.mkv') && txt.includes(full + ' [X].mkv'), name + ': der ganze alte und neue Name steht in „Name & Ziel“: ' + txt.slice(0, 200));
    ok(await clipped(p, '.cvnamelist .cvnl', '.o', '.n') === 0, name + ': Namensliste in „Name & Ziel“ schneidet Namen ab oder stellt sie nicht untereinander');
    ok(await ov() <= 0, `${name}: horizontaler Überlauf in „Name & Ziel“ ${await ov()}px`);
    await p.screenshot({path: `${L.SHOTS}/p5c-longnames-${name}-1-dest.png`, fullPage: true});
    // Seite „Umbenennen“
    await L.goStep(p, 'start'); await p.click('#startRename'); await p.waitForTimeout(500);
    await L.addFile(p, 'Hellsing Ultimate', '#rnAddFiles');
    await p.fill('#rnPattern', '{filename} [X]'); await p.waitForSelector('#rnPreview .rnrow', {timeout: 8000}); await p.waitForTimeout(600);
    ok(await clipped(p, '#rnPreview .rnrow', '.old', '.new') === 0, name + ': Vorschau auf der Seite „Umbenennen“ schneidet Namen ab oder stellt sie nicht untereinander');
    ok(await ov() <= 0, `${name}: horizontaler Überlauf auf „Umbenennen“ ${await ov()}px`);
    await p.screenshot({path: `${L.SHOTS}/p5c-longnames-${name}-2-rename.png`, fullPage: true});
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
