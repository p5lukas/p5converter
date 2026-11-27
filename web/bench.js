import { CODEC_LABEL, api, fmtSize, toast } from './app.js';
import { cfg, fill, h, saveCfg } from './settings.js';

'use strict';
/* Encoder-Schnelltest (Einstellungen → Hardware): kodiert eine kurze synthetische Testquelle mit jedem erkannten Encoder und Codec in der Stufe „Gut“ und zeigt,
   was bei diesem Rechner am schnellsten ist (Server: internal/server/bench.go). Der Lauf läuft auf dem Server weiter, wenn man die Seite verlässt; das Ergebnis
   merkt sich der Server für die erkannte Hardware. */

const BENCH = {run: null, last: null, id: null, timer: 0, err: '', box: null, loaded: false};
const speedText = r => r.speed ? r.speed.toFixed(1).replace('.', ',') + '× Echtzeit · ' + Math.round(r.fps) + ' fps' : '–';
const nameOf = r => r.label + ' · ' + (CODEC_LABEL[r.codec] || r.codec);

// je Codec der schnellste Encoder (nur sinnvoll, wenn mindestens zwei Encoder diesen Codec können)
function bestPerCodec(run) {
  const out = {};
  for (const c of new Set(run.results.map(r => r.codec))) {
    const rs = run.results.filter(r => r.codec === c && r.status === 'fertig');
    if (rs.length > 1) out[rs.reduce((a, b) => b.speed > a.speed ? b : a).id] = true;
  }
  return out;
}
function table(run, fastest) {
  const best = fastest ? bestPerCodec(run) : {};
  const rows = run.results.map(r => {
    const state = r.status === 'fertig' ? null : r.status === 'läuft' ? 'läuft …' : r.status === 'fehler' ? 'Fehler' : 'wartet';
    return h('tr', {class: 'benchrow' + (best[r.id] ? ' best' : ''), 'data-id': r.id},
      h('td', {}, nameOf(r), best[r.id] ? h('span', {class: 'chip ok benchbest'}, 'schnellster Encoder') : null),
      h('td', {class: state ? 'muted' : ''}, state && r.status !== 'fehler' ? state : r.status === 'fehler' ? h('span', {class: 'warn', title: r.error}, 'Fehler: ' + (r.error || '').slice(0, 80)) : speedText(r)),
      h('td', {class: 'muted'}, r.status === 'fertig' ? fmtSize(r.size) + ' · ' + (r.kbps / 1000).toFixed(1).replace('.', ',') + ' Mbit/s' : ''));
  });
  return h('div', {class: 'tbody'}, h('table', {class: 'benchtable'}, h('tr', {}, h('th', {}, 'Encoder · Codec'), h('th', {}, 'Geschwindigkeit'), h('th', {}, 'Größe der Testdatei')), rows));
}

async function benchPoll() {
  clearTimeout(BENCH.timer);
  if (!BENCH.id) return;
  try {
    BENCH.run = await api('/api/bench/' + BENCH.id);
    if (BENCH.run.status !== 'läuft') { BENCH.last = BENCH.run.status === 'fertig' ? BENCH.run : BENCH.last; BENCH.id = null; }
  } catch (e) { BENCH.err = e.message; BENCH.id = null; }
  benchRender();
  if (BENCH.id) BENCH.timer = setTimeout(benchPoll, 700);
}
async function benchStart() {
  BENCH.err = '';
  try { const r = await api('/api/bench/start', {}); BENCH.id = r.id; BENCH.run = null; }
  catch (e) { BENCH.err = e.message; benchRender(); return; }
  benchRender(); benchPoll();
}
async function benchCancel() { if (BENCH.id) { await api('/api/bench/' + BENCH.id + '/cancel', {}).catch(() => {}); } }

function benchRender() {
  const box = BENCH.box; if (!box || !box.isConnected) return;
  const running = !!BENCH.id, run = running ? BENCH.run : (BENCH.run && BENCH.run.status !== 'läuft' ? BENCH.run : BENCH.last);
  const kids = [];
  kids.push(h('p', {class: 'muted small'}, 'Kodiert ein kurzes Testbild (' + (run ? run.length : 10) + ' Sekunden, 1080p, nichts von deinen Dateien) mit jedem erkannten Encoder in der Stufe „Gut“ und zeigt, was bei dir am schnellsten ist. Das dauert etwa eine Minute; währenddessen sollte nichts anderes laufen.'));
  kids.push(h('div', {class: 'btns'},
    running ? h('button', {type: 'button', id: 'benchCancel', onclick: benchCancel}, 'Abbrechen') : h('button', {type: 'button', id: 'benchStart', class: 'primary', onclick: benchStart}, run ? 'Noch einmal messen' : 'Schnelltest starten'),
    running ? h('span', {class: 'muted small'}, (run ? run.results.filter(r => r.status === 'fertig' || r.status === 'fehler').length + ' von ' + run.results.length + ' Encodern gemessen …' : 'Starte …')) : null));
  if (BENCH.err) kids.push(h('p', {class: 'warn small', id: 'benchErr'}, BENCH.err));
  if (run) {
    const done = run.status !== 'läuft';
    if (done && run.status === 'abgebrochen') kids.push(h('p', {class: 'muted small'}, 'Abgebrochen.'));
    if (done && run.status === 'fehler') kids.push(h('p', {class: 'warn small'}, run.error || 'Der Schnelltest ist fehlgeschlagen.'));
    kids.push(table(run, done ? run.fastest : ''));
    if (done && run.status === 'fertig') {
      const best = run.results.find(r => r.id === run.fastest), many = new Set(run.results.filter(r => r.status === 'fertig').map(r => r.backend)).size > 1;
      if (run.disturbed) kids.push(h('p', {class: 'warn small'}, 'Während des Tests lief ein Auftrag: die Zahlen sind unsicher. Miss noch einmal, wenn nichts läuft.'));
      if (best && !many) kids.push(h('p', {class: 'muted small', id: 'benchOnly'}, 'Auf diesem Rechner ist nur ' + best.label + ' nutzbar, ein Vergleich zwischen Encodern ist deshalb nicht möglich. Die Tabelle zeigt, wie schnell die Codecs mit diesem Encoder sind.'));
      else if (best) kids.push(h('div', {class: 'benchrec'}, h('p', {}, h('b', {}, 'Bei dir ist ' + best.label + ' am schnellsten'), ' (gemessen mit ' + (CODEC_LABEL[best.codec] || best.codec) + ': ' + speedText(best) + '; H.265 gilt, weil es der gängigste Codec ist).'),
        h('div', {class: 'btns'}, cfg().preferredBackend === best.backend ? h('span', {class: 'chip ok'}, 'Schon als bevorzugter Encoder eingestellt')
          : h('button', {type: 'button', id: 'benchUse', onclick: async () => { await saveCfg(x => { x.preferredBackend = best.backend; }, best.label + ' ist jetzt der bevorzugte Encoder ✓'); benchRender(); }}, 'Als bevorzugt übernehmen'))));
      kids.push(h('p', {class: 'muted small'}, 'Gemessen mit einem synthetischen Testbild: echte Filme (mehr Bewegung, Körnung) können schneller oder langsamer sein, die Reihenfolge der Encoder bleibt aber meist gleich. Die Qualität pro Größe vergleichst du am besten mit dem Probeclip.'));
    }
  }
  fill(box, ...kids);
}

// Abschnitt für die Hardware-Seite; lädt beim ersten Mal das gemerkte Ergebnis des Servers
export function benchSection() {
  const box = h('div', {class: 'benchbox', id: 'benchBox'});
  BENCH.box = box;
  setTimeout(benchRender, 0); // die Seite hängt den Abschnitt erst nach dem Aufbau ein
  if (!BENCH.loaded) {
    BENCH.loaded = true;
    api('/api/bench/last').then(r => { BENCH.last = r.last || null; benchRender(); }).catch(e => { toast(e.message, 'bad'); });
  }
  if (BENCH.id) { clearTimeout(BENCH.timer); benchPoll(); }
  return box;
}
