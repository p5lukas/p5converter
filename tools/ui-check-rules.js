// Prüfregel: Einstellungen → „Regeln“ (allgemeine Regeln auf dem Server) und ihre Wirkung im Ablauf: die Karte „Regeln“ der Konvertieren-Seite zeigt sie als
// voreingestellte Regeln (Haken je Regel, „betrifft N Dateien“), die Ton-Karte wendet sie an (✦), abgewählt wirken sie nicht und der Vorschlag steht in der Ton-Karte; in allen Ansichten.
// Voraussetzung: INDIR enthält ep01.mkv … ep06.mkv (ep01–05: Ton ger (DTS)/eng/fre, ep06 nur eng). Aufruf: INDIR=/tmp/season SHOTS=/tmp/shots node tools/ui-check-rules.js
const L = require('./ui-lib.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const settings = async () => (await (await fetch(L.url + '/api/settings')).json()).settings;
const putSettings = async mut => { const s = await settings(); mut(s); await fetch(L.url + '/api/settings', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(s)}); };
(async () => {
  const b = await L.launch();
  for (const [name, opt] of [L.views[0], L.views[1], L.views[4]]) {
    await putSettings(s => { s.trackRules = {audio: [], sub: []}; s.trackPrefs = {audioKeep: [], subKeep: [], audioDefault: [], subDefault: []}; });
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    const ov = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const row = lbl => p.locator('.cvgrid .cvr', {has: p.locator('.cvk', {hasText: new RegExp('^' + lbl + '\\s*i?$', 'i')})});
    await p.goto(L.url); await p.evaluate(() => localStorage.clear()); await p.goto(L.url + '/#settings/rules'); await p.waitForTimeout(1400);

    // ---- Seite „Regeln“ in den Einstellungen ----
    ok(await p.locator('#viewSettings h2:has-text("Regeln")').count() >= 1, name + ': Seite „Regeln“ fehlt');
    ok(/Noch keine Regel/.test(await p.textContent('#viewSettings')), name + ': leerer Zustand fehlt');
    await p.click('#viewSettings button:has-text("+ Regel für Ton")'); await p.waitForTimeout(700);
    ok(await p.locator('#viewSettings .trkrule').count() === 1, name + ': Regelzeile fehlt');
    let s = await settings();
    ok(s.trackRules.audio.length === 1 && s.trackRules.audio[0].codec === 'dts' && s.trackRules.audio[0].to === 'eac3' && s.trackRules.audio[0].kbps === 256, name + ': Regel nicht auf dem Server gespeichert: ' + JSON.stringify(s.trackRules));
    ok(/gedeckelt/.test(await p.textContent('#viewSettings .trkrule')), name + ': Hinweis auf den 640er-Deckel fehlt');
    // Untertitel-Regeln gibt es nicht mehr (0.3.6): kein Knopf, kein Abschnitt; eine früher gespeicherte Regel wird ignoriert, aber nicht gelöscht
    ok(await p.locator('#viewSettings button:has-text("Regel für Untertitel")').count() === 0 && await p.locator('#viewSettings h4:has-text("Untertitel")').count() === 0, name + ': die Seite „Regeln“ bietet noch Untertitel-Regeln an');
    await putSettings(x => { x.trackRules.sub = [{kind: 'image', action: 'drop'}]; });
    await p.reload(); await p.waitForTimeout(1300);
    ok(await p.locator('#viewSettings .trkrule').count() === 1 && !/Bild-Untertitel/.test(await p.textContent('#viewSettings')), name + ': eine gespeicherte Untertitel-Regel darf nicht angezeigt werden');
    await p.click('#viewSettings button:has-text("+ Regel für Ton")'); await p.waitForTimeout(700);
    ok((await settings()).trackRules.sub.length === 1 && (await settings()).trackRules.audio.length === 2, name + ': die gespeicherte Untertitel-Regel muss beim Speichern erhalten bleiben: ' + JSON.stringify((await settings()).trackRules));
    await p.locator('#viewSettings .trkrule').nth(1).locator('button[title="Regel entfernen"]').click(); await p.waitForTimeout(600);
    ok((await settings()).trackRules.audio.length === 1, name + ': Ton-Regel nicht entfernt');
    ok(await ov() <= 0, name + ': Überlauf auf der Seite „Regeln“ ' + await ov() + 'px');
    await p.screenshot({path: `${L.SHOTS}/p5c-rules-${name}-1-seite.png`, fullPage: true});
    await p.reload(); await p.waitForTimeout(1300);
    ok(await p.locator('#viewSettings .trkrule').count() === 1, name + ': Regel nach Neuladen weg');

    // ---- Wirkung im Ablauf ----
    await p.evaluate(() => { location.hash = ''; }); await p.waitForTimeout(400);
    await L.enter(p, 'video');
    await p.click('#addFiles'); await p.waitForTimeout(300);
    await p.fill('#bPath', L.INDIR); await p.click('#bGo'); await p.waitForTimeout(500);
    await p.click('#bAll'); await p.click('#bAddSel'); await p.waitForTimeout(800);
    await L.toCheck(p); await p.waitForTimeout(1800);
    const rules = await L.openCard(p, 'rules');
    ok(await rules.locator('.trkgrule').count() === 1, name + ': voreingestellte Regel fehlt in der Karte „Regeln“');
    const gtxt = (await rules.textContent()).replace(/\s+/g, ' ');
    ok(/DTS .*E-AC-3/.test(gtxt) && /betrifft 5 Dateien/.test(gtxt), name + ': Regeltext/Zähler: ' + gtxt);
    ok(await rules.locator('.trkgrule input').isChecked(), name + ': Haken sollte gesetzt sein');
    ok(await p.locator('[data-card=audio] .trkhints').count() === 0, name + ': Vorschlag DTS trotz vorhandener Regel');
    ok(/1 Regel aktiv/.test(await p.textContent('[data-card=rules] .cvsum')) || await rules.locator('.trkgrule').count() === 1, name + ': Kurzfassung der Karte „Regeln“');
    await p.screenshot({path: `${L.SHOTS}/p5c-rules-${name}-2-regeln.png`, fullPage: true});
    ok(await row('Ton 1').locator('select.cvact').inputValue() === 'encode', name + ': Ton 1 sollte durch die allgemeine Regel umgewandelt werden');
    ok(/E-AC-3 \(Dolby Digital Plus\) Mono · 256 kbit\/s/.test(await row('Ton 1').textContent()), name + ': Ziel fehlt: ' + await row('Ton 1').textContent());
    ok(await row('Ton 1').locator('.cvai').count() === 1, name + ': ✦ „Automatisch“ fehlt');
    // abwählen (nur dieser Lauf)
    await rules.locator('.trkgrule input').uncheck(); await p.waitForTimeout(700);
    ok(/betrifft 5 Dateien/.test(await p.textContent('[data-card=rules]')) && await p.locator('[data-card=rules] .trkgrule.off').count() === 1, name + ': abgewählte Regel nicht als aus markiert');
    ok(await p.locator('[data-card=audio] .trkhints').count() === 1, name + ': nach dem Abwählen sollte der Vorschlag in der Ton-Karte wieder erscheinen');
    ok(/1 Vorschlag/.test(await p.textContent('[data-card=audio] .cvsum')), name + ': Vorschlag in der Kurzfassung der Ton-Karte');
    ok(await row('Ton 1').locator('select.cvact').inputValue() === 'copy', name + ': abgewählte Regel wirkt trotzdem');
    ok((await settings()).trackRules.audio.length === 1, name + ': Abwählen darf die gespeicherte Regel nicht ändern');
    // wieder anwählen
    await p.locator('[data-card=rules] .trkgrule input').check(); await p.waitForTimeout(700);
    ok(await row('Ton 1').locator('select.cvact').inputValue() === 'encode', name + ': wieder angewählt, Regel sollte wirken');
    await p.screenshot({path: `${L.SHOTS}/p5c-rules-${name}-3-kontrolle.png`, fullPage: true});
    // Voreinstellung speichert die Abwahl mit (off) – Schlüssel der Regel
    const key = await p.evaluate(() => trkGlobalList()[0].key);
    ok(/^a\/dts\/any\/encode\/eac3\/256$/.test(key), name + ': Schlüssel der Regel: ' + key);
    await ctx.close();
  }
  await putSettings(s => { s.trackRules = {audio: [], sub: []}; });
  await b.close();
  console.log(fails.length ? 'FEHLER:\n' + fails.join('\n') : 'ok');
  process.exit(fails.length ? 1 : 0);
})();
