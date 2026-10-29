// Prüft in allen Ansichten: Startseite (Neuigkeiten in der Fußzeile, Hardware eingeklappt), Name & Ziel („Wenn Datei existiert“-Hinweis, Namensliste nur beim Umbenennen),
// Ton und Untertitel in den Karten der Konvertieren-Seite (Titel, Standard, Forced, Umwandeln mit Zielbitrate; eine Änderung gilt für alle Dateien der Gruppe),
// „N Spuren geändert“ in der Dateiliste, ein echter Lauf mit Ergebnisprüfung, Alles zurücksetzen.
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
    // Hardware (eingeklappt; Aufklappen zeigt eine Zeile je Hardware, Gründe bleiben eingeklappt)
    eq(name, 'Hardware eingeklappt', await p.evaluate(() => document.querySelector('#hwCard').open), false);
    await p.click('#hwCard summary'); await p.waitForTimeout(200);
    eq(name, 'Hardware-Zeilen', (await p.locator('#hwList > .hw, #hwList > details.hwoff').count()) > 0, true);
    eq(name, 'Gründe eingeklappt', await p.locator('#hwList details[open]').count(), 0);
    await p.screenshot({ path: `${L.SHOTS}/t-${name}-0-start.png`, fullPage: true });
    await p.click('#hwCard summary');
    await L.enter(p, 'video');
    await L.addFile(p, 'multi.mkv'); await L.addFile(p, 'multi2.mkv');
    const row = lbl => p.locator('.cvgrid .cvr', {has: p.locator('.cvk', {hasText: new RegExp('^' + lbl + '\\s*i?$', 'i')})});
    await L.toCheck(p); await p.waitForTimeout(1500);
    const nc = await L.openCard(p, 'name');
    await nc.locator('.pill:has-text("Überschreiben")').click(); await p.waitForTimeout(200);
    eq(name, 'Überschreiben-Hinweis in Warnfarbe', await p.evaluate(() => !!document.querySelector('[data-card=name] .tgrp .small.warn')), true);
    await p.screenshot({ path: `${L.SHOTS}/t-${name}-1-dest.png`, fullPage: true });
    await nc.locator('.pill:has-text("Beide behalten")').click(); await p.waitForTimeout(200);
    // Namensliste: nur wenn umbenannt wird, dann alle Dateien einzeilig („alt → neu“)
    eq(name, 'ohne Umbenennen keine Namensliste', await p.locator('.cvnamelist').count(), 0);
    await p.evaluate(() => cvSet('pattern', '{filename} [X]')); await p.evaluate(() => cvRender()); await p.waitForSelector('.cvnamelist .cvnl', {timeout: 8000}); await p.waitForTimeout(500);
    eq(name, 'Namensliste: eine Zeile je Datei (2)', await p.locator('.cvnamelist .cvnl').count(), 2);
    const nl = (await p.locator('.cvnamelist').textContent()).replace(/\s+/g, ' ');
    if (!/multi\.mkv.*multi \[X\]\.mkv/.test(nl) || !/multi2\.mkv.*multi2 \[X\]\.mkv/.test(nl)) errs.push(name + ': Namensliste „alt → neu“ unerwartet: ' + nl);
    eq(name, 'Namensliste einzeilig (Ellipse, keine Umbrüche)', await p.evaluate(() => [...document.querySelectorAll('.cvnamelist .cvnl')].every(r => r.getBoundingClientRect().height < 40)), true);
    if (await ov() > 0) errs.push(`${name}: Überlauf mit Namensliste: ${await ov()}px`);
    await p.screenshot({ path: `${L.SHOTS}/t-${name}-1b-namensliste.png`, fullPage: true });
    await p.fill('#pattern', ''); await p.locator('#pattern').dispatchEvent('change'); await p.waitForTimeout(500);
    // Ton und Untertitel: beide Karten aufklappen; eine Änderung gilt für beide Dateien (eine Gruppe)
    await L.openCard(p, 'tracks'); await L.openCard(p, 'subs'); await p.waitForTimeout(500);
    eq(name, 'Zeilen (2 Ton + 2 Untertitel)', (await row('Ton 1').count()) + (await row('Ton 2').count()) + (await row('Untertitel 1').count()) + (await row('Untertitel 2').count()), 4);
    if (await ov() > 0) errs.push(`${name}: Überlauf in der Spurenansicht: ${await ov()}px`);
    await p.screenshot({ path: `${L.SHOTS}/t-${name}-2-tracks.png`, fullPage: true });
    // Untertitel alle entfernen / wieder behalten (Zeile „Alle Untertitel“ gilt für Spuren ohne eigene Entscheidung)
    await L.openCard(p, 'subs');
    await p.selectOption('.cvgrid select[aria-label="Alle Untertitel"]', 'none'); await p.waitForTimeout(400);
    eq(name, 'Untertitel alle entfernt', await p.locator('[data-card=subs] .cvr.dropped').count(), 2);
    await p.selectOption('.cvgrid select[aria-label="Alle Untertitel"]', 'copy'); await p.waitForTimeout(400);
    eq(name, 'Untertitel wieder alle behalten', await p.locator('[data-card=subs] .cvr.dropped').count(), 0);
    // Titel der 1. Tonspur („⋯“), 2. Tonspur Standard, 1. Untertitel Forced
    await L.openCard(p, 'tracks');
    await row('Ton 1').locator('.cvmore').click(); await p.waitForTimeout(300);
    await row('Ton 1').locator('.cved input').first().fill('Deutsch Stereo'); await p.keyboard.press('Tab'); await p.waitForTimeout(500);
    await row('Ton 1').locator('.cvmore').click(); await p.waitForTimeout(200);
    const stdBtn = n => row('Ton ' + n).locator('.cvflag:has-text("Standard")');
    if (!(await stdBtn(2).evaluate(e => e.classList.contains('on')))) { await stdBtn(2).click(); await p.waitForTimeout(400); }
    eq(name, 'Ton 2 ist Standard', await stdBtn(2).evaluate(e => e.classList.contains('on')), true);
    await row('Untertitel 1').locator('.cvflag:has-text("Forced")').click(); await p.waitForTimeout(400);
    eq(name, 'Untertitel 1 Forced', await row('Untertitel 1').locator('.cvflag.on:has-text("Forced")').count(), 1);
    // Neu kodieren: Zielformat mit Bitrate sichtbar
    await row('Ton 2').locator('select.cvact').selectOption('encode'); await p.waitForTimeout(400);
    if (!/160 kbit\/s/.test(await row('Ton 2').locator('.cvenc').textContent())) errs.push(name + ': Zielbitrate fehlt: ' + (await row('Ton 2').textContent()).slice(0, 300));
    await row('Ton 2').locator('select.cvact').selectOption('copy'); await p.waitForTimeout(400);
    await p.screenshot({ path: `${L.SHOTS}/t-${name}-3-edited.png`, fullPage: true });
    eq(name, 'Änderungen gelten für beide Dateien der Gruppe', await p.evaluate(() => S.files.video.map(f => Object.keys(f.tracks || {}).length >= 3).join()), 'true,true');
    // Dateiliste: beide Dateien melden geänderte Spuren
    await p.click('#cvStepper [data-step=files]'); await p.waitForTimeout(600); await p.click('#cvFileDetails summary'); await p.waitForTimeout(200);
    eq(name, 'beide Dateien melden geänderte Spuren', await p.locator('#fileList [data-tr]').count(), 2);
    await L.toCheck(p); await p.waitForTimeout(800);
    // nur Desktop: wirklich konvertieren und das Ergebnis prüfen
    if (name === 'desktop') {
      const nc2 = await L.openCard(p, 'name');
      await nc2.locator('.pill:has-text("Eigener Ordner")').click(); await p.waitForTimeout(300);
      await nc2.locator('input[aria-label="Zielordner"]').fill(OUTDIR + '/tracks'); await nc2.locator('input[aria-label="Zielordner"]').press('Enter'); await p.waitForTimeout(300);
      await nc2.locator('.pill:has-text("Überschreiben")').click(); await p.waitForTimeout(300);
      await p.click('#start'); await p.waitForTimeout(6000);
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
    if (!(await p.isVisible('#cvStepper'))) await L.enter(p, 'video'); // nach „Starten“ steht die Startseite da
    await p.click('#cvStepper [data-step=files]'); await p.waitForTimeout(300); await p.click('#clearFiles'); await L.addFile(p, 'long.mkv'); await L.toCheck(p);
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
