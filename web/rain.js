'use strict';
/* Matrix-Regen (wie bei p5assets, hier kurz und dezent): läuft etwa eine Sekunde über eine Karte, wenn ein Auftrag erfolgreich beendet ist
   (Startseite: die Karte des aktuellen Auftrags, Verlauf: die Warteschlange). In Einstellungen → Allgemein abschaltbar; bei
   „Bewegung reduzieren“ (prefers-reduced-motion) und bei Fehlern gibt es keinen Regen. Nutzt S, cfg() zur Laufzeit. */

const RAIN_GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ0123456789';
const rainAllowed = () => !(typeof cfg === 'function' && cfg().noRain === true) && !matchMedia('(prefers-reduced-motion: reduce)').matches && !document.hidden;

// Regen über host (ein Element); gibt false zurück, wenn er nicht laufen darf oder soll
function matrixRain(host, ms) {
  if (!host || !rainAllowed() || host.querySelector(':scope > canvas.rain')) return false;
  ms = ms || 1300;
  const r = host.getBoundingClientRect();
  if (r.width < 40 || r.height < 20) return false;
  const cv = document.createElement('canvas'); cv.className = 'rain'; cv.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  host.classList.add('rainhost'); host.appendChild(cv);
  S.rainCount = (S.rainCount || 0) + 1;
  const ctx = cv.getContext('2d'), size = Math.max(12, Math.round(14 * dpr)), cols = Math.ceil(cv.width / size);
  const color = getComputedStyle(host).getPropertyValue('--accent').trim() || '#00ff5a';
  const drops = Array.from({length: cols}, () => -Math.random() * cv.height / size * 0.6), speed = Array.from({length: cols}, () => 0.7 + Math.random() * 0.9);
  const t0 = performance.now(); let last = t0;
  ctx.font = size + 'px ui-monospace, monospace'; ctx.textBaseline = 'top';
  const frame = now => {
    const p = (now - t0) / ms;
    if (p >= 1) { cv.remove(); host.classList.remove('rainhost'); return; }
    const dt = Math.min(50, now - last); last = now;
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(0, 0, cv.width, cv.height); // Schweif ausblenden, Hintergrund bleibt durchsichtig
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < cols; i++) {
      const y = drops[i] * size;
      if (drops[i] < 0) { drops[i] += speed[i] * dt * 0.02; continue; }
      ctx.fillStyle = '#eafff0'; ctx.globalAlpha = 0.95 * (1 - p * 0.5);
      ctx.fillText(RAIN_GLYPHS[Math.floor(Math.random() * RAIN_GLYPHS.length)], i * size, y);
      ctx.fillStyle = color; ctx.globalAlpha = 0.8 * (1 - p * 0.6);
      ctx.fillText(RAIN_GLYPHS[Math.floor(Math.random() * RAIN_GLYPHS.length)], i * size, y - size);
      ctx.globalAlpha = 1;
      drops[i] += speed[i] * dt * 0.02;
    }
    cv.style.opacity = p > 0.7 ? String(Math.max(0, 1 - (p - 0.7) / 0.3)) : '1';
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return true;
}

// Aufträge, die seit dem letzten Abruf erfolgreich fertig wurden (Kontrolle bestanden): Regen auf der sichtbaren Karte
function rainOnDone(jobs) {
  S.rainSeen = S.rainSeen || new Set();
  const first = !S.rainInit; S.rainInit = true;
  let fresh = 0;
  jobs.forEach(j => { if (j.status === 'done' && !S.rainSeen.has(j.id)) { S.rainSeen.add(j.id); if (!j.checkFailed) fresh++; } });
  if (first || !fresh) return;
  const onStart = !$('#viewMain').classList.contains('hidden') && S.step === 'start', onHist = !$('#viewHistory').classList.contains('hidden');
  if (onStart) matrixRain($('#hero')); else if (onHist) matrixRain($('#queuePanel'));
}

/* Fortschrittsbalken mit Regen (Optik „Regenfront“): laufende Aufträge bekommen einen dickeren Balken, dessen Füllung aus fallenden Zeichen
   besteht; eine helle Kante läuft vorn mit. Die Zeichnung hängt nur von der Zeit ab (kein Zustand), deshalb bleibt sie stehen, wenn die Karten
   neu aufgebaut werden. Gilt für laufende Aufträge auf der Startseite und im Verlauf; aus bei „Matrix-Regen“ aus, „Bewegung reduzieren“ und
   verstecktem Tab; es werden höchstens RAINBAR_MAX Balken gleichzeitig gezeichnet, und nur sichtbare. */
const RAINBAR_MAX = 6, RAINBAR_COL = 9, RAINBAR_FONT = 12;
let rainBarTimer = 0;
const rainHash = (a, b) => { let x = (Math.imul(a + 1, 374761393) + Math.imul(b + 7, 668265263)) >>> 0; x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0; return (x ^ (x >>> 16)) >>> 0; };

// Balken laufender Aufträge kennzeichnen (nach jedem Neuaufbau der Karten) und die Zeichenschleife starten
function rainBarsSync() {
  const allowed = rainAllowed();
  document.querySelectorAll('.bar.rain').forEach(b => { if (!allowed || !b.closest('.job.running, .jobnow')) { b.classList.remove('rain'); b.querySelector(':scope > canvas.rainbar')?.remove(); } });
  if (!allowed) return;
  document.querySelectorAll('#queue .job.running .bar, #jobNow.jobnow .bar:not(.thin)').forEach(b => { b.classList.add('rain'); if (!b.querySelector(':scope > canvas.rainbar')) rainBarDraw(b, performance.now() / 1000); }); // sofort zeichnen: nach dem Neuaufbau der Karten kein Flackern
  if (!rainBarTimer && document.querySelector('.bar.rain')) rainBarTimer = requestAnimationFrame(rainBarFrame);
}

function rainBarDraw(bar, t) {
  const fill = bar.querySelector(':scope > i'); if (!fill) return;
  const r = bar.getBoundingClientRect(); if (r.width < 20 || r.height < 8) return;
  let cv = bar.querySelector(':scope > canvas.rainbar');
  const dpr = Math.min(2, window.devicePixelRatio || 1), cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
  if (!cv) { cv = document.createElement('canvas'); cv.className = 'rainbar'; cv.setAttribute('aria-hidden', 'true'); bar.appendChild(cv); }
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  const c = cv.getContext('2d'), W = r.width, H = r.height, fw = Math.max(0, Math.min(W, fill.getBoundingClientRect().width));
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  if (fw < 2) return;
  const color = getComputedStyle(bar).getPropertyValue('--accent').trim() || '#00ff5a';
  c.save(); c.beginPath(); c.rect(0, 0, fw, H); c.clip();
  c.font = RAINBAR_FONT + 'px ui-monospace, monospace'; c.textBaseline = 'top';
  const cols = Math.ceil(fw / RAINBAR_COL) + 1;
  for (let i = 0; i < cols; i++) {
    const sp = 18 + (rainHash(i, 1) % 2600) / 100, ph = (rainHash(i, 2) % 1000) / 1000 * H * 2;
    for (let k = 0; k < 4; k++) {
      const yy = ((t * sp + ph - k * 12) % (H + 24) + (H + 24)) % (H + 24) - 12;
      const g = RAIN_GLYPHS[rainHash(i * 131 + k * 17, Math.floor((t * sp - k * 12) / 12)) % RAIN_GLYPHS.length];
      c.globalAlpha = k === 0 ? 1 : 0.7 - 0.16 * k; c.fillStyle = k === 0 ? '#eafff0' : color;
      c.fillText(g, i * RAINBAR_COL, yy);
    }
  }
  c.globalAlpha = 1; c.restore();
  // helle Kante vorn
  const gr = c.createLinearGradient(fw - 26, 0, fw, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(210,255,225,.8)');
  c.fillStyle = gr; c.fillRect(Math.max(0, fw - 26), 0, Math.min(26, fw), H);
  c.fillStyle = '#eafff0'; c.fillRect(Math.max(0, fw - 2), 0, 2, H);
}

let rainBarLast = 0;
function rainBarFrame(now) {
  rainBarTimer = 0;
  const bars = [...document.querySelectorAll('.bar.rain')];
  if (!bars.length || !rainAllowed()) { bars.forEach(b => b.querySelector(':scope > canvas.rainbar')?.remove()); return; }
  if (now - rainBarLast >= 33) { // etwa 30 Bilder pro Sekunde
    rainBarLast = now;
    let n = 0; const vh = window.innerHeight || 800;
    for (const b of bars) {
      const r = b.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh || n >= RAINBAR_MAX) continue;
      n++; rainBarDraw(b, now / 1000);
    }
    S.rainBarFrames = (S.rainBarFrames || 0) + 1;
  }
  rainBarTimer = requestAnimationFrame(rainBarFrame);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) rainBarsSync(); });
