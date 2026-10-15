"use strict";
/* Planeten und Wurmloch-Flug: übernommen aus p5assets (gleiche Designlinie). */
/* Small planets (world switch in the header) and the wormhole animation of a world change. No images, no libraries. */

/** The ten worlds: hue (stored in the config), saturation/lightness of the accent (kept calm for the eyes: the strong
 *  colours are slightly toned down, "Silber" is nearly neutral) and the planet that belongs to the colour. */
const WORLD_THEMES = [
  { hue: 140, sat: 100, lit: 50, name: "Matrix", planet: 0 },
  { hue: 170, sat: 85, lit: 50, name: "Eis", planet: 1 },
  { hue: 205, sat: 90, lit: 55, name: "Ozean", planet: 2 },
  { hue: 240, sat: 80, lit: 66, name: "Nacht", planet: 8 },
  { hue: 270, sat: 85, lit: 62, name: "Nebel", planet: 3 },
  { hue: 320, sat: 85, lit: 58, name: "Neon", planet: 4 },
  { hue: 355, sat: 85, lit: 58, name: "Magma", planet: 5 },
  { hue: 30, sat: 90, lit: 54, name: "Sturm", planet: 6 },
  { hue: 55, sat: 80, lit: 54, name: "Wüste", planet: 7 },
  { hue: 195, sat: 14, lit: 68, name: "Silber", planet: 9 },
];
const themeOf = hue => WORLD_THEMES.find(t => t.hue === hue) || { hue, sat: 100, lit: 50, name: "", planet: null };
let planetCount = 0;

/** One planet per world colour: 0 earth-like, 1 ice, 2 banded gas giant, 3 ringed, 4 cratered moon, 5 volcanic, 6 storm giant, 7 desert with double ring. */
function planetKind(hue) {
  const t = themeOf(hue);
  if (t.planet != null) return t.planet;
  let best = WORLD_THEMES[0], bd = 999;       // a hue that is not one of the ten: the nearest world's planet
  WORLD_THEMES.forEach(w => { const d = Math.abs(w.hue - hue), dist = Math.min(d, 360 - d); if (dist < bd) { bd = dist; best = w; } });
  return best.planet;
}

function planetSvg(hue, size = 22) {
  const k = planetKind(hue), id = "pl" + (++planetCount);
  const f = themeOf(hue).sat / 100, grey = f < 0.3, sc = v => Math.round(v * f);
  const light = `hsl(${hue} ${sc(95)}% ${grey ? 84 : 74}%)`, mid = `hsl(${hue} ${sc(85)}% ${grey ? 62 : 52}%)`, dark = `hsl(${hue} ${sc(80)}% ${grey ? 24 : 18}%)`,
    deep = `hsl(${hue} ${sc(90)}% ${grey ? 40 : 32}%)`, pale = `hsl(${hue} ${sc(60)}% 85%)`;
  const r = k === 7 ? 8 : k === 3 ? 9 : k === 8 ? 10 : 11;
  const body = `<circle cx="16" cy="16" r="${r}" fill="url(#g${id})"/>`;
  const rim = `<ellipse cx="12" cy="11" rx="4" ry="2.4" fill="#fff" opacity=".16"/>`;
  const bands = (cols) => cols.map(([y, h, o]) => `<rect x="4" y="${y}" width="24" height="${h}" fill="${dark}" opacity="${o}"/>`).join("");
  const ring = (rx, ry, w, o, rot = -20) => `<ellipse cx="16" cy="16" rx="${rx}" ry="${ry}" fill="none" stroke="${light}" stroke-width="${w}" opacity="${o}" transform="rotate(${rot} 16 16)"/>`;
  let art = "";
  if (k === 0) art = `${body}<g clip-path="url(#c${id})"><path d="M8 12c2-3.5 5.500-3.500 7-1.200s-1 4.500-3.500 4.500-5 .2-3.500-3.300zM17.500 18c2.500-1.500 5.500.2 5.500 3.200s-3.200 4.200-5.500 3-2.500-5 0-6.200z" fill="${dark}" opacity=".55"/><path d="M7 20.500c3-1.500 5.500 1 9 0M10 9c2-.8 4 .6 7-.2" stroke="#fff" stroke-width="1.200" fill="none" opacity=".35" stroke-linecap="round"/>${rim}</g>`;
  else if (k === 1) art = `${body}<g clip-path="url(#c${id})"><ellipse cx="16" cy="6.500" rx="8" ry="3.600" fill="#fff" opacity=".85"/><ellipse cx="16" cy="26.500" rx="5.500" ry="2.200" fill="#fff" opacity=".6"/><path d="M9 14l5 2-2 4M20 12l-2 5 5 2" stroke="${pale}" stroke-width=".9" fill="none" opacity=".7"/>${rim}</g>`;
  else if (k === 2) art = `${body}<g clip-path="url(#c${id})">${bands([[8, 2, .3], [12, 3, .4], [17, 2, .3], [21, 3, .38]])}${rim}</g>`;
  else if (k === 3) art = `${ring(15, 4.600, 1.800, .55)}${body}<g clip-path="url(#c${id})">${bands([[11, 2, .25], [16, 3, .3]])}${rim}</g><g transform="rotate(-20 16 16)" clip-path="url(#f${id})"><ellipse cx="16" cy="16" rx="15" ry="4.600" fill="none" stroke="${light}" stroke-width="1.800"/></g>`;
  else if (k === 4) art = `${body}<g clip-path="url(#c${id})"><circle cx="12" cy="13" r="2.600" fill="${dark}" opacity=".5"/><circle cx="20" cy="11" r="1.600" fill="${dark}" opacity=".5"/><circle cx="19" cy="20" r="3.200" fill="${dark}" opacity=".45"/><circle cx="11" cy="21" r="1.500" fill="${dark}" opacity=".5"/><circle cx="12" cy="13" r="2.600" fill="none" stroke="${light}" stroke-width=".6" opacity=".6"/>${rim}</g>`;
  else if (k === 5) art = `<circle cx="16" cy="16" r="12.500" fill="${mid}" opacity=".22"/>${body}<g clip-path="url(#c${id})"><path d="M7 14l4.500 2.200 2 5M16 7.500l-1 4.500 4.500 3.500M20.500 19l3 2.500M12 24l2-3" stroke="${light}" stroke-width="1.300" fill="none" opacity=".95" stroke-linecap="round" stroke-linejoin="round"/>${rim}</g>`;
  else if (k === 6) art = `${body}<g clip-path="url(#c${id})">${bands([[9, 2.500, .3], [14, 2, .38], [20, 3, .32]])}<ellipse cx="19" cy="16.500" rx="4" ry="2.500" fill="${light}" opacity=".85"/><ellipse cx="19" cy="16.500" rx="2" ry="1.200" fill="${deep}" opacity=".8"/>${rim}</g>`;
  else if (k === 8) art = `<circle cx="14" cy="17" r="10" fill="url(#g${id})"/><g clip-path="url(#s${id})"><path d="M2 14c5-3 9 3 14 0s9-3 14 0M2 20c5-3 9 3 14 0s9-3 14 0" stroke="${dark}" stroke-width="1.600" fill="none" opacity=".45"/><ellipse cx="10.500" cy="11.500" rx="4" ry="2.300" fill="#fff" opacity=".16"/></g><circle cx="25.500" cy="7.500" r="3.200" fill="${light}"/><circle cx="26.500" cy="8.300" r="3" fill="${dark}" opacity=".35"/><circle cx="14" cy="17" r="10" fill="none" stroke="${light}" stroke-width=".5" opacity=".35"/>`;
  else if (k === 9) art = `${body}<g clip-path="url(#c${id})" fill="none" stroke="${pale}" stroke-width=".7" opacity=".55"><ellipse cx="16" cy="16" rx="4" ry="11"/><ellipse cx="16" cy="16" rx="8" ry="11"/><path d="M5.500 12h21M5 16h22M5.500 20h21"/></g><g clip-path="url(#c${id})">${rim}</g>`;
  else art = `${ring(14, 3.800, 1.200, .6, 18)}${ring(11.500, 3, .9, .45, 18)}${body}<g clip-path="url(#c${id})">${bands([[12, 1.500, .3], [17, 2, .35]])}${rim}</g><g transform="rotate(18 16 16)" clip-path="url(#f${id})"><ellipse cx="16" cy="16" rx="14" ry="3.800" fill="none" stroke="${light}" stroke-width="1.200"/></g>`;
  const dim = k === 5 ? `<stop offset="0" stop-color="${deep}"/><stop offset=".6" stop-color="${dark}"/><stop offset="1" stop-color="hsl(${hue} 60% 6%)"/>`
    : `<stop offset="0" stop-color="${light}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/>`;
  const t = document.createElement("template");
  t.innerHTML = `<svg class="planet" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" style="filter:drop-shadow(0 0 3px hsl(${hue} 100% 55% / .75))">
    <defs><radialGradient id="g${id}" cx="35%" cy="30%" r="80%">${dim}</radialGradient>
    <clipPath id="c${id}"><circle cx="16" cy="16" r="${r}"/></clipPath><clipPath id="s${id}"><circle cx="14" cy="17" r="10"/></clipPath><clipPath id="f${id}"><rect x="-4" y="16" width="40" height="20"/></clipPath></defs>${art}</svg>`;
  return t.content.firstElementChild;
}

/** Flight through a wormhole in the colour of the target world: stars streak towards the viewer, rings rush past. */
function runWormhole(canvas, hue, ms) {
  const W = canvas.width = Math.max(320, Math.round(innerWidth * 0.6)), H = canvas.height = Math.max(320, Math.round(innerHeight * 0.6));
  const ctx = canvas.getContext("2d"), cx = W / 2, cy = H / 2, maxR = Math.hypot(cx, cy);
  const mk = (near) => ({ a: Math.random() * Math.PI * 2, r: near ? 0.02 + Math.random() * 0.05 : 0.02 + Math.random() * 0.5, v: 0.6 + Math.random() * 1.2, white: Math.random() < 0.45 });
  const stars = Array.from({ length: 170 }, () => mk(false));
  let rings = [], lastRing = 0, last = performance.now();
  const t0 = last;
  (function frame(now) {
    const p = (now - t0) / ms;
    if (p >= 1) return;
    const dt = Math.min(48, now - last); last = now;
    const boost = 0.5 + 5 * Math.pow(Math.sin(Math.PI * Math.min(1, p * 1.1)), 2);   // slow – fast – slow
    ctx.fillStyle = "rgba(0,0,0,.24)"; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * (0.18 + 0.4 * p));
    glow.addColorStop(0, `hsl(${hue} 100% 60% / ${0.10 + 0.32 * Math.sin(Math.PI * p)})`); glow.addColorStop(1, "hsl(0 0% 0% / 0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    if (now - lastRing > 150) { rings.push(0.03); lastRing = now; }
    rings = rings.map(r => r * (1 + 0.0035 * boost * dt) + 0.0004 * dt).filter(r => r < 1.3);
    ctx.lineWidth = 1.2;
    for (const r of rings) { ctx.strokeStyle = `hsl(${hue} 100% 62% / ${Math.max(0, 0.55 - r * 0.45)})`; ctx.beginPath(); ctx.arc(cx, cy, r * maxR, 0, 7); ctx.stroke(); }
    for (const s of stars) {
      const r0 = s.r; s.r = r0 * (1 + s.v * boost * dt * 0.0042) + 0.0006 * dt * boost;
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      ctx.lineWidth = 0.6 + s.r * 2.6;
      ctx.strokeStyle = s.white ? `rgba(255,255,255,${0.35 + s.r * 0.65})` : `hsl(${hue} 100% ${62 + s.r * 28}%)`;
      ctx.beginPath(); ctx.moveTo(cx + ca * r0 * maxR, cy + sa * r0 * maxR); ctx.lineTo(cx + ca * s.r * maxR, cy + sa * s.r * maxR); ctx.stroke();
      if (s.r > 1.05) Object.assign(s, mk(true));
    }
    requestAnimationFrame(frame);
  })(t0);
}
