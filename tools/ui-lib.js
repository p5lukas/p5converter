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
// Ansichten ansteuern. Seit 0.3.0 gibt es keine Schritte mehr, sondern eine Ansicht „Konvertieren“ plus das Fenster „Details“ mit den
// früheren Schritten als Reiter. Die alten Namen bleiben: files/summary = Hauptansicht, dest/name/video/audio/tracks = Reiter in „Details“.
const DTAB = {dest: 'dest', name: 'dest', video: 'video', audio: 'video', tracks: 'tracks', verify: 'verify'};
exports.goStep = async (p, id) => {
  if (id === 'start') { if (await p.isVisible('#detailsDlg')) await p.click('#detailsClose'); if (await p.isVisible('#convertView')) await p.click('#cvHome'); await p.waitForTimeout(200); return; }
  if (!(await p.isVisible('#convertView'))) { await p.click('#startFlow'); await p.waitForTimeout(300); }
  const open = await p.isVisible('#detailsDlg');
  if (id in DTAB) {
    if (!open) { await p.click('#detailsBtn'); await p.waitForTimeout(250); }
    await p.click(`[data-dtab=${DTAB[id]}]`); await p.waitForTimeout(300);
  } else if (open) { await p.click('#detailsClose'); await p.waitForTimeout(250); }
};
exports.setWorld = async (p, w) => { if (await p.isVisible('#detailsDlg')) { await p.click('#detailsClose'); await p.waitForTimeout(200); } await p.click(`[data-world=${w}]`); await p.waitForTimeout(1300); };
// Datei im Server-Browser auswählen (im Schritt „Dateien“)
exports.addFile = async (p, name, btn = '#addFiles', add = '#bAddSel') => {
  await p.click(btn); await p.waitForTimeout(300);
  await p.fill('#bPath', exports.INDIR); await p.click('#bGo'); await p.waitForTimeout(400);
  await p.click(`#bList .bi:has-text("${name}")`); await p.click(add); await p.waitForTimeout(400);
};
exports.launch = () => require(process.env.PLAYWRIGHT_PATH || 'playwright').chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
