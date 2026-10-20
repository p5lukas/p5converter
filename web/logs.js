'use strict';
/* Log-Seite wie bei p5assets: Dateiauswahl, Stufenfilter, Suche, Live-Nachladen, Download, Leeren; dazu der Kopfzeilen-Knopf
   mit Zähler für neue Warnungen/Fehler. Nutzt h(), fill(), icon(), api(), toast(), debounce(), S aus den anderen Dateien. */

const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* privater Modus */ } };
let logTimer = null;
function stopLogs() { clearInterval(logTimer); logTimer = null; }

// ---- Kopfzeilen-Knopf: neue Warnungen/Fehler seit dem letzten Besuch der Log-Seite ----
async function checkAlerts(markSeen) {
  try {
    if (S.logSeen == null) S.logSeen = +(lsGet('p5logseen') || 0);
    const r = await api('/api/logs/alerts?since=' + S.logSeen);
    if (markSeen) { S.logSeen = r.seq; lsSet('p5logseen', r.seq); r.errors = 0; r.warnings = 0; }
    S.alert = r; paintAlert();
  } catch (e) { /* die Anzeige ist optional */ }
}
function paintAlert() {
  const b = $('#logbtn'); if (!b) return;
  const a = S.alert || {errors: 0, warnings: 0}, hue = document.documentElement.dataset.kind === 'audio' ? 35 : 140;
  const nearRed = hue >= 340 || hue <= 20, nearAmber = hue > 20 && hue <= 65;
  b.classList.toggle('alert-err', a.errors > 0);
  b.classList.toggle('alert-warn', !a.errors && a.warnings > 0);
  b.classList.toggle('nearred', a.errors > 0 && nearRed);
  b.classList.toggle('nearamber', !a.errors && a.warnings > 0 && nearAmber);
  b.querySelector('.lbadge').textContent = a.errors || a.warnings || '';
  const parts = [a.errors ? `${a.errors} neue${a.errors === 1 ? 'r Fehler' : ' Fehler'}` : null, a.warnings ? `${a.warnings} neue Warnung${a.warnings === 1 ? '' : 'en'}` : null].filter(Boolean);
  b.title = parts.length ? 'Logs – ' + parts.join(', ') : 'Logs';
}

// ---- Log-Seite ----
async function logsPage() {
  const root = $('#viewLogs');
  checkAlerts(true);
  stopLogs();
  const st = {file: 'p5converter.log', entries: [], offset: 0, level: 'ALL', q: '', auto: true, live: true, full: false, files: await api('/api/logs')};
  const LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];
  const fmtBytes = b => b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : (b / 1024).toFixed(2) + ' KB';
  const view = h('div', {class: 'logview'}), count = h('span', {class: 'muted small'}), title = h('div'), liveBadge = h('button', {class: 'livebadge', type: 'button'});
  const chips = h('div', {class: 'lvlchips'}), fileSel = h('select'), q = h('input', {type: 'search', placeholder: 'Zum Filtern tippen …', autocomplete: 'off'});
  const toggle = h('input', {type: 'checkbox', checked: true, onchange: e => { st.auto = e.target.checked; if (st.auto) view.scrollTop = view.scrollHeight; }});

  const visible = () => st.entries.filter(e => (st.level === 'ALL' || e.level === st.level) && (!st.q || `${e.ts} ${e.level} ${e.src} ${e.msg}`.toLowerCase().includes(st.q.toLowerCase())));
  function renderLines() {
    const list = visible(), shown = list.slice(-5000);
    fill(view, shown.length ? shown.map(e => h('div', {class: 'll lv-' + e.level},
      e.ts ? h('span', {class: 'ts'}, `[${e.ts}]`) : null, ' ', h('span', {class: 'lvl'}, `[${e.level}]`), ' ',
      e.src ? [h('span', {class: 'src'}, e.src), h('span', {class: 'sep'}, ' | ')] : null, h('span', {class: 'msg'}, e.msg)))
      : h('div', {class: 'empty', style: 'padding:30px'}, st.entries.length ? 'Keine Einträge für diesen Filter.' : 'Noch keine Einträge.'));
    count.textContent = `${list.length} Einträge${list.length > shown.length ? ` (letzte ${shown.length} angezeigt)` : ''}`;
    if (st.auto) view.scrollTop = view.scrollHeight;
  }
  function renderHead() {
    fill(title, h('div', {class: 'row'}, icon('file'), h('div', {}, h('b', {}, st.file), h('div', {class: 'muted small'}, st.full ? 'Alle Einträge' : 'Letzte 1000 Einträge'))));
    fill(fileSel, st.files.map(x => h('option', {value: x.name, selected: x.name === st.file}, `${x.name}  (${fmtBytes(x.size)})`)));
    const isLive = st.live && st.file === 'p5converter.log';
    liveBadge.className = 'livebadge' + (isLive ? ' on' : '');
    fill(liveBadge, h('i'), isLive ? 'Live' : 'Pausiert');
    const counts = Object.fromEntries(LEVELS.map(l => [l, st.entries.filter(e => e.level === l).length]));
    fill(chips, h('button', {type: 'button', class: 'lvl-chip all' + (st.level === 'ALL' ? ' on' : ''), onclick: () => { st.level = 'ALL'; renderHead(); renderLines(); }}, 'Alle', h('small', {}, st.entries.length)),
      LEVELS.map(l => h('button', {type: 'button', class: `lvl-chip lv-${l}` + (st.level === l ? ' on' : ''), onclick: () => { st.level = l; renderHead(); renderLines(); }}, `[${l}]`, h('small', {}, counts[l]))));
  }
  async function load(full = false) {
    st.full = full;
    const r = await api(`/api/logs/read?file=${encodeURIComponent(st.file)}&tail=${full ? 20000 : 1000}`);
    st.entries = r.entries; st.offset = r.offset; st.files = await api('/api/logs'); renderHead(); renderLines();
  }
  async function tick() {
    if (location.hash !== '#logs') return stopLogs();
    if (!st.live || st.file !== 'p5converter.log') return;
    try {
      const r = await api(`/api/logs/read?file=${encodeURIComponent(st.file)}&offset=${st.offset}`);
      if (r.reset) st.entries = r.entries; else if (r.entries.length) st.entries = st.entries.concat(r.entries).slice(-20000);
      st.offset = r.offset;
      if (r.reset || r.entries.length) { renderHead(); renderLines(); }
    } catch (e) { /* ein fehlgeschlagener Abruf ist egal */ }
  }
  fileSel.onchange = async e => { st.file = e.target.value; await load(false); };
  q.oninput = debounce(() => { st.q = q.value; renderLines(); }, 150);
  liveBadge.onclick = () => { st.live = !st.live; renderHead(); };

  fill(root,
    h('div', {class: 'sethead'}, h('button', {class: 'ghost', onclick: () => { location.hash = ''; }}, icon('back'), ' Zur Startseite'), h('h1', {}, 'Logs')),
    h('div', {class: 'logcard'},
      h('div', {class: 'row wrap', style: 'align-items:flex-end'},
        h('div', {style: 'min-width:240px;flex:1;max-width:440px'}, h('label', {}, 'Logdatei wählen', fileSel)),
        h('div', {class: 'spacer'}),
        h('label', {class: 'check', title: 'Automatisch ans Ende scrollen', style: 'margin:0'}, toggle, 'Auto-Scroll'),
        h('button', {onclick: () => load(st.full)}, icon('sync'), ' Aktualisieren'),
        h('button', {onclick: () => load(true)}, icon('file'), ' Ganze Datei laden'),
        h('a', {class: 'btnlink', href: '#', onclick: e => { e.currentTarget.href = `/api/logs/download?file=${encodeURIComponent(st.file)}`; }}, icon('download'), ' Download'),
        h('button', {class: 'danger', onclick: async () => {
          if (!confirm(`„${st.file}“ wirklich leeren? Das kann nicht rückgängig gemacht werden.`)) return;
          await api('/api/logs/clear', {file: st.file}); await load(false); toast('Log geleert', 'ok');
        }}, icon('trash'), ' Leeren')),
      h('div', {class: 'row wrap', style: 'align-items:flex-end;margin-top:16px;border-top:1px solid var(--line);padding-top:14px'},
        h('div', {style: 'min-width:240px;flex:1'}, h('label', {}, 'Logs durchsuchen', q)),
        h('div', {}, h('label', {}, 'Nach Stufe filtern'), chips))),
    h('div', {class: 'logcard', style: 'padding:0;margin-top:18px'},
      h('div', {class: 'row loghead'}, title, h('div', {class: 'spacer'}), count, liveBadge),
      h('div', {class: 'loghint'}, h('b', {}, 'Tipp: '), 'Mit der Suche und den Stufen-Filtern grenzt du die Anzeige ein. Warnungen und Fehler sind farbig markiert. Passwörter und Sitzungs-Cookies werden nie ins Log geschrieben.'),
      view));
  await load(false);
  logTimer = setInterval(tick, 2000);
}
