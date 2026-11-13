// Spur-Zeilen, Editor, Popover und Namensvorschau der Seite „Konvertieren“.
// Der Zustand CV und die kleinen Fenster am Satz gehoeren dazu; die Karten selbst stehen in convert.js.
import { $, S, api, infoBtn } from './app.js';
import { cvRender } from './convert.js';
import { icon } from './icons.js';
import { cleanRules, nameRules, outExt } from './rename.js';
import { fill, h } from './settings.js';
import { LANGS, REC_NAME, isLossless, langName, trkDesc, trkEdit, trkEncExplain, trkEncInfo, trkPlanAuto, trkSet, trkTargetDesc, trkToggleAudioDefault } from './tracks.js';
import { TP } from './trkplan.js';

export const CV = {card: {}, gsel: {}, reviewed: new Set(), inh: {}, open: new Set(), unfold: new Set(), pop: null, qOpen: false, groups: [], bad: [], names: {}};

const cvTrackName = r => langName(r.lang) + ' · ' + trkDesc(r.s);


// ---------- kleine Fenster am Satz (Popover) ----------
function cvClosePop() {
  if (!CV.pop) return;
  CV.pop.el.remove(); document.removeEventListener('pointerdown', cvPopOutside, true); document.removeEventListener('keydown', cvPopKey, true); CV.pop = null;
}
const cvPopOutside = e => { if (CV.pop && !CV.pop.el.contains(e.target) && !CV.pop.anchor.contains(e.target) && !e.target.closest('dialog')) cvClosePop(); };
const cvPopKey = e => { if (e.key === 'Escape') cvClosePop(); };
export function cvPopFill() {
  if (!CV.pop) return;
  const b = CV.pop.el.querySelector('.cvpop-b'), a = document.activeElement;
  if (b.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox') return; // nicht mitten im Tippen neu bauen
  fill(b, CV.pop.build());
}
export function cvPopPlace() {
  const el = CV.pop.el;
  if (matchMedia('(max-width:700px)').matches) { el.style.left = el.style.top = ''; return; } // Handy: als Blatt unten (CSS)
  const r = CV.pop.anchor.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  const below = r.bottom + 8, top = below + hh > innerHeight - 8 ? Math.max(8, r.top - hh - 8) : below;
  el.style.top = top + 'px';
}
function cvPop(anchor, title, build) {
  if (CV.pop && CV.pop.anchor === anchor) { cvClosePop(); return; }
  cvClosePop();
  const el = h('div', {class: 'cvpop', role: 'dialog', 'aria-label': title}, h('div', {class: 'cvpop-h'}, h('b', {}, title), h('button', {type: 'button', class: 'small ghost', 'aria-label': 'Schließen', onclick: cvClosePop}, '✕')), h('div', {class: 'cvpop-b'}));
  document.body.append(el);
  CV.pop = {el, anchor, build};
  cvPopFill(); cvPopPlace();
  document.addEventListener('pointerdown', cvPopOutside, true); document.addEventListener('keydown', cvPopKey, true);
}
const tok = (text, onclick, cls, title) => h('button', {type: 'button', class: 'tok' + (cls ? ' ' + cls : ''), title: title || null, onclick: ev => onclick(ev.currentTarget)}, text);


// ---------- Zeilen der Tabelle ----------
export function cvRow(label, before, after, o) {
  o = o || {};
  const nob = before === null; // Zeile ohne „Vorher“ (z. B. Geschwindigkeit, Encoder)
  return h('div', {class: 'cvr' + (o.cls ? ' ' + o.cls : '') + (nob ? ' nob' : ''), role: 'row'},
    h('div', {class: 'cvk', role: 'rowheader'}, label, o.info ? infoBtn(o.info) : null),
    nob ? null : h('div', {class: 'cvb'}, before),
    nob ? null : h('div', {class: 'cva', 'aria-hidden': 'true'}, '→'),
    h('div', {class: 'cvn' + (o.ai ? ' aib' : '')}, after),
    o.extra ? h('div', {class: 'cvx'}, o.extra) : null);
}
// eine Änderung an der n-ten Spur für ALLE Dateien der Gruppe (gleiche Rahmendaten: die n-te Tonspur ist überall die n-te Tonspur)
function cvEach(g, ord, fn) {
  g.items.forEach(it => { const s = TP.atOrdinal(it.info, ord); if (s) { fn(it, s); delete CV.inh[it.f.path + '#' + s.index]; } });
  cvRender();
}
function cvSetKind(g, ord, want, type) {
  cvEach(g, ord, (it, s) => {
    const a0 = trkPlanAuto(it.info).tracks.find(x => x.index === s.index);
    const autoKind = !a0 || !a0.kept ? 'drop' : (type === 'audio' && a0.action === 'encode') ? 'encode' : 'copy';
    trkSet(it.f, s.index, want === autoKind ? {action: undefined, codec: undefined, kbps: undefined} : {action: want, codec: undefined, kbps: undefined});
  });
}
const cvKind = r => !r.kept ? 'drop' : (r.type === 'audio' && r.action === 'encode') ? 'encode' : 'copy';

function cvReasons(g, ex, r) {
  const out = [], key = ex.f.path + '#' + r.index, edit = trkEdit(ex.f, r.index);
  if (CV.inh[key] && Object.keys(edit).length) out.push({kind: 'inherit', text: 'Übernommen aus ' + CV.inh[key] + ': dort wurde dieselbe Spur schon kontrolliert.', undo: () => {
    g.items.forEach(it => { Object.keys(it.f.tracks || {}).forEach(k => { if (CV.inh[it.f.path + '#' + k]) { trkSet(it.f, +k, {action: undefined, codec: undefined, kbps: undefined, forced: undefined, default: undefined, title: undefined, lang: undefined}); delete CV.inh[it.f.path + '#' + k]; } }); });
    cvRender(); }});
  const ord = TP.ordinal(ex.info, r.index);
  TP.autoReasons(r).forEach(a => {
    if ((a.kind === 'rule' || a.kind === 'lang') && r.own) return; // eigene Entscheidung gilt
    const undo = {
      rule: () => cvSetKind(g, ord, 'copy', r.type), lang: () => cvSetKind(g, ord, 'copy', r.type),
      default: () => cvEach(g, ord, (it, s) => trkSet(it.f, s.index, {default: false})),
      forced: () => cvEach(g, ord, (it, s) => trkSet(it.f, s.index, {forced: false})),
    }[a.kind];
    const text = {rule: a.text.replace(/^Regel: /, 'Regel „') + '“ angewendet', lang: 'Sprache nicht in deiner Liste – wird entfernt', default: 'Standard-Spur nach deiner Rangliste',
      forced: 'Als Forced erkannt: ' + a.text.replace(/^Wahrscheinlich Forced \(/, '').replace(/\)$/, '') + '. Passt zu deinem Wunsch.'}[a.kind];
    out.push({kind: a.kind, text, undo});
  });
  if (r.kept && r.type === 'subtitle' && r.guess) out.push({kind: 'suggest', text: `Vorschlag: ${TP.guessText(r.guess)} – wahrscheinlich ein Forced-Untertitel (erzwungene Untertitel).`, apply: 'Als Forced markieren',
    do: () => cvEach(g, ord, (it, s) => trkSet(it.f, s.index, {forced: true}))});
  return out;
}
function cvAiBlock(reasons) {
  return reasons.map(a => h('div', {class: 'cvai'}, h('span', {class: 'ai'}, h('i', {}, icon('news')), a.kind === 'suggest' ? ' Vorschlag' : a.kind === 'inherit' ? ' Übernommen' : ' Automatisch'), h('span', {class: 'cvwhy'}, a.text),
    h('button', {type: 'button', class: 'small', onclick: a.kind === 'suggest' ? a.do : a.undo}, a.kind === 'suggest' ? a.apply : 'rückgängig')));
}

// Format und Bitrate einer umzuwandelnden Tonspur (im Fenster am Ziel und im Editor „⋯“)
function cvEncFields(g, ord, r) {
  const e = trkEncInfo(r);
  return h('div', {class: 'cvencf'}, h('div', {class: 'trkgrid'},
    h('label', {}, h('span', {class: 'lt'}, 'Format'), h('select', {'aria-label': 'Zielformat', onchange: ev => { const c = ev.target.value; cvEach(g, ord, (it, t) => trkSet(it.f, t.index, {action: 'encode', codec: c, kbps: TP.REC_KBPS[c]})); }},
      Object.keys(REC_NAME).map(c => h('option', {value: c, selected: c === e.c}, REC_NAME[c])))),
    e.c !== 'flac' ? h('label', {}, h('span', {class: 'lt'}, 'Bitrate je Stereo-Paar (kbit/s)'), h('input', {type: 'number', min: 32, max: 640, value: e.per, 'aria-label': 'Bitrate je Stereo-Paar',
      onchange: ev => { const k = +ev.target.value; ev.target.blur(); cvEach(g, ord, (it, t) => trkSet(it.f, t.index, {action: 'encode', kbps: k > 0 ? k : undefined, codec: trkEdit(it.f, t.index).codec || e.c})); }})) : null),
    h('p', {class: 'muted small' + (e.capped ? ' cap' : '')}, trkEncExplain(r)));
}
// kleines Fenster am Ziel „→ E-AC-3 … 640 kbit/s“: wird bei jeder Änderung neu aufgebaut, deshalb sucht es seine Spur jedes Mal neu
function popEnc(gkey, ord) {
  const g = CV.groups.find(x => x.key === gkey), ex = g && g.items[0], s = ex && TP.atOrdinal(ex.info, ord), r = s && ex.plan.tracks.find(x => x.index === s.index);
  if (!r || !r.kept || r.action !== 'encode') return [h('p', {class: 'muted small'}, 'Diese Spur wird nicht mehr umgewandelt.')];
  return [cvEncFields(g, ord, r), isLossless(r.s) ? h('p', {class: 'small warn'}, 'Diese Spur ist verlustfrei. Beim Kleinermachen geht ein Teil der Qualität unwiderruflich verloren; „unverändert“ ist verlustfrei und am schnellsten.') : null];
}

function cvTrackEditor(g, ex, r, ord) {
  const s = r.s, e = trkEdit(ex.f, s.index), isA = r.type === 'audio', enc = r.kept && r.action === 'encode' && isA;
  const val = e.lang !== undefined ? TP.normLang(e.lang) : TP.normLang(s.lang);
  const langSel = h('select', {'aria-label': 'Sprache', onchange: ev => { const v = ev.target.value; cvEach(g, ord, (it, t) => trkSet(it.f, t.index, {lang: v === TP.normLang(t.lang) || (!v && TP.noLang(t.lang)) ? undefined : v})); }},
    [h('option', {value: '', selected: TP.noLang(val) && !val}, 'Unbekannt (keine Angabe)'), LANGS.map(([c, n]) => h('option', {value: c, selected: c === val}, n + ' (' + c + ')')),
      val && !LANGS.some(x => x[0] === val) && val !== 'und' ? h('option', {value: val, selected: true}, val.toUpperCase() + ' (' + val + ')') : null]);
  return h('div', {class: 'cved'}, h('div', {class: 'trkgrid'},
    h('label', {}, h('span', {class: 'lt'}, 'Titel (so heißt die Spur im Player)'), h('input', {value: e.title !== undefined ? e.title : (s.title || ''), placeholder: isA ? 'z. B. Deutsch 5.1' : 'z. B. Deutsch',
      onchange: ev => { const v = ev.target.value; cvEach(g, ord, (it, t) => trkSet(it.f, t.index, {title: v === (t.title || '') ? undefined : v})); }})),
    h('label', {}, h('span', {class: 'lt'}, 'Sprache'), langSel)),
    enc ? cvEncFields(g, ord, r) : null,
    enc && isLossless(s) ? h('p', {class: 'small warn'}, 'Diese Spur ist verlustfrei. Beim Kleinermachen geht ein Teil der Qualität unwiderruflich verloren; „unverändert“ ist verlustfrei und am schnellsten.') : null);
}

export function cvTrackRow(g, ex, r, n) {
  const s = r.s, isA = r.type === 'audio', ord = TP.ordinal(ex.info, r.index), key = g.key + '#' + ord.type + ord.n, open = CV.open.has(key), kind = cvKind(r);
  const reasons = cvReasons(g, ex, r);
  const before = h('div', {}, h('div', {}, cvTrackName({lang: s.lang, s, type: r.type})),
    h('div', {class: 'muted small'}, [s.title ? '„' + s.title + '“' : null, s.default ? 'Standard' : null, s.forced ? 'Forced' : null, !isA && s.frames ? s.frames + ' Zeilen' : null].filter(Boolean).join(' · ') || 'Spur ' + s.index));
  const opts = isA ? [['copy', 'unverändert'], ['encode', 'umwandeln'], ['drop', 'entfernen']] : [['copy', 'behalten'], ['drop', 'entfernen']];
  const act = h('select', {class: 'cvact ' + kind, 'aria-label': (isA ? 'Ton ' : 'Untertitel ') + n + ': was passiert?', onchange: ev => cvSetKind(g, ord, ev.target.value, r.type)},
    opts.map(([v, t]) => h('option', {value: v, selected: v === kind}, t)));
  const flags = [];
  if (r.kept) {
    if (!isA) flags.push(h('button', {type: 'button', class: 'cvflag' + (r.forced ? ' on' : ''), 'aria-pressed': r.forced ? 'true' : 'false', title: 'Forced = erzwungene Untertitel, werden nur bei fremdsprachigen Stellen gezeigt',
      onclick: () => { const want = !r.forced; cvEach(g, ord, (it, t) => trkSet(it.f, t.index, {forced: want === !!t.forced ? undefined : want})); }}, 'Forced'));
    flags.push(h('button', {type: 'button', class: 'cvflag' + (r.def ? ' on' : ''), 'aria-pressed': r.def ? 'true' : 'false', title: 'Diese Spur startet der Player automatisch',
      onclick: () => {
        if (isA) cvEach(g, ord, (it, t) => trkToggleAudioDefault(it.f, it.info, t.index));
        else { const want = !r.def; cvEach(g, ord, (it, t) => trkSet(it.f, t.index, {default: want === !!t.default ? undefined : want})); }
      }}, 'Standard'));
  }
  const after = h('div', {class: 'cvafter'}, act, kind === 'encode' ? h('button', {type: 'button', class: 'cvenc', title: 'Zielformat und Bitrate ändern', onclick: ev => cvPop(ev.currentTarget, 'Ton ' + n + ' umwandeln', () => popEnc(g.key, ord)) }, '→ ' + trkTargetDesc(r) + ' ▾') : null, flags,
    h('button', {type: 'button', class: 'cvmore', 'aria-expanded': open ? 'true' : 'false', title: 'Titel, Sprache und Format ändern', onclick: () => { open ? CV.open.delete(key) : CV.open.add(key); cvRender(); }}, open ? '▴' : '⋯'));
  const noLg = r.kept && TP.noLang(r.lang);
  const extra = [cvAiBlock(reasons),
    noLg ? h('div', {class: 'cvwarn small'}, icon('warn'), ' Die Sprache fehlt. Ohne Sprache ordnet Plex die Spur nicht richtig zu. ', h('button', {type: 'button', class: 'small', onclick: () => { CV.open.add(key); cvRender(); }}, 'Sprache festlegen')) : null,
    open ? cvTrackEditor(g, ex, r, ord) : null];
  return cvRow((isA ? 'Ton ' : 'Untertitel ') + n, before, after, {ai: reasons.length > 0, cls: (!r.kept ? 'dropped ' : '') + (reasons.length ? 'hasai' : ''), extra: extra.flat().filter(Boolean).length ? extra : null});
}

// Dateiname: Beispiel für die erste Datei der Gruppe (vom Server berechnet)
// Alle Dateinamen einzeilig („alt → neu“) direkt unter den Namensfeldern, auch wenn noch nichts umbenannt wird (so sieht man, was man ändern kann); Vorschau vom Server in einer Anfrage für alle Dateien
export function cvNameList(files) {
  const pat = $('#pattern').value.trim(), rules = cleanRules(nameRules()), suf = $('#suffix').value;
  if (!files.length) return null;
  const renaming = !!(pat || rules.length || suf);
  const target = S.world === 'video' ? {codec: $('#vCodec').value, height: +$('#vHeight').value, bitDepth: +$('#vDepth').value, container: $('#vContainer').value} : {container: outExt()};
  const body = {items: files.map(f => f.path), pattern: pat, replace: rules, suffix: suf, ext: outExt(), mode: 'convert', target}, k = 'L' + JSON.stringify(body);
  const box = h('div', {class: 'cvnamelist', 'aria-label': 'Neue Dateinamen'});
  const paint = items => {
    const seen = {}; items.forEach(x => { if (!x.error) seen[x.new.toLowerCase()] = (seen[x.new.toLowerCase()] || 0) + 1; });
    const bad = items.filter(x => x.error || seen[x.new.toLowerCase()] > 1).length;
    fill(box, h('div', {class: 'cvnlh muted small'}, items.length + (items.length === 1 ? ' Datei' : ' Dateien') + (renaming ? ' bekommen einen neuen Namen' : ' behalten ihren Namen – Muster, Zusatz oder Ersetzung oben ändern ihn') + (bad ? ' · ' : ''), bad ? h('span', {class: 'bad'}, bad + (bad === 1 ? ' Problem' : ' Probleme')) : null),
      items.map(x => { const dup = !x.error && seen[x.new.toLowerCase()] > 1;
        return h('div', {class: 'cvnl' + (x.error || dup ? ' bad' : '')}, h('span', {class: 'o', title: x.old}, x.old), h('span', {class: 'ar'}, '→'),
          h('span', {class: 'n', title: x.error ? x.error : x.new}, x.error ? x.error : x.new + (dup ? ' (doppelt!)' : ''))); }));
  };
  if (CV.names[k]) paint(CV.names[k]);
  else { fill(box, h('div', {class: 'cvnlh muted small'}, 'Namen werden berechnet …')); api('/api/rename/preview', body).then(r => { CV.names[k] = r.items || []; paint(CV.names[k]); }).catch(() => fill(box, h('div', {class: 'cvnlh bad small'}, 'Vorschau nicht möglich'))); }
  return box;
}
