import { S, api, fmtSize } from './app.js';
import { fill, h } from './settings.js';

'use strict';
/* „Gewonnener Platz“ über die Zeit (Startseite): Säulen je Monat für die letzten zwölf Monate, getrennt für Video und Audio, umschaltbar zwischen gespartem Platz,
   Zahl der Dateien und Dauer. Die Monatssummen führt der Server (internal/stats, /api/stats/history). Die Säulen sind SVG; Farben und Schrift stehen in CSS-Klassen
   (die CSP erlaubt keine Inline-Styles). Antippen oder Überfahren einer Säule zeigt die genauen Zahlen darunter. */

const STATE = {kind: 'video', metric: 'saved', sel: '', hist: null, loading: false};
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONTHS_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// die letzten n Kalendermonate bis einschließlich dem aktuellen ("2026-11"), fehlende Monate mit Nullen
export function lastMonths(rows, n, now) {
  const by = Object.fromEntries((rows || []).map(r => [r.month, r]));
  const d = now ? new Date(now) : new Date(), out = [];
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1), key = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0');
    out.push(Object.assign({month: key, count: 0, in: 0, out: 0, seconds: 0}, by[key] || {}));
  }
  return out;
}
export const monthName = (key, long) => { const [y, m] = key.split('-'); return (long ? MONTHS_LONG : MONTHS)[+m - 1] + (long ? ' ' + y : ''); };
export const fmtDuration = s => { s = Math.round(s || 0); const hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60); return hh ? hh + ' h ' + (mm ? mm + ' min' : '') : mm ? mm + ' min' : s + ' s'; };
const value = (m, metric) => metric === 'count' ? m.count : metric === 'time' ? m.seconds : Math.max(0, m.in - m.out);
const label = (v, metric) => metric === 'count' ? String(v) : metric === 'time' ? fmtDuration(v) : v ? fmtSize(v) : '';
const detail = m => monthName(m.month, true) + ': ' + (m.count ? m.count + (m.count === 1 ? ' Datei' : ' Dateien') + ' · ' + fmtSize(m.in) + ' → ' + fmtSize(m.out) + ' · ' + (m.in >= m.out ? fmtSize(m.in - m.out) + ' gespart' : fmtSize(m.out - m.in) + ' Mehrbedarf') + (m.seconds ? ' · ' + fmtDuration(m.seconds) + ' Laufzeit' : '') : 'keine Umwandlung');

const svgNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, ...kids) => { const el = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); kids.forEach(c => el.append(c.nodeType ? c : document.createTextNode(String(c)))); return el; };

function chart(months, metric) {
  const W = 480, H = 150, top = 22, bottom = 22, bw = W / months.length, vals = months.map(m => value(m, metric)), max = Math.max(...vals, 1);
  const root = svg('svg', {viewBox: `0 0 ${W} ${H}`, class: 'schart', role: 'img', 'aria-label': 'Säulen je Monat'});
  months.forEach((m, i) => {
    const v = vals[i], bh = v ? Math.max(3, (H - top - bottom) * v / max) : 0, x = i * bw + bw * 0.15, w = bw * 0.7, y = H - bottom - bh;
    const g = svg('g', {class: 'sgroup' + (m.month === STATE.sel ? ' sel' : ''), 'data-month': m.month, tabindex: '0', role: 'button', 'aria-label': detail(m)});
    g.append(svg('title', {}, detail(m)), svg('rect', {class: 'shit', x: i * bw, y: 0, width: bw, height: H}));
    if (bh) g.append(svg('rect', {class: 'sbar' + (metric === 'saved' && m.out > m.in ? ' neg' : ''), x, y, width: w, height: bh, rx: 2}));
    if (v) g.append(svg('text', {class: 'sval', x: x + w / 2, y: y - 4, 'text-anchor': 'middle'}, label(v, metric)));
    g.append(svg('text', {class: 'slab', x: x + w / 2, y: H - 7, 'text-anchor': 'middle'}, monthName(m.month)));
    const pick = () => { STATE.sel = m.month; render(); };
    g.addEventListener('click', pick); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    root.append(g);
  });
  return root;
}

function pills(options, cur, onpick, aria) {
  return h('div', {class: 'pills', role: 'radiogroup', 'aria-label': aria}, options.map(([id, t]) => h('button', {type: 'button', role: 'radio', class: 'pill small' + (id === cur ? ' on' : ''), 'aria-checked': id === cur ? 'true' : 'false', 'data-v': id, onclick: () => onpick(id)}, t)));
}

function render() {
  const box = document.getElementById('savedHist'); if (!box) return;
  const hist = STATE.hist;
  if (!hist) { fill(box); return; }
  const months = lastMonths(hist[STATE.kind], 12), any = months.some(m => m.count);
  if (!STATE.sel || !months.some(m => m.month === STATE.sel)) STATE.sel = (months.slice().reverse().find(m => m.count) || months[months.length - 1]).month;
  const sel = months.find(m => m.month === STATE.sel);
  fill(box,
    h('div', {class: 'savedhead'}, h('b', {}, 'Verlauf je Monat'),
      pills([['video', 'Video'], ['audio', 'Audio']], STATE.kind, k => { STATE.kind = k; STATE.sel = ''; render(); }, 'Art'),
      pills([['saved', 'Platz'], ['count', 'Dateien'], ['time', 'Dauer']], STATE.metric, m => { STATE.metric = m; render(); }, 'Anzeige')),
    any ? [chart(months, STATE.metric), h('div', {class: 'savedhistdetail small', id: 'savedHistDetail'}, detail(sel))]
      : h('p', {class: 'muted small', id: 'savedHistEmpty'}, 'Noch keine Monatszahlen für ' + (STATE.kind === 'video' ? 'Video' : 'Audio') + ': sie füllen sich mit jeder Umwandlung.'),
    any && hist.backfilled ? h('p', {class: 'muted small'}, 'Die ersten Monate stammen aus dem Verlauf (höchstens die letzten ' + (hist.max || 100) + ' Aufträge je Art) und können unvollständig sein.') : null);
}

// holt die Monatssummen neu (nach jeder Änderung der Gesamtzahlen) und zeichnet die Grafik
export async function refreshStatsHistory() {
  if (STATE.loading) return;
  STATE.loading = true;
  try { STATE.hist = await api('/api/stats/history'); } catch (e) { /* ohne Zahlen bleibt die Grafik leer */ }
  STATE.loading = false;
  render();
}
