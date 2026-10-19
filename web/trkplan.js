'use strict';
/* Reine Logik für „Audio & Untertitel“ (ohne Oberfläche, deshalb mit Node testbar: tools/test-trkplan.js).
   Aus den Spuren einer Datei, den Regeln (Codec → umwandeln/entfernen), den Sprach-Wünschen aus den Einstellungen und den eigenen
   Änderungen des Nutzers wird berechnet, was mit jeder Spur passiert. Eigene Änderungen (manual) gehen immer vor.
   Ergebnis: edits = {Spurindex: {…}} – genau das Format, das der Server als overrides.tracks versteht (internal/build/video.go: TrackEdit). */
const TP = (() => {
  // gleiche Zuordnung wie im Server (langAlias in video.go): 2-Buchstaben- und Bibliothekscodes → ein Code
  const LANG_ALIAS = {de: 'ger', deu: 'ger', en: 'eng', fr: 'fre', fra: 'fre', es: 'spa', it: 'ita', ja: 'jpn', ru: 'rus', pt: 'por', nl: 'dut', nld: 'dut', pl: 'pol', tr: 'tur',
    zh: 'chi', zho: 'chi', ko: 'kor', sv: 'swe', da: 'dan', no: 'nor', nb: 'nor', nob: 'nor', fi: 'fin', cs: 'cze', ces: 'cze', hu: 'hun', el: 'gre', ell: 'gre', ar: 'ara', hi: 'hin'};
  const normLang = l => { l = String(l || '').trim().toLowerCase(); return LANG_ALIAS[l] || l; };
  const noLang = l => { l = normLang(l); return !l || l === 'und'; };

  // Empfehlung beim Neu-Kodieren: Bitrate je Stereo-Paar
  const REC_KBPS = {aac: 160, opus: 96, ac3: 192, eac3: 192, mp3: 192};
  const RULE_CODECS = [['any', 'Beliebiger Codec'], ['dts', 'DTS (alle)'], ['dtshd', 'DTS-HD (verlustfrei)'], ['truehd', 'TrueHD'], ['eac3', 'E-AC-3'], ['ac3', 'AC-3'],
    ['aac', 'AAC'], ['flac', 'FLAC'], ['pcm', 'PCM'], ['mp3', 'MP3'], ['opus', 'Opus'], ['vorbis', 'Vorbis']];
  const RULE_TARGETS = [['aac', 'AAC'], ['opus', 'Opus'], ['ac3', 'AC-3'], ['eac3', 'E-AC-3'], ['flac', 'FLAC'], ['mp3', 'MP3']];
  const SUB_KINDS = [['any', 'Beliebiger Untertitel'], ['image', 'Bild-Untertitel (PGS, VobSub, DVB)'], ['text', 'Text-Untertitel (SRT, ASS …)']];
  const IMG_SUBS = ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'];
  const label = (list, v) => (list.find(x => x[0] === v) || [])[1] || v;

  // Schlüssel des Tonformats einer Spur (DTS-HD erkennt man am Profil)
  function codecKey(s) {
    const c = s.codec || '';
    if (c === 'dts') return /ma|hd/i.test(s.profile || '') ? 'dtshd' : 'dts';
    if (c.startsWith('pcm_')) return 'pcm';
    return ['truehd', 'eac3', 'ac3', 'aac', 'flac', 'mp3', 'opus', 'vorbis', 'alac'].includes(c) ? c : 'other';
  }
  const subKind = s => IMG_SUBS.includes(s.codec) ? 'image' : 'text';

  function audioRuleMatches(r, s) {
    const k = codecKey(s), ch = s.channels || 2;
    const codecOK = !r.codec || r.codec === 'any' || r.codec === k || (r.codec === 'dts' && k === 'dtshd');
    const chOK = !r.ch || r.ch === 'any' || (r.ch === 'multi' && ch > 2) || (r.ch === 'stereo' && ch <= 2);
    return codecOK && chOK;
  }
  const subRuleMatches = (r, s) => !r.kind || r.kind === 'any' || r.kind === subKind(s);

  function describeAudioRule(r) {
    const when = label(RULE_CODECS, r.codec || 'any') + (r.ch === 'multi' ? ' (Surround)' : r.ch === 'stereo' ? ' (Stereo)' : '');
    if (r.action === 'drop') return when + ' → entfernen';
    if (r.action === 'encode') return when + ' → ' + label(RULE_TARGETS, r.to || 'aac') + (r.to === 'flac' ? '' : ' ' + (r.kbps || REC_KBPS[r.to || 'aac'] || 160) + ' kbit/s je Stereo-Paar');
    return when + ' → unverändert';
  }
  const describeSubRule = r => label(SUB_KINDS, r.kind || 'any') + (r.action === 'drop' ? ' → entfernen' : ' → behalten');

  const COMMENTARY = /komment|commentary|audiodesk|audio desc|beschreib|descriptive/i;

  // Welche Spuren würden wegen der Sprach-Liste entfernt? Hat die Datei keine der gewünschten Sprachen, wird nichts entfernt (guard).
  function langDrops(list, keep) {
    const want = (keep || []).map(normLang);
    if (!want.length) return {drop: new Set(), guard: false};
    const drop = new Set(list.filter(s => !noLang(s.lang) && !want.includes(normLang(s.lang))).map(s => s.index));
    if (list.length && list.every(s => drop.has(s.index))) return {drop: new Set(), guard: true};
    return {drop, guard: false};
  }

  /* Forced-Untertitel nach Größe erraten: Ist eine Untertitelspur in derselben Sprache viel kleiner als die größte (unter 20 %, die große hat
     mindestens 100 Zeilen bzw. 20 KB), ist sie sehr wahrscheinlich „Forced“ (nur fremdsprachige Stellen). Nur wenn die Datei Zählwerte hat
     (MKV-Tags von mkvmerge); sonst bleibt es leer. Ergebnis: {Spurindex: {n, of, unit}} – nur Vorschlag, nie still gesetzt. */
  function forcedGuess(info) {
    const out = {}, subs = (info.streams || []).filter(s => s.type === 'subtitle' && !s.attachedPic && !s.forced && !noLang(s.lang));
    const byLang = {};
    subs.forEach(s => (byLang[normLang(s.lang)] = byLang[normLang(s.lang)] || []).push(s));
    Object.values(byLang).forEach(list => {
      if (list.length < 2) return;
      const useFrames = list.every(s => s.frames > 0), useBytes = list.every(s => s.bytes > 0);
      if (!useFrames && !useBytes) return;
      const val = s => useFrames ? s.frames : s.bytes, big = list.reduce((a, b) => val(b) > val(a) ? b : a);
      if (val(big) < (useFrames ? 100 : 20000)) return;
      list.forEach(s => { if (s !== big && val(s) < val(big) * 0.2) out[s.index] = {n: val(s), of: val(big), unit: useFrames ? 'Zeilen' : 'Bytes'}; });
    });
    return out;
  }

  /* cfg: {audioRules, subRules, audioMode:'copy'|'encode', audioCodec, audioKbps, subMode:'copy'|'none', usePrefs, prefs:{audioKeep, subKeep, audioDefault, subDefault:[{lang, forced}]}}
     Ergebnis: {tracks:[{s, index, type, kept, action, codec, kbps, def, forced, lang, edit, why:[…]}], edits, guard:{audio, sub}} */
  function plan(info, manual, cfg) {
    manual = manual || {};
    const prefs = (cfg.usePrefs && cfg.prefs) || {};
    const streams = (info.streams || []).filter(s => !s.attachedPic && (s.type === 'audio' || s.type === 'subtitle'));
    const guess = forcedGuess(info);
    const aud = streams.filter(s => s.type === 'audio'), sub = streams.filter(s => s.type === 'subtitle');
    const la = langDrops(aud, prefs.audioKeep), ls = langDrops(sub, prefs.subKeep);
    const res = streams.map(s => {
      const m = manual[s.index] || {}, isA = s.type === 'audio', auto = {}, why = [];
      const drops = isA ? la.drop : ls.drop;
      if (drops.has(s.index)) { auto.action = 'drop'; why.push('Sprache nicht in deiner Liste'); }
      else if (isA) {
        const r = (cfg.audioRules || []).find(x => audioRuleMatches(x, s));
        if (r) {
          auto.action = r.action === 'drop' ? 'drop' : r.action === 'encode' ? 'encode' : 'copy';
          if (auto.action === 'encode') { auto.codec = r.to || 'aac'; auto.kbps = r.to === 'flac' ? undefined : (r.kbps || REC_KBPS[auto.codec] || 160); }
          why.push('Regel: ' + describeAudioRule(r));
        }
      } else {
        const r = (cfg.subRules || []).find(x => subRuleMatches(x, s));
        if (r) { auto.action = r.action === 'drop' ? 'drop' : 'copy'; why.push('Regel: ' + describeSubRule(r)); }
      }
      const own = !!m.action;
      const action = own ? m.action : auto.action;
      const codec = own ? m.codec : auto.codec, kbps = own ? m.kbps : auto.kbps;
      const kept = action ? action !== 'drop' : (isA || cfg.subMode !== 'none');
      const edit = {...m};
      if (!own && auto.action) { edit.action = auto.action; if (auto.codec) edit.codec = auto.codec; if (auto.kbps) edit.kbps = auto.kbps; }
      Object.keys(edit).forEach(k => { if (edit[k] === undefined || edit[k] === null) delete edit[k]; });
      return {s, index: s.index, type: s.type, kept, action: action || (isA && cfg.audioMode === 'encode' ? 'encode' : 'copy'), codec, kbps, own,
        forced: m.forced !== undefined ? !!m.forced : !!s.forced, def: m.default !== undefined ? !!m.default : !!s.default, lang: m.lang !== undefined ? m.lang : s.lang, edit, why,
        guess: m.forced === undefined && !s.forced && guess[s.index] ? guess[s.index] : null};
    });

    // Standard-Spur nach Rangliste (nur wenn der Nutzer bei dieser Art keine Standard-Spur selbst gesetzt hat)
    const hasManualDef = list => list.some(s => manual[s.index] && manual[s.index].default !== undefined);
    const setDef = (t, others) => {
      t.edit.default = true; t.def = true; t.why.push('Standard nach deiner Rangliste');
      others.forEach(o => { if (o !== t && o.def) { o.edit.default = false; o.def = false; } });
    };
    if ((prefs.audioDefault || []).length && !hasManualDef(aud)) {
      const keptA = res.filter(r => r.type === 'audio' && r.kept);
      for (const l of prefs.audioDefault) {
        const t = keptA.find(r => normLang(r.s.lang) === normLang(l) && !COMMENTARY.test((manual[r.index] && manual[r.index].title !== undefined ? manual[r.index].title : r.s.title) || ''));
        if (t) { setDef(t, keptA); break; }
      }
    }
    if ((prefs.subDefault || []).length && !hasManualDef(sub)) {
      const keptS = res.filter(r => r.type === 'subtitle' && r.kept);
      for (const e of prefs.subDefault) {
        // ein erratener Forced-Untertitel zählt als „Forced“, wenn der Wunsch Forced verlangt (Vorauswahl, im Plan sichtbar)
        const t = keptS.find(r => normLang(r.s.lang) === normLang(e.lang) && !!(r.forced || r.guess) === !!e.forced);
        if (t) {
          if (t.guess && !t.forced) { t.edit.forced = true; t.forced = true; t.why.push(`Wahrscheinlich Forced (${t.guess.n} statt ${t.guess.of} ${t.guess.unit})`); t.guess = null; }
          setDef(t, keptS); break;
        }
      }
    }
    const edits = {};
    res.forEach(r => { if (Object.keys(r.edit).length) edits[r.index] = r.edit; });
    return {tracks: res, edits, guard: {audio: la.guard, sub: ls.guard}};
  }

  // Zusammenfassung für Anzeige und Zählung: was passiert insgesamt?
  function summarize(p) {
    const n = {dropLang: 0, dropRule: 0, dropOwn: 0, encode: 0, defaults: 0};
    p.tracks.forEach(r => {
      if (!r.kept) { if (r.own) n.dropOwn++; else if (r.why.some(w => w.startsWith('Sprache'))) n.dropLang++; else n.dropRule++; }
      else if (r.action === 'encode') n.encode++;
      if (r.why.some(w => w.startsWith('Standard'))) n.defaults++;
    });
    return n;
  }

  // Aufbau einer Datei nur nach Sprachen (für die Gruppen): „Ton: Deutsch, Englisch · Untertitel: Deutsch“
  function signature(info) {
    const key = type => [...new Set((info.streams || []).filter(s => s.type === type && !s.attachedPic).map(s => noLang(s.lang) ? 'und' : normLang(s.lang)))].sort();
    const a = key('audio'), u = key('subtitle');
    return {audio: a, sub: u, key: a.join(',') + '|' + u.join(',')};
  }

  return {normLang, noLang, REC_KBPS, RULE_CODECS, RULE_TARGETS, SUB_KINDS, codecKey, subKind, audioRuleMatches, subRuleMatches, describeAudioRule, describeSubRule, plan, summarize, signature, langDrops, forcedGuess};
})();
if (typeof module !== 'undefined') module.exports = TP;
