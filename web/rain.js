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
