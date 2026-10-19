// Prüft: Ersetzungen (hinzufügen/löschen/alle löschen/neu hinzufügen), Audio/Video getrennt, Warteschlange je Welt,
// Auslastungsanzeige – in allen Ansichten. Aufruf: INDIR=/tmp/media SHOTS=/tmp/shots node tools/ui-check-world.js (Server auf :8787;
// vorher je einen Audio- und einen Video-Auftrag einreihen)
const L = require('./ui-lib');
(async () => {
  const b = await L.launch();
  const errs = [];
  const eq = (name, what, got, want) => { if (got !== want) errs.push(`${name}: ${what}: ${got} (erwartet ${want})`); };
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt);
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => m.type() === 'error' && errs.push(name + ': ' + m.text()));
    await p.goto(L.url); await p.waitForTimeout(1200);
    const rows = () => p.locator('#ruleRows .rulerow').count();
    // --- Video: drei Ersetzungen, alle löschen, eine neu ---
    await L.setWorld(p, 'video'); await L.goStep(p, 'name');
    for (let i = 0; i < 3; i++) { await p.click('#addRule'); await p.fill(`#ruleRows .rulerow >> nth=${i} >> input >> nth=0`, 'v' + i); }
    eq(name, 'Video: 3 Zeilen', await rows(), 3);
    while (await rows()) await p.click('#ruleRows .rulerow >> nth=0 >> button');
    eq(name, 'Video: alle gelöscht', await rows(), 0);
    await p.click('#addRule');
    eq(name, 'Video: nach Neu-Hinzufügen genau 1 Zeile (kein Wiederauftauchen)', await rows(), 1);
    eq(name, 'Video: Feld leer', await p.inputValue('#ruleRows .rulerow input >> nth=0'), '');
    await p.fill('#ruleRows .rulerow input >> nth=0', 'nurvideo'); await p.fill('#pattern', '{res}');
    // --- Audio ist unabhängig ---
    await L.setWorld(p, 'audio'); await L.goStep(p, 'name');
    eq(name, 'Audio: keine Ersetzungen aus Video', await rows(), 0);
    eq(name, 'Audio: Muster getrennt', await p.inputValue('#pattern'), '');
    await p.click('#addRule'); await p.fill('#ruleRows .rulerow input >> nth=0', 'nuraudio'); await p.fill('#pattern', '{artist}');
    await L.setWorld(p, 'video'); await L.goStep(p, 'name');
    eq(name, 'Video: zurück, 1 Zeile', await rows(), 1);
    eq(name, 'Video: Wert erhalten', await p.inputValue('#ruleRows .rulerow input >> nth=0'), 'nurvideo');
    eq(name, 'Video: Muster erhalten', await p.inputValue('#pattern'), '{res}');
    // Neuladen: Zustand bleibt je Welt
    await p.reload(); await p.waitForTimeout(1500); await L.goStep(p, 'name');
    eq(name, 'nach Neuladen (Video) 1 Zeile', await rows(), 1);
    await L.setWorld(p, 'audio'); await L.goStep(p, 'name');
    eq(name, 'nach Neuladen (Audio) Wert', await p.inputValue('#ruleRows .rulerow input >> nth=0'), 'nuraudio');
    // --- Verlauf je Welt (Seite „Verlauf“, Welten strikt getrennt) ---
    // je Welt ein kurzer Auftrag, damit beide Verläufe Einträge haben (unabhängig vom Zustand des Servers)
    await p.evaluate(async ([indir, out]) => {
      const post = b => fetch('/api/jobs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)});
      const o = {dir: out, structure: 'flat', exists: 'overwrite'};
      await post({kind: 'audio', items: [{path: indir + '/a.mp3'}], output: o, audio: {format: 'flac'}});
      await post({kind: 'video', items: [{path: indir + '/hint.mkv'}], output: o, video: {container: 'mkv', codec: 'copy'}});
    }, [L.INDIR, (process.env.OUTDIR || '/tmp/out') + '/world']);
    await p.waitForTimeout(3500);
    await L.goStep(p, 'start');
    await p.click('#startHistory'); await p.waitForTimeout(1000);
    const listed = async () => (await p.locator('.histentry').allTextContents()).join('|');
    const aq = await listed();
    if (/long\.mkv|Show/.test(aq)) errs.push(name + ': Audio-Verlauf zeigt Video-Aufträge: ' + aq);
    if (!(await p.locator('.histentry').count())) errs.push(name + ': Audio-Verlauf leer');
    await p.click('[data-world=video]'); await p.waitForTimeout(3800);
    const vq = await listed();
    if (/a\.mp3/.test(vq)) errs.push(name + ': Video-Verlauf zeigt Audio-Aufträge: ' + vq);
    await p.screenshot({ path: `${L.SHOTS}/wd-${name}-history.png`, fullPage: true });
    await p.click('#histBack'); await p.waitForTimeout(500);
    if (!(await p.locator('#monitor .meter').count())) errs.push(name + ': keine Auslastungsanzeige');
    await ctx.close();
  }
  await b.close();
  console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'ok');
})();
