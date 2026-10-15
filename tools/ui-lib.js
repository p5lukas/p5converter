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
// Reiter des Ablaufs anklicken (Start, files, dest, name, video/audio, tracks, summary)
exports.goStep = async (p, id) => { await p.click(`[data-step-btn=${id}]`); await p.waitForTimeout(250); };
exports.setWorld = async (p, w) => { await p.click(`[data-world=${w}]`); await p.waitForTimeout(1300); };
// Datei im Server-Browser auswählen (im Schritt „Dateien“)
exports.addFile = async (p, name, btn = '#addFiles', add = '#bAddSel') => {
  await p.click(btn); await p.waitForTimeout(300);
  await p.fill('#bPath', exports.INDIR); await p.click('#bGo'); await p.waitForTimeout(400);
  await p.click(`#bList .bi:has-text("${name}")`); await p.click(add); await p.waitForTimeout(400);
};
exports.launch = () => require(process.env.PLAYWRIGHT_PATH || 'playwright').chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
