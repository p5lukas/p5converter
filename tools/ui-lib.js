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
// Ansichten ansteuern. Seit 0.4.0: Die Startseite wählt die Art (Kacheln Video/Audio) oder eine Video-Voreinstellung; Video hat zwei Schritte (1 Dateien,
// 2 Konvertieren), Audio eine Ansicht. Es gibt kein Fenster „Details“ mehr: alles steht in Karten auf der Konvertieren-Seite, die sich an Ort und Stelle aufklappen
// (Video, Ton, Untertitel, Regeln, Name & Ziel, Prüfen).
const CARD = {dest: 'name', name: 'name', video: 'video', audio: 'video', tracks: 'audio', subs: 'subs', rules: 'rules', verify: 'check', check: 'check'};
// zur Startseite (Ablauf verlassen, andere Seiten schließen)
exports.home = async p => {
  if (!(await p.isVisible('#startTiles'))) {
    if (await p.isVisible('#cvHome')) await p.click('#cvHome');
    else { await p.evaluate(() => { location.hash = ''; }); await p.waitForTimeout(300); if (await p.isVisible('#cvHome')) await p.click('#cvHome'); }
  }
  await p.waitForTimeout(200);
};
// Art wählen: Kachel Video oder Audio (Video beginnt bei Schritt 1, Audio in der einen Ansicht)
exports.enter = async (p, kind) => { await exports.home(p); await p.click(`[data-kind=${kind}]`); await p.waitForTimeout(400); };
exports.setWorld = exports.enter;
// Video: von Schritt 1 (mit Dateien) zur Konvertieren-Seite (Schritt 2)
exports.toCheck = async p => {
  for (let i = 0; i < 2 && !(await p.isVisible('#stepnav')); i++) { await p.click('#wizNext'); await p.waitForTimeout(700); }
  await p.waitForTimeout(400);
};
// eine Karte der Konvertieren-Seite aufklappen (id: video, audio, subs, rules, name, check oder die alten Namen dest/tracks/verify)
exports.openCard = async (p, id) => {
  const c = CARD[id] || id;
  await p.evaluate(x => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); CV.card[x] = true; cvRender(); }, c); await p.waitForTimeout(500);
  return p.locator(`[data-card="${c}"]`);
};
exports.goStep = async (p, id) => {
  if (id === 'start') { await exports.home(p); return; }
  if (await p.isVisible('#startTiles')) { const k = await p.evaluate(() => S.world); await p.click(`[data-kind=${k}]`); await p.waitForTimeout(400); } // von der Startseite aus: die zuletzt benutzte Art
  if (id in CARD) {
    if (!(await p.isVisible('#stepnav')) && (await p.locator('#fileList .file').count())) await exports.toCheck(p);
    if (await p.isVisible('#stepnav')) await exports.openCard(p, id);
  }
};
// Datei im Server-Browser auswählen (im Schritt „Dateien“)
exports.addFile = async (p, name, btn = '#addFiles', add = '#bAddSel') => {
  await p.click(btn); await p.waitForTimeout(300);
  await p.fill('#bPath', exports.INDIR); await p.click('#bGo'); await p.waitForTimeout(400);
  await p.click(`#bList .bi:has-text("${name}")`); await p.click(add); await p.waitForTimeout(400);
};
exports.launch = () => require(process.env.PLAYWRIGHT_PATH || 'playwright').chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
