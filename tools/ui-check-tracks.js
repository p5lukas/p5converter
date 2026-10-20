// Prüft 0.0.9 in allen Ansichten: Schritt „Audio & Untertitel“ (Spurtabelle), „Alle auswählen/abwählen“, „Auf alle Dateien anwenden“,
// Voreinstellungen nur im Einstellungs-Schritt, „Wenn Datei existiert“-Hinweis, Alles zurücksetzen, Hardware-Kachel, keine Neuigkeiten in der Kopfzeile.
// Aufruf: INDIR=/tmp/media OUTDIR=/tmp/out SHOTS=/tmp/shots node tools/ui-check-tracks.js   (Dateien multi.mkv und multi2.mkv: je 2 Ton- und 2 Untertitelspuren)
const L = require('./ui-lib');
const { execFileSync } = require('child_process');
const fs = require('fs');
const OUTDIR = process.env.OUTDIR || '/tmp/out';
(async () => {
  const b = await L.launch();
  const errs = [];
  const eq = (n, what, got, want) => { if (got !== want) errs.push(`${n}: ${what}: ${got} (erwartet ${want})`); };
  for (const [name, opt] of L.views) {
    const ctx = await b.newContext(opt);
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => m.type() === 'error' && errs.push(name + ': ' + m.text()));
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url); await p.waitForTimeout(1200);
    const ov = async () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    eq(name, 'Neuigkeiten nicht in der Kopfzeile', await p.locator('header.top #newsBtn').count(), 0);
    eq(name, 'Neuigkeiten in der Fußzeile', await p.locator('#footNews').count(), 1);
    // Hardware-Kachel: eine Zeile je Hardware, Gründe eingeklappt
    eq(name, 'Hardware-Zeilen', (await p.locator('#hwList > .hw, #hwList > details.hwoff').count()) > 0, true);
    eq(name, 'Gründe eingeklappt', await p.locator('#hwList details[open]').count(), 0);
    await p.screenshot({ path: `${L.SHOTS}/t-${name}-0-start.png`, fullPage: true });
    await L.enter(p, 'video');
    await L.addFile(p, 'multi.mkv'); await L.addFile(p, 'multi2.mkv');
    await L.goStep(p, 'dest');
    await p.selectOption('#exists', 'overwrite'); await p.waitForTimeout(100);
    eq(name, 'Überschreiben-Hinweis in Warnfarbe', await p.evaluate(() => document.querySelector('#existsHint').classList.contains('warn')), true);
    await p.screenshot({ path: `${L.SHOTS}/t-${name}-1-dest.png` });
    await p.selectOption('#exists', 'rename');
    await L.goStep(p, 'name');
    await L.goStep(p, 'video');
    await L.goStep(p, 'tracks');
    await p.waitForSelector('.trkviews'); await p.click('.trkviews button:has-text("Einzelne Dateien")'); await p.waitForSelector('#trackEditor .trkcard');
    eq(name, 'Karten (2 Ton + 2 Untertitel)', await p.locator('#trackEditor .trkcard').count(), 4);
    if (await ov() > 0) errs.push(`${name}: Überlauf im Spuren-Schritt: ${await ov()}px`);
    await p.screenshot({ path: `${L.SHOTS}/t-${name}-2-tracks.png`, fullPage: true });
    // Alle abwählen / auswählen (Untertitel)
    const subs = p.locator('#trackEditor .trkgroup >> nth=1');
    await subs.getByText('Alle abwählen').click();
    eq(name, 'Untertitel alle abgewählt', await subs.locator('.trkcard.off').count(), 2);
    await subs.getByText('Alle auswählen').click();
    eq(name, 'Untertitel alle ausgewählt', await subs.locator('.trkcard.off').count(), 0);
    const card = i => p.locator('#trackEditor .trkcard').nth(i);
    const expand = async i => { if (!(await card(i).locator('.trkadv').count())) { await card(i).locator('.trkmore').click(); await p.waitForTimeout(150); } };
    // Titel der 1. Tonspur, 2. Tonspur automatisch, 1. Untertitel Forced (alles unter „Erweitert“)
    await expand(0); await card(0).locator('.trkadv input:not([type])').first().fill('Deutsch Stereo'); await card(0).locator('.trkadv input:not([type])').first().dispatchEvent('change'); await p.waitForTimeout(200);
    await expand(1); await card(1).locator('.trkadv input[type=radio]').check(); await p.waitForTimeout(200);
    await expand(2); await card(2).locator('.trkadv input[type=checkbox]').first().check(); await p.waitForTimeout(200);
    eq(name, 'bearbeitete Karten markiert', await p.locator('#trackEditor .trkcard.edited').count() >= 3, true);
    // Neu kodieren: Empfehlung und Zielbitrate sichtbar
    await card(1).locator('.trk-act').selectOption('encode'); await p.waitForTimeout(250);
    if (!/Ergebnis für diese Spur: 160 kbit\/s/.test(await card(1).textContent())) errs.push(name + ': Zielbitrate fehlt: ' + (await card(1).textContent()).slice(0, 300));
    await card(1).locator('.trk-act').selectOption(''); await p.waitForTimeout(250);
    await p.screenshot({ path: `${L.SHOTS}/t-${name}-3-edited.png`, fullPage: true });
    await p.getByText('Auf alle Dateien anwenden').click(); await p.waitForTimeout(800);
    await p.selectOption('#trkFile', '1'); await p.waitForTimeout(400);
    eq(name, 'Änderungen auf 2. Datei übertragen', await p.locator('#trackEditor .trkcard.edited').count() >= 3, true);
    // Zusammenfassung nennt die Änderung
    await L.goStep(p, 'summary');
    await p.waitForTimeout(600); await p.click('#cvFileDetails summary'); await p.waitForTimeout(200);
    eq(name, 'beide Dateien melden geänderte Spuren', await p.locator('#fileList [data-tr]').count(), 2);
    // nur Desktop: wirklich konvertieren und das Ergebnis prüfen
    if (name === 'desktop') {
      await L.goStep(p, 'dest'); await p.selectOption('#outMode', 'custom'); await p.fill('#outDir', OUTDIR + '/tracks');
      await p.selectOption('#exists', 'overwrite');
      await L.goStep(p, 'summary'); await p.click('#start'); await p.waitForTimeout(6000);
      const f = OUTDIR + '/tracks/multi.mkv';
      if (!fs.existsSync(f)) errs.push('Ergebnisdatei fehlt');
      else {
        const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', f]).toString());
        const a = j.streams.filter(s => s.codec_type === 'audio'), s = j.streams.filter(s => s.codec_type === 'subtitle');
        eq(name, 'Ergebnis: Titel Audio 1', a[0].tags.title, 'Deutsch Stereo');
        eq(name, 'Ergebnis: Standard-Ton ist Spur 2', a[1].disposition.default, 1);
        eq(name, 'Ergebnis: Ton 1 nicht Standard', a[0].disposition.default, 0);
        eq(name, 'Ergebnis: Untertitel 1 forced', s[0].disposition.forced, 1);
      }
    }
    // Assistent: Datei mit mehreren Sprachen und einem Forced-Untertitel ohne Markierung
    await L.goStep(p, 'files'); await p.click('#clearFiles'); await L.addFile(p, 'hint.mkv'); await L.goStep(p, 'tracks'); await p.waitForSelector('.trkviews'); await p.click('.trkviews button:has-text("Einzelne Dateien")'); await p.waitForSelector('#trackEditor .trkcard');
    const hintTxt = await p.textContent('#trackEditor .trkhints');
    if (!/Nur Deutsch und Englisch behalten/.test(hintTxt) || !/Als Forced markieren/.test(hintTxt)) errs.push(name + ': Assistent-Hinweise fehlen: ' + hintTxt);
    await p.screenshot({ path: `${L.SHOTS}/t-${name}-3b-hints.png`, fullPage: true });
    await p.getByRole('button', { name: 'Als Forced markieren' }).click(); await p.waitForTimeout(300);
    eq(name, 'Forced-Hinweis erledigt', /Als Forced markieren/.test(await p.textContent('#trackEditor')), false);
    while (await p.getByRole('button', { name: 'Nur Deutsch und Englisch behalten' }).count()) { await p.getByRole('button', { name: 'Nur Deutsch und Englisch behalten' }).first().click(); await p.waitForTimeout(300); }
    eq(name, 'Fremdsprachen entfernt (1 Ton + 2 Untertitel)', await p.locator('#trackEditor .trkcard.off').count(), 3);
    await L.goStep(p, 'files'); await p.click('#clearFiles'); await L.addFile(p, 'long.mkv');
    // Alles zurücksetzen
    await p.click('#resetAll'); await p.waitForTimeout(250);
    eq(name, 'Rücksetz-Dialog offen', await p.isVisible('#resetDlg'), true);
    await p.screenshot({ path: `${L.SHOTS}/t-${name}-4-reset.png` });
    await p.click('#resetNo'); await p.waitForTimeout(150);
    eq(name, 'Abbrechen schließt', await p.isVisible('#resetDlg'), false);
    await p.click('#resetAll'); await p.click('#resetYes'); await p.waitForTimeout(400);
    eq(name, 'nach Zurücksetzen: Startseite', await p.evaluate(() => S.step), 'start');
    eq(name, 'nach Zurücksetzen: keine Dateien', await p.evaluate(() => S.files.video.length), 0);
    eq(name, 'nach Zurücksetzen: Remux', await p.inputValue('#vCodec'), 'copy');
    eq(name, 'nach Zurücksetzen: MKV', await p.inputValue('#vContainer'), 'mkv');
    eq(name, 'nach Zurücksetzen: Ton unverändert', await p.inputValue('#vAudioMode'), 'copy');
    await ctx.close();
  }
  await b.close();
  console.log(errs.length ? 'FEHLER:\n' + errs.join('\n') : 'ok');
})();
