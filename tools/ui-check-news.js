// Prüft: Neuigkeiten-Hinweis einmal pro Version (Merker auf dem Server), „Gewonnener Platz“ strikt je Welt mit Zurücksetzen,
// keine Neuigkeiten in der Kopfzeile. Aufruf gegen einen FRISCH gestarteten Server, dessen Konfigurationsordner schon Einstellungen,
// aber noch kein news-seen.json hat (= Update von einer älteren Version), z. B.:
//   mkdir /tmp/cfgn && echo '{"showNews":true}' > /tmp/cfgn/settings.json && P5_CONFIG=/tmp/cfgn P5_LISTEN=127.0.0.1:8788 … p5c &
//   P5_URL=http://127.0.0.1:8788 SHOTS=/tmp/shots node tools/ui-check-news.js
// Vorher je einen Audio- und Video-Auftrag fertig konvertieren lassen (für die Statistik).
const L = require('./ui-lib');
(async () => {
  const b = await L.launch();
  const errs = [];
  const eq = (n, what, got, want) => { if (got !== want) errs.push(`${n}: ${what}: ${got} (erwartet ${want})`); };
  let first = true;
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt);
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => m.type() === 'error' && errs.push(name + ': ' + m.text()));
    await p.goto(L.url); await p.waitForTimeout(1800);
    const open = () => p.isVisible('#newsNotice');
    if (first) {
      eq(name, 'Hinweis beim ersten Öffnen nach Update', await open(), true);
      const t = await p.textContent('#newsNotice');
      if (!/Neu in Version/.test(t) || !/Fußzeile/.test(t) || !/Alle ansehen/.test(t)) errs.push(name + ': Hinweistext unvollständig: ' + t.slice(0, 200));
      await p.screenshot({ path: `${L.SHOTS}/n-${name}-notice.png` });
      await p.click('#nnAll'); await p.waitForTimeout(500);
      eq(name, '„Alle ansehen“ öffnet die Liste', await p.isVisible('#news'), true);
      await p.screenshot({ path: `${L.SHOTS}/n-${name}-list.png` });
      await p.keyboard.press('Escape');
      first = false;
    } else eq(name, 'Hinweis nur einmal (Server merkt es sich)', await open(), false);
    eq(name, 'kein Neuigkeiten-Knopf in der Kopfzeile', await p.locator('header.top #newsBtn').count(), 0);
    await p.reload(); await p.waitForTimeout(1500);
    eq(name, 'nach Neuladen kein Hinweis', await open(), false);
    // Gewonnener Platz: Video und Audio getrennt gezählt, je Art ein Zurücksetzen-Knopf nur mit Zählung
    for (const w of ['audio', 'video']) {
      const s = await p.evaluate(w => ({txt: document.querySelector(`#savedBody .savedcol.${w}`).textContent, n: S.saved[w].count, other: S.saved[w === 'audio' ? 'video' : 'audio'].count}), w);
      if (s.n && !new RegExp(s.n + (s.n === 1 ? ' Datei' : ' Dateien')).test(s.txt)) errs.push(`${name}: ${w}: Spalte zeigt nicht die eigene Dateizahl (${s.n}): ${s.txt}`);
      if (s.n && s.other && s.other !== s.n && new RegExp(s.other + (s.other === 1 ? ' Datei' : ' Dateien')).test(s.txt)) errs.push(`${name}: ${w}: Spalte zeigt Zahlen der anderen Art`);
      eq(name, w + ': Zurücksetzen-Knopf nur mit Zählung', await p.locator(`#savedBody .savedcol.${w} .savedreset`).count(), s.n > 0 ? 1 : 0);
    }
    await p.screenshot({ path: `${L.SHOTS}/n-${name}-saved.png`, fullPage: true });
    await ctx.close();
  }
  // Zurücksetzen (nur Desktop, einmal): Audio leeren, Video bleibt
  const ctx = await b.newContext(L.views[0][1]); const p = await ctx.newPage();
  await p.goto(L.url); await p.waitForTimeout(1500);
  const before = await p.evaluate(() => ({a: S.saved.audio.count, v: S.saved.video.count}));
  if (before.a) {
    await p.click('#savedBody .savedcol.audio .savedreset'); await p.waitForTimeout(200);
    eq('desktop', 'Rückfrage sichtbar', await p.isVisible('#savedResetDlg'), true);
    await p.click('#savedResetNo'); eq('desktop', 'Abbrechen schließt', await p.isVisible('#savedResetDlg'), false);
    await p.click('#savedBody .savedcol.audio .savedreset'); await p.click('#savedResetYes'); await p.waitForTimeout(600);
    const after = await p.evaluate(() => ({a: S.saved.audio.count, v: S.saved.video.count}));
    eq('desktop', 'Audio zurückgesetzt', after.a, 0); eq('desktop', 'Video unverändert', after.v, before.v);
  } else errs.push('Testvoraussetzung: keine Audio-Statistik vorhanden');
  await b.close();
  console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'ok');
})();
