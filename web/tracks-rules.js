// Regel-Vorschlaege, voreingestellte Regeln und der Regel-Editor.
// Reine Logik und Spuraenderungen stehen in tracks.js; hier ist nur die Oberflaeche dazu.
import { $, infoBtn } from './app.js';
import { icon } from './icons.js';
import { h, saveCfg } from './settings.js';
import { TP } from './trkplan.js';
import { trkGlobalList, trkRender, trkRules, trkRulesSave } from './tracks.js';

// ---------- Regel-Vorschläge aus den gelesenen Dateien ----------
// Ein Vorschlag lässt sich nur für diesen Lauf anlegen oder dauerhaft (Einstellungen → Regeln, gilt künftig überall)
function trkAddRule(type, rule, always) {
  if (always) { saveCfg(x => { x.trackRules = x.trackRules || {audio: [], sub: []}; (type === 'audio' ? x.trackRules.audio : x.trackRules.sub).push(rule); }, 'Regel in Einstellungen → Regeln gespeichert ✓').then(() => { trkRender(); }); return; }
  const r = trkRules(); (type === 'audio' ? r.audio : r.sub).push(rule); trkRulesSave(r); TRK.rulesOpen = true; trkRender();
}
export function trkRuleSuggestionList(all) {
  const r = trkRules(), g = trkGlobalList(), out = [];
  const count = fn => all.filter(x => x.info.streams.some(fn)).length;
  const hasAudioRule = codec => [...r.audio, ...g.filter(e => e.type === 'audio' && e.on).map(e => e.rule)].some(x => x.codec === codec || x.codec === 'any');
  const nDts = count(s => s.type === 'audio' && ['dts', 'dtshd'].includes(TP.codecKey(s)));
  if (nDts && !hasAudioRule('dts') && !hasAudioRule('dtshd')) out.push({text: `${nDts} ${nDts === 1 ? 'Datei hat' : 'Dateien haben'} DTS-Tonspuren. Viele Fernseher und Player können DTS nicht. Alle DTS-Spuren in E-AC-3 (Dolby Digital Plus, 256 kbit/s je Stereo-Paar) umwandeln, den Rest unverändert lassen?`,
    label: 'DTS → E-AC-3', type: 'audio', rule: {codec: 'dts', ch: 'any', action: 'encode', to: 'eac3', kbps: 256}});
  const nTh = count(s => s.type === 'audio' && TP.codecKey(s) === 'truehd');
  if (nTh && !hasAudioRule('truehd')) out.push({text: `${nTh} ${nTh === 1 ? 'Datei hat' : 'Dateien haben'} TrueHD-Tonspuren (sehr groß). Mit E-AC-3 wären sie deutlich kleiner und überall abspielbar.`,
    label: 'TrueHD → E-AC-3', type: 'audio', rule: {codec: 'truehd', ch: 'any', action: 'encode', to: 'eac3', kbps: 256}});
  return out;
}
export function trkRuleSuggestions(all) {
  const out = trkRuleSuggestionList(all);
  return out.length ? h('div', {class: 'trkhints'}, h('div', {class: 'trkhintshead'}, icon('bolt'), ' Vorschläge für Regeln'),
    out.map(x => h('div', {class: 'trkhint2'}, h('span', {}, x.text),
      h('span', {class: 'btns'}, h('button', {type: 'button', class: 'small', title: 'Die Regel gilt nur für diesen Lauf', onclick: () => trkAddRule(x.type, x.rule, false)}, 'Regel: ' + x.label),
        h('button', {type: 'button', class: 'small', title: 'Die Regel wird in Einstellungen → Regeln gespeichert und gilt künftig immer', onclick: () => trkAddRule(x.type, x.rule, true)}, 'Immer anwenden'))))) : null;
}

// Voreingestellte (allgemeine) Regeln mit Haken je Regel; mit „all“ (gelesene Dateien) zusätzlich „betrifft N Dateien“
export function trkGlobalRules(all, withTitle) {
  const list = trkGlobalList(), off = () => trkRules();
  const toggle = (e, on) => { const r = trkRules(); r.off = r.off.filter(k => k !== e.key); if (!on) r.off.push(e.key); trkRulesSave(r); trkRender(); };
  const aff = e => all ? all.filter(x => (x.info.streams || []).some(s => !s.attachedPic && (e.type === 'audio' ? s.type === 'audio' && TP.audioRuleMatches(e.rule, s) : s.type === 'subtitle' && TP.subRuleMatches(e.rule, s)))).length : null;
  return h('div', {class: 'trkglobal'},
    h('div', {class: 'trkghead'}, withTitle ? [h('b', {}, 'Voreingestellte Regeln'), infoBtn('trkGlobal')] : null, h('span', {class: 'spacer'}), h('button', {type: 'button', class: 'small ghost', onclick: () => { location.hash = '#settings/rules'; }}, icon('gear'), ' In den Einstellungen ändern')),
    list.length ? list.map(e => { const n = aff(e);
      return h('label', {class: 'check trkgrule' + (e.on ? '' : ' off')}, h('input', {type: 'checkbox', checked: e.on, onchange: ev => toggle(e, ev.target.checked), 'aria-label': 'Regel anwenden'}),
        h('span', {class: 'trkgtxt'}, e.type === 'audio' ? TP.describeAudioRule(e.rule) : TP.describeSubRule(e.rule)),
        n != null ? h('span', {class: 'chip' + (n ? ' acc' : '')}, n ? 'betrifft ' + n + (n === 1 ? ' Datei' : ' Dateien') : 'betrifft keine Datei') : null); })
      : h('p', {class: 'muted small'}, 'Keine voreingestellten Regeln. Allgemeine Regeln legst du in den Einstellungen unter „Regeln“ an, sie gelten dann bei jedem Lauf.'));
}

// ---------- Regel-Editor ----------
// Eine Regelliste {audio: [...], sub: [...]} bearbeiten: für die Regeln dieses Laufs (#vTrkRules) und für die allgemeinen Regeln in den Einstellungen.
// save() speichert, redraw() zeichnet neu; withModes bettet „Alle übrigen Tonspuren/Untertitel“ ein (nur im Fenster Details).
const NEW_AUDIO_RULE = () => ({codec: 'dts', ch: 'any', action: 'encode', to: 'eac3', kbps: 256});
export function trkRulesBody(r, save, redraw, withModes) {
  const cfgA = TP.RULE_CODECS, change = fn => { fn(); save(); redraw(); }, move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; change(() => { [arr[i], arr[j]] = [arr[j], arr[i]]; }); };
  const sel = (opts, val, on, aria) => h('select', {'aria-label': aria, onchange: ev => on(ev.target.value)}, opts.map(([v, t]) => h('option', {value: v, selected: v === val}, t)));
  const ctl = (arr, i) => h('div', {class: 'rulectl'}, h('button', {type: 'button', class: 'small ghost', title: 'Nach oben', disabled: i === 0, onclick: () => move(arr, i, -1)}, '↑'),
    h('button', {type: 'button', class: 'small ghost', title: 'Nach unten', disabled: i === arr.length - 1, onclick: () => move(arr, i, 1)}, '↓'),
    h('button', {type: 'button', class: 'small ghost', title: 'Regel entfernen', onclick: () => change(() => arr.splice(i, 1))}, '✕'));
  const audioRows = r.audio.map((x, i) => h('div', {class: 'trkrule'},
    h('span', {class: 'rn'}, i + 1),
    h('span', {class: 'rtxt'}, 'Wenn die Spur'),
    sel(cfgA, x.codec || 'any', v => change(() => { x.codec = v; }), 'Codec'),
    sel([['any', 'mit beliebig vielen Kanälen'], ['multi', 'Surround (mehr als 2 Kanäle)'], ['stereo', 'Stereo oder Mono']], x.ch || 'any', v => change(() => { x.ch = v; }), 'Kanäle'),
    h('span', {class: 'rtxt'}, 'ist →'),
    sel([['copy', 'unverändert lassen'], ['encode', 'umwandeln in'], ['drop', 'entfernen']], x.action || 'copy', v => change(() => { x.action = v; if (v === 'encode' && !x.to) x.to = 'ac3'; }), 'Aktion'),
    x.action === 'encode' ? sel(TP.RULE_TARGETS, x.to || 'aac', v => change(() => { x.to = v; x.kbps = TP.REC_KBPS[v]; }), 'Zielformat') : null,
    x.action === 'encode' && x.to !== 'flac' ? h('label', {class: 'rkbps'}, h('input', {type: 'number', min: 32, max: 640, value: x.kbps || TP.REC_KBPS[x.to || 'aac'] || 160, 'aria-label': 'Bitrate je Stereo-Paar',
      onchange: ev => change(() => { x.kbps = +ev.target.value > 0 ? +ev.target.value : undefined; })}), ' kbit/s je Stereo-Paar') : null,
    x.action === 'encode' && x.to !== 'flac' && (x.kbps || 0) * 3 > 640 ? h('span', {class: 'rtxt small'}, '5.1 wird dabei auf höchstens 640 kbit/s gedeckelt') : null,
    ctl(r.audio, i)));
  return [h('h4', {}, 'Ton'), audioRows.length ? audioRows : h('p', {class: 'muted small'}, 'Noch keine Regel.'),
    h('div', {class: 'btns'}, h('button', {type: 'button', class: 'small', onclick: () => change(() => r.audio.push(NEW_AUDIO_RULE()))}, '+ Regel für Ton')),
    withModes ? h('div', {class: 'grid2', style: 'margin-top:12px'}, $('#vAudioModeRow'), $('#vAudioCodecRow')) : null, withModes ? $('#vAudioHint') : null,
    withModes ? [h('h4', {}, 'Untertitel'), h('div', {class: 'grid2'}, $('#vSubModeRow'))] : null];
}

