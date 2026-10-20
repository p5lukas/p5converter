'use strict';
/* Verlauf der Konvertierungen (Seite #history): eine gemeinsame Liste für Video und Audio (je Art bleiben die letzten 100), jeder Eintrag mit Abzeichen,
   mit Suche, Filter nach Ergebnis und Zeitraum, Details, CSV-Export und „Verlauf leeren“.
   Nutzt h(), fill(), icon(), api(), toast(), debounce(), fmtSize(), fmtTime(), W(), S aus den anderen Dateien. */

let histTimer = null;
function stopHistory() { clearInterval(histTimer); histTimer = null; if (typeof S !== 'undefined') S.histReload = null; }

const HIST_STATUS = {done: ['fertig', 'ok'], error: ['Fehler', 'err'], canceled: ['abgebrochen', 'warn'], skipped: ['übersprungen', 'warn']};
const HIST_RANGE = [['all', 'Alle', 0], ['today', 'Heute', -1], ['7', 'Letzte 7 Tage', 7], ['30', 'Letzte 30 Tage', 30]];
const fmtDateTime = d => { const x = new Date(d); return x.toLocaleDateString('de-DE') + ' ' + x.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'}); };

async function historyPage() {
  const root = $('#historyBody');
  stopHistory();
  const st = {kind: 'all', items: [], max: 100, persistent: true, q: '', status: 'all', range: 'all', open: new Set()};
  const list = h('div', {class: 'histlist'}), count = h('span', {class: 'muted small'}), chips = h('div', {class: 'lvlchips'}),
    q = h('input', {type: 'search', placeholder: 'Dateiname, Ordner, Meldung …', autocomplete: 'off'}),
    range = h('select', {onchange: () => { st.range = range.value; render(); }}, HIST_RANGE.map(r => h('option', {value: r[0]}, r[1]))),
    note = h('div');

  const visible = () => {
    const now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const rg = HIST_RANGE.find(r => r[0] === st.range)[2], min = rg === -1 ? start : rg > 0 ? Date.now() - rg * 864e5 : 0;
    const t = st.q.trim().toLowerCase();
    return st.items.filter(e => (st.status === 'all' || e.status === st.status) && new Date(e.ended).getTime() >= min &&
      (!t || [e.name, e.input, e.output, e.error, e.encoder, ...(e.warnings || [])].join(' ').toLowerCase().includes(t)));
  };
  function entry(e) {
    const [lbl, cls] = HIST_STATUS[e.status] || [e.status, ''];
    const checks = (e.checks || []).map(c => h('div', {class: 'small ' + (c.ok ? 'okc' : 'warn')}, (c.ok ? '✓ ' : '✗ ') + c.note));
    const det = h('details', {class: 'histentry', open: st.open.has(e.id), ontoggle: ev => { ev.target.open ? st.open.add(e.id) : st.open.delete(e.id); }},
      h('summary', {},
        h('span', {class: 'hname', title: e.input}, kindBadge(e.kind), e.name),
        h('span', {class: 'chip ' + cls}, lbl),
        e.checkFailed ? h('span', {class: 'chip warn', title: 'Eine Prüfung nach dem Umwandeln ist durchgefallen'}, 'Prüfung ✗') : null,
        h('span', {class: 'muted small hmeta'}, fmtDateTime(e.ended),
          e.status === 'done' && e.sizeOut ? ' · ' + fmtSize(e.sizeIn) + ' → ' + fmtSize(e.sizeOut) + (e.sizeIn ? ' (' + Math.round(e.sizeOut / e.sizeIn * 100) + ' %)' : '') : '',
          e.seconds ? ' · ' + fmtTime(e.seconds) : '')),
      h('div', {class: 'hdet small'},
        h('div', {}, h('span', {class: 'muted'}, 'Quelle: '), e.input),
        e.output ? h('div', {}, h('span', {class: 'muted'}, 'Ziel: '), e.output) : null,
        e.encoder ? h('div', {}, h('span', {class: 'muted'}, 'Schreiben: '), (BACKEND_NAMES[e.backend] ? BACKEND_NAMES[e.backend] + ' · ' : '') + e.encoder + (e.encoderOk ? ' ✓' : ''),
          e.decoder ? [h('span', {class: 'muted'}, '  ·  Lesen: '), e.decoder === 'hardware' ? 'Hardware' + (e.decoderOk ? ' ✓' : '') : 'CPU'] : null) : null,
        checks,
        (e.warnings || []).map(w => h('div', {class: 'warn'}, w)),
        e.error ? h('div', {style: 'color:var(--bad)'}, e.error) : null,
        e.cmd ? h('details', {}, h('summary', {}, 'ffmpeg-Befehl und Log'), h('pre', {}, e.cmd), h('pre', {}, (e.log || []).join('\n'))) : null));
    return det;
  }
  function render() {
    const rows = visible();
    fill(list, rows.length ? rows.map(entry) : h('div', {class: 'empty', style: 'padding:24px'}, st.items.length ? 'Keine Einträge für diesen Filter.' : 'Es wurde noch nichts umgewandelt.'));
    count.textContent = `${rows.length} von ${st.items.length} Einträgen (es bleiben die letzten ${st.max} je Art: Video und Audio)`;
    const n = k => st.items.filter(e => e.status === k).length;
    fill(chips, h('button', {type: 'button', class: 'lvl-chip all' + (st.status === 'all' ? ' on' : ''), onclick: () => { st.status = 'all'; render(); }}, 'Alle', h('small', {}, st.items.length)),
      Object.entries(HIST_STATUS).map(([k, [lbl]]) => h('button', {type: 'button', class: 'lvl-chip' + (st.status === k ? ' on' : ''), onclick: () => { st.status = k; render(); }}, lbl, h('small', {}, n(k)))));
    fill(note, st.persistent ? null : h('div', {class: 'banner warn'}, icon('warn'), ' Ohne beschreibbaren Ordner /config bleibt der Verlauf nur im Arbeitsspeicher und ist nach einem Neustart weg.'));
  }
  async function load() {
    if (location.hash !== '#history') return stopHistory();
    try {
      const r = await api('/api/history?kind=' + st.kind);
      st.items = r.items || []; st.max = r.max; st.persistent = r.persistent;
      render();
    } catch (e) { toast(e.message, 'bad'); }
  }
  q.oninput = debounce(() => { st.q = q.value; render(); }, 150);

  fill(root,
    note,
    h('div', {class: 'logcard'},
      h('div', {class: 'row wrap', style: 'align-items:flex-end'},
        h('div', {style: 'min-width:220px;flex:1;max-width:440px'}, h('label', {}, 'Suchen', q)),
        h('div', {}, h('label', {}, 'Zeitraum', range)),
        h('div', {class: 'spacer'}),
        h('button', {onclick: load}, icon('sync'), ' Aktualisieren'),
        h('a', {class: 'btnlink', href: '#', onclick: e => { e.currentTarget.href = '/api/history.csv?kind=' + st.kind; }}, icon('download'), ' CSV'),
        h('button', {class: 'danger', onclick: async () => {
          if (!confirm('Den ganzen Verlauf (Video und Audio) wirklich leeren? Das kann nicht rückgängig gemacht werden.')) return;
          try { await api('/api/history/clear', {kind: 'all'}); await load(); toast('Verlauf geleert', 'ok'); } catch (e) { toast(e.message, 'bad'); }
        }}, icon('trash'), ' Verlauf leeren')),
      h('div', {style: 'margin-top:14px;border-top:1px solid var(--line);padding-top:12px'}, h('label', {}, 'Nach Ergebnis filtern'), chips)),
    h('div', {class: 'logcard', style: 'padding:0;margin-top:18px'},
      h('div', {class: 'row loghead'}, h('b', {}, 'Konvertierungen'), h('div', {class: 'spacer'}), count),
      list));
  S.histReload = load;
  await load();
  histTimer = setInterval(load, 3000);
}
