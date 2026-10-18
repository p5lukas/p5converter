// Prüfregel: Einstellungen, Voreinstellungen, Welten/Farben und Anmeldung in allen Ansichten (Desktop, iPhone, iPad; hoch/quer).
// Aufruf (Server mit leerem Konfigurationsordner starten): SHOTS=/tmp/shots node tools/ui-check-settings.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.env.P5_URL || 'http://127.0.0.1:8787', SH = (process.env.SHOTS || '/tmp') + '/p5c-set-';
const views = [
  ['desktop', {viewport: {width: 1400, height: 1000}}],
  ['iphone-portrait', {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['iphone-landscape', {viewport: {width: 844, height: 390}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['ipad-portrait', {viewport: {width: 820, height: 1180}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
  ['ipad-landscape', {viewport: {width: 1180, height: 820}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
];
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const [name, opt] of views) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    p.on('console', m => m.type() === 'error' && !/401|Anmeldung/.test(m.text()) && fails.push(name + ' console: ' + m.text()));
    await p.goto(BASE); await p.waitForTimeout(1300);
    await p.click('[data-world=video]'); await p.waitForTimeout(1800);
    await p.screenshot({ path: `${SH}${name}-main.png`, fullPage: true });
    const mobile = opt.viewport.width <= 700;
    await p.click('#gearBtn'); await p.waitForTimeout(500);
    if (mobile) await p.screenshot({ path: `${SH}${name}-set-list.png`, fullPage: true });
    for (const g of ['general', 'worlds', 'presets', 'hardware', 'auth', 'about']) {
      await p.evaluate(g => { location.hash = '#settings/' + g; }, g); await p.waitForTimeout(400);
      await p.screenshot({ path: `${SH}${name}-set-${g}.png`, fullPage: true });
      const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(ov <= 0, `${name}/${g}: horizontaler Überlauf ${ov}px`);
    }
    await ctx.close();
  }
  // Testvoreinstellungen früherer Läufe entfernen (der Test legt „Mein Test …“ an und soll wiederholbar sein)
  const cleanTestPresets = async () => {
    const cur = (await (await fetch(BASE + '/api/settings')).json()).settings;
    cur.presets = cur.presets.filter(x => !x.name.startsWith('Mein Test '));
    await fetch(BASE + '/api/settings', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(cur)});
  };
  await cleanTestPresets();
  // ---------- Abläufe (Desktop + iPhone) ----------
  for (const [name, opt] of [views[0], views[1]]) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    await p.goto(BASE); await p.waitForTimeout(1200);
    await p.click('[data-world=video]'); await p.waitForTimeout(1800);
    // Voreinstellung speichern
    await p.click('#startFlow'); await p.waitForTimeout(300); await p.click('[data-step-btn=video]'); await p.waitForTimeout(250);
    await p.selectOption('#vCodec', 'hevc'); await p.selectOption('#vDepth', '10'); await p.fill('#vCrf', '19');
    await p.evaluate(() => { const e = document.querySelector('#vCrf'); e.value = 19; e.dispatchEvent(new Event('input', {bubbles: true})); });
    await p.click('[data-step-btn=summary]'); await p.waitForTimeout(250);
    await p.click('#savePreset'); await p.waitForTimeout(300);
    await p.fill('#presetName', 'Mein Test ' + name); await p.click('#presetSave'); await p.waitForTimeout(600);
    ok(await p.locator('#vPresets button', {hasText: 'Mein Test ' + name}).count() === 1, name + ': Chip der neuen Voreinstellung fehlt');
    // zurücksetzen und per Chip laden
    await p.click('[data-step-btn=video]'); await p.waitForTimeout(250);
    await p.selectOption('#vCodec', 'h264'); await p.selectOption('#vDepth', '8');
    await p.click('#vPresets button:has-text("Mein Test ' + name + '")'); await p.waitForTimeout(300);
    ok((await p.inputValue('#vCodec')) === 'hevc' && (await p.inputValue('#vDepth')) === '10', name + ': Voreinstellung wurde nicht angewendet');
    // Reload: kommt vom Server
    await p.reload(); await p.waitForTimeout(1500);
    await p.click('[data-world=video]'); await p.waitForTimeout(1500);
    ok(await p.locator('#vPresets button', {hasText: 'Mein Test ' + name}).count() === 1, name + ': Voreinstellung nach Reload weg');
    // bearbeiten
    await p.click('#gearBtn'); await p.waitForTimeout(300);
    await p.evaluate(() => { location.hash = '#settings/presets'; }); await p.waitForTimeout(500);
    await p.click('.prow:has(input[value="Mein Test ' + name + '"]) button:has-text("Werte")'); await p.waitForTimeout(600);
    ok(await p.locator('#editBanner').isVisible(), name + ': Bearbeiten-Banner fehlt');
    await p.evaluate(() => { const e = document.querySelector('#vCrf'); e.value = 27; e.dispatchEvent(new Event('input', {bubbles: true})); });
    await p.screenshot({ path: `${SH}${name}-edit.png` });
    await p.click('#editBanner button.primary'); await p.waitForTimeout(600);
    const st = await (await fetch(BASE + '/api/settings')).json();
    const pr = st.settings.presets.find(x => x.name === 'Mein Test ' + name);
    ok(pr && String(pr.values.vCrf) === '27', name + ': geänderter CRF nicht gespeichert (' + JSON.stringify(pr && pr.values.vCrf) + ')');
    // Vorschlag abwählen
    await p.evaluate(() => { location.hash = '#settings/presets'; }); await p.waitForTimeout(500);
    await p.click('.prow:has(input[value="Mein Test ' + name + '"]) input[type=checkbox]'); await p.waitForTimeout(600);
    await p.evaluate(() => { location.hash = ''; }); await p.waitForTimeout(500);
    ok(await p.locator('#vPresets button', {hasText: 'Mein Test ' + name}).count() === 0, name + ': Chip trotz abgewähltem Vorschlag');
    // Farbe der Video-Welt ändern
    await p.evaluate(() => { location.hash = '#settings/worlds'; }); await p.waitForTimeout(500);
    await p.screenshot({ path: `${SH}${name}-worlds.png`, fullPage: true });
    await p.click('.worldcard:nth-of-type(2) .swatch[title="Ozean"]'); await p.waitForTimeout(700);
    const hue = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--h').trim());
    ok(hue === '205', name + ': Farbe nicht übernommen, --h=' + hue);
    // zurück auf Violett
    await p.click('.worldcard:nth-of-type(2) .swatch[title="Nebel"]'); await p.waitForTimeout(500);
    await ctx.close();
  }
  await cleanTestPresets();
  // ---------- Anmeldung (Desktop + iPhone) ----------
  for (const [name, opt] of [views[0], views[1]]) {
    const ctx = await b.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => fails.push(name + ' JS: ' + e.message));
    await p.goto(BASE + '/#settings/auth'); await p.waitForTimeout(1500);
    await p.fill('input[placeholder="Benutzername"]', 'lukas');
    await p.fill('input[placeholder^="Passwort (mindestens"]', 'geheimes-passwort');
    await p.fill('input[placeholder="Passwort wiederholen"]', 'geheimes-passwort');
    await p.click('button:has-text("Anmeldung einschalten")'); await p.waitForTimeout(1500);
    ok(await p.locator('text=Angemeldet als').count() > 0, name + ': Anmeldung nicht eingeschaltet');
    await p.screenshot({ path: `${SH}${name}-auth-on.png`, fullPage: true });
    const ctx2 = await b.newContext(opt); const q = await ctx2.newPage();
    q.on('pageerror', e => fails.push(name + ' JS(login): ' + e.message));
    await q.goto(BASE); await q.waitForTimeout(1500);
    ok(await q.locator('.logincard').isVisible(), name + ': Anmeldefenster fehlt');
    await q.screenshot({ path: `${SH}${name}-login.png` });
    await q.fill('input[name=password]', 'falsch'); await q.fill('input[name=username]', 'lukas'); await q.click('button[type=submit]'); await q.waitForTimeout(2300);
    const fun = (await q.locator('.funline').textContent()) || '';
    ok(fun.includes("magic word"), name + ': Spaßmeldung fehlt: ' + fun);
    await q.screenshot({ path: `${SH}${name}-login-fun.png` });
    await q.fill('input[name=password]', 'geheimes-passwort'); await q.click('button[type=submit]'); await q.waitForTimeout(2500);
    ok(await q.locator('#viewMain').isVisible(), name + ': nach Login keine Hauptansicht');
    ok(await q.locator('#logoutBtn').isVisible(), name + ': Abmelden-Knopf fehlt');
    // ausschalten
    await q.evaluate(() => { location.hash = '#settings/auth'; }); await q.waitForTimeout(500);
    await q.fill('input[placeholder="Aktuelles Passwort"]', 'geheimes-passwort');
    q.once('dialog', d => d.accept());
    await q.click('button:has-text("Anmeldung ausschalten")'); await q.waitForTimeout(1200);
    ok(await q.locator('button:has-text("Anmeldung einschalten")').count() > 0, name + ': Ausschalten hat nicht geklappt');
    await ctx.close(); await ctx2.close();
  }
  console.log('Auffälligkeiten:', fails);
  await b.close();
})();
