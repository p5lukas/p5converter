// Gemeinsame Helfer für die UI-Prüfungen (Chromium mit Geräte-Emulation, Prüfregel: alle Ansichten)
exports.views = [
  ['desktop', {viewport: {width: 1400, height: 1000}}],
  ['iphone-portrait', {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['iphone-landscape', {viewport: {width: 844, height: 390}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['ipad-portrait', {viewport: {width: 820, height: 1180}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['ipad-landscape', {viewport: {width: 1180, height: 820}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
];
exports.url = process.env.P5_URL || 'http://127.0.0.1:8787';
exports.SHOTS = process.env.SHOTS || '/tmp/shots';
exports.INDIR = process.env.INDIR || '/tmp/media';
// Ansichten ansteuern. Seit 0.3.2 wählt die Startseite die Art (Kacheln Video/Audio); Video läuft in vier Schritten (1 Dateien, 2 Regeln,
// 3 Wie umwandeln?, 4 Kontrolle & Start), Audio in einer Ansicht. Das Fenster „Details“ hat die früheren Schritte als Reiter (dest/video/tracks/verify).
const DTAB = {dest: 'dest', name: 'dest', video: 'video', audio: 'video', tracks: 'tracks', verify: 'verify'};
// zur Startseite (Fenster zu, Ablauf verlassen, andere Seiten schließen)
exports.home = async p => {
  if (await p.isVisible('#detailsDlg')) { await p.click('#detailsClose'); await p.waitForTimeout(200); }
  if (!(await p.isVisible('#startTiles'))) {
    if (await p.isVisible('#cvHome')) await p.click('#cvHome');
    else { await p.evaluate(() => { location.hash = ''; }); await p.waitForTimeout(300); if (await p.isVisible('#cvHome')) await p.click('#cvHome'); }
  }
  await p.waitForTimeout(200);
};
// Art wählen: Kachel Video oder Audio (Video beginnt bei Schritt 1, Audio in der einen Ansicht)
exports.enter = async (p, kind) => { await exports.home(p); await p.click(`[data-kind=${kind}]`); await p.waitForTimeout(400); };
exports.setWorld = exports.enter;
// Video: von Schritt 1 (mit Dateien) bis zur Kontrolle (Schritt 4)
exports.toCheck = async p => {
  for (let i = 0; i < 4 && !(await p.isVisible('#stepnav')); i++) { await p.click('#wizNext'); await p.waitForTimeout(700); }
  await p.waitForTimeout(400);
};
exports.goStep = async (p, id) => {
  if (id === 'start') { await exports.home(p); return; }
  if (await p.isVisible('#startTiles')) { const k = await p.evaluate(() => S.world); await p.click(`[data-kind=${k}]`); await p.waitForTimeout(400); } // von der Startseite aus: die zuletzt benutzte Art
  const open = await p.isVisible('#detailsDlg');
  if (id in DTAB) {
    if (!open) {
      if (!(await p.isVisible('#stepnav')) && (await p.locator('#fileList .file').count())) await exports.toCheck(p);
      if (await p.isVisible('#detailsBtn')) await p.click('#detailsBtn'); else await p.evaluate(t => openSheet(t), DTAB[id]); // ohne Dateien (Video, Schritt 1) gibt es keine Startleiste
      await p.waitForTimeout(250);
    }
    await p.click(`[data-dtab=${DTAB[id]}]`); await p.waitForTimeout(300);
  } else if (open) { await p.click('#detailsClose'); await p.waitForTimeout(250); }
};
// Datei im Server-Browser auswählen (im Schritt „Dateien“)
exports.addFile = async (p, name, btn = '#addFiles', add = '#bAddSel') => {
  await p.click(btn); await p.waitForTimeout(300);
  await p.fill('#bPath', exports.INDIR); await p.click('#bGo'); await p.waitForTimeout(400);
  await p.click(`#bList .bi:has-text("${name}")`); await p.click(add); await p.waitForTimeout(400);
};
exports.launch = () => require(process.env.PLAYWRIGHT_PATH || 'playwright').chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
