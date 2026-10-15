// Prüft Symbole (keine bunten Emojis), Namensmuster + Ersetzungen + Vorschau (Schritt „Benennen“) und die Seite „Umbenennen“
// in allen Ansichten. Aufruf: INDIR=/tmp/media SHOTS=/tmp/shots node tools/ui-check-rename.js   (Server auf :8787)
const L = require('./ui-lib');
const EMOJI = /\p{Emoji_Presentation}|[⚙⚠⚡⬆▶✎✦⭐]/u; // echte Emojis und iOS-anfällige Zeichen
(async () => {
  const b = await L.launch();
  const errs = [];
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt);
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => m.type() === 'error' && errs.push(name + ': ' + m.text()));
    await p.goto(L.url); await p.waitForTimeout(1200);
    await L.setWorld(p, 'video');
    await p.screenshot({ path: `${L.SHOTS}/rn-${name}-head.png` });
    await L.goStep(p, 'files'); await L.addFile(p, 'Show S01E01');
    await L.goStep(p, 'video'); await p.selectOption('#vCodec', 'hevc'); await p.selectOption('#vHeight', '720');
    await L.goStep(p, 'name');
    await p.fill('#pattern', '{filename} [{res}][{codec}]');
    await p.click('#addRule'); await p.fill('.rulerow input >> nth=0', 'webdl'); await p.fill('.rulerow input >> nth=1', 'WEB');
    await p.waitForTimeout(700);
    const prev = await p.textContent('#namePreview');
    if (!/WEB-1080p\] \[720p\]\[x265\]\.mkv/.test(prev)) errs.push(name + ': Vorschau unerwartet: ' + prev);
    await p.screenshot({ path: `${L.SHOTS}/rn-${name}-namebox.png` });
    for (const s of ['start', 'files', 'dest', 'name', 'video', 'tracks', 'summary']) {
      await L.goStep(p, s);
      const text = await p.evaluate(() => [...document.querySelectorAll('header, main, dialog')].map(e => e.innerText).join('\n'));
      const bad = text.match(EMOJI); if (bad) errs.push(`${name}: Emoji im Schritt ${s}: ${bad[0]}`);
    }
    // Seite „Umbenennen“ (von der Startseite aus)
    await L.goStep(p, 'start'); await p.click('#startRename'); await p.waitForTimeout(500);
    await L.addFile(p, 'Show S01E01', '#rnAddFiles');
    await p.fill('#rnPattern', '{title}');
    await p.click('#rnAddRule'); await p.fill('#rnRules .rulerow input >> nth=0', 'S01E01'); await p.fill('#rnRules .rulerow input >> nth=1', 'Folge 1');
    await p.waitForTimeout(700);
    const rp = await p.textContent('#rnPreview');
    if (!rp.includes('Show Folge 1 [WEBDL-1080p].mkv')) errs.push(name + ': Umbenennen-Vorschau unerwartet: ' + rp);
    await p.screenshot({ path: `${L.SHOTS}/rn-${name}-page.png`, fullPage: true });
    await p.click('#rnBack'); await p.waitForTimeout(300);
    if (!(await p.isVisible('#startFlow'))) errs.push(name + ': „← Zur Startseite“ führt nicht zur Startseite');
    await ctx.close();
  }
  await b.close();
  console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'ok');
})();
