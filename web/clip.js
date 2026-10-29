'use strict';
/* Probeclip: 30 Sekunden aus der Mitte einer Datei werden mit mehreren Einstellungen umgewandelt (der Server schneidet den Ausschnitt ohne Neukodieren und misst
   Größe, Dauer und den Abstand zur Quelle). Hier: Einstellungen zum Vergleichen vorschlagen, Lauf starten, Ergebnis mit denselben Bildstellen zeigen, „Diese nehmen“ übernimmt
   Encoder, Qualitätsstufe und Geschwindigkeit. Nutzt S, $, h(), fill(), api(), Q, resolveBackend(), workingBackends() usw. (nur zur Laufzeit). */

const CLIP = {id: null, run: null, timer: 0, cands: [], file: null, busy: false};

// Datei für den Ausschnitt: die erste der gewählten Gruppe
function clipFile() {
  const g = (CV.groups || []).find(x => x.key === CV.gsel.video) || (CV.groups || [])[0];
  return g ? g.items[0].f : S.files.video[0];
}
// Einstellungen zum Vergleichen: die aktuelle zuerst, dann jeder andere nutzbare Encoder bei gleicher Stufe, dann eine Stufe darunter und darüber beim aktuellen Encoder
function clipCandidates() {
  const codec = $('#vCodec').value, cur = resolveBackend().id, stage = $('#vQuality').value, preset = $('#vPreset').value, out = [];
  const stages = Q.STAGES.map(x => x[0]), at = stages.indexOf(stage);
  const mk = (backend, st, why) => {
    const crf = st === 'custom' ? +$('#vCrf').value : Q.value(backend, codec, st);
    if (crf == null) return null;
    const speed = {slow: 'Langsam', medium: 'Mittel', fast: 'Schnell', veryfast: 'Sehr schnell'}[preset] || preset;
    return {id: 'v' + out.length, label: [backend === 'cpu' ? 'CPU' : (BACKEND_FULL[backend] || backend), st === 'custom' ? 'Eigener Wert ' + crf : Q.stageName(st), speed].join(' · '), why,
      video: {codec, backend, crf, preset, bitDepth: +$('#vDepth').value, height: +$('#vHeight').value}, on: false};
  };
  const add = c => { if (c && out.length < 5) { c.id = 'v' + out.length; out.push(c); } };
  add(mk(cur, stage, 'aktuell'));
  workingBackends(codec).filter(id => id !== cur && (id !== 'cpu' || cur !== 'cpu')).forEach(id => add(mk(id, stage, 'anderer Encoder')));
  if (at > 0) add(mk(cur, stages[at - 1], 'eine Stufe besser'));
  if (at >= 0 && at < stages.length - 1) add(mk(cur, stages[at + 1], 'eine Stufe kleiner'));
  out.forEach((c, i) => { c.on = i < 3; });
  return out;
}

function clipClose() { clearTimeout(CLIP.timer); CLIP.timer = 0; if (CLIP.busy && CLIP.id) api('/api/clip/' + CLIP.id + '/cancel', {}).catch(() => {}); CLIP.busy = false; $('#clipDlg').close(); }
function openClip() {
  const f = clipFile();
  if (!f) { toast('Zuerst Dateien wählen.', 'bad'); return; }
  CLIP.file = f; CLIP.cands = clipCandidates(); CLIP.run = null; CLIP.id = null; CLIP.busy = false;
  clipRender();
  $('#clipDlg').showModal();
}
const clipPct = r => Math.round(r * 100) + ' %';
const clipImgQuality = ssim => ssim >= 0.995 ? 'kaum zu unterscheiden' : ssim >= 0.99 ? 'sehr nah an der Quelle' : ssim >= 0.98 ? 'nah an der Quelle' : 'sichtbar schwächer';
function clipTime(v) {
  const dur = (TRK.probe[CLIP.file.path] && TRK.probe[CLIP.file.path].__v || {}).duration;
  if (!dur || !v.speed) return null;
  return 'Datei (' + fmtTime(dur) + '): etwa ' + fmtTime(dur / v.speed);
}
async function clipStart() {
  const sel = CLIP.cands.filter(c => c.on);
  if (!sel.length) { toast('Mindestens eine Einstellung wählen.', 'bad'); return; }
  try {
    const r = await api('/api/clip', {path: CLIP.file.path, seconds: 30, variants: sel.map(c => ({id: c.id, label: c.label, video: c.video}))});
    CLIP.id = r.id; CLIP.busy = true; CLIP.run = null; clipPoll();
  } catch (e) { toast(e.message, 'bad'); }
}
async function clipPoll() {
  clearTimeout(CLIP.timer);
  try {
    CLIP.run = await api('/api/clip/' + CLIP.id);
    CLIP.busy = CLIP.run.status === 'läuft';
  } catch (e) { CLIP.busy = false; CLIP.run = {status: 'fehler', error: e.message, variants: []}; }
  clipRender();
  if (CLIP.busy) CLIP.timer = setTimeout(clipPoll, 1000);
}
function clipTake(c) {
  const v = c.video;
  if (v.backend !== resolveBackend().id) setField('vBackend', v.backend);
  const stage = (CLIP.run && CLIP.run.variants.find(x => x.id === c.id) && c.stage) || null;
  setField('vPreset', v.preset);
  refreshVideoUI();
  const st = Q.STAGES.map(x => x[0]).find(id => Q.value(v.backend, v.codec, id) === v.crf);
  if (st) qSetStage(st); else { setField('vQuality', 'custom'); setField('vCrf', v.crf); $('#vCrf').dispatchEvent(new Event('input', {bubbles: true})); }
  saveSettings(); cvRender();
  $('#clipDlg').close(); CLIP.busy = false;
  toast('Übernommen: ' + c.label, 'ok');
}
function clipRender() {
  const box = $('#clipBox'), run = CLIP.run, f = CLIP.file;
  const head = h('div', {class: 'wizhead'}, h('b', {}, 'Probeclip'), h('button', {type: 'button', class: 'small ghost', 'aria-label': 'Schließen', onclick: clipClose}, '✕'));
  const intro = h('p', {class: 'muted small'}, '30 Sekunden aus der Mitte von „', fileLabel(f), '“ werden mit den gewählten Einstellungen umgewandelt. Dein Original bleibt unberührt, der Ausschnitt wird danach gelöscht.');
  if (!run) {
    fill(box, head, intro, h('div', {class: 'clipcands'}, CLIP.cands.map(c => h('label', {class: 'opt' + (c.on ? ' on' : '')}, h('input', {type: 'checkbox', checked: c.on, onchange: ev => { c.on = ev.target.checked; clipRender(); }}),
      h('span', {}, h('b', {}, c.label), h('small', {class: 'muted'}, c.why))))),
      h('div', {class: 'wiznav'}, h('button', {type: 'button', class: 'ghost', onclick: clipClose}, 'Abbrechen'), h('button', {type: 'button', id: 'clipGo', class: 'primary', onclick: clipStart}, 'Probeclip starten')));
    return;
  }
  const done = run.variants.filter(v => v.status === 'fertig');
  const best = {size: Math.min(...done.map(v => v.size)), ssim: Math.max(...done.map(v => v.ssim)), speed: Math.max(...done.map(v => v.speed))};
  const card = v => {
    const c = CLIP.cands.find(x => x.id === v.id);
    const badges = v.status === 'fertig' && done.length > 1 ? [v.size === best.size ? 'kleinste Datei' : null, v.ssim === best.ssim ? 'bestes Bild' : null, v.speed === best.speed ? 'am schnellsten' : null].filter(Boolean) : [];
    return h('div', {class: 'clipcard ' + v.status},
      h('div', {class: 'clipct'}, h('b', {}, v.label), badges.map(b => h('span', {class: 'chip acc'}, b))),
      v.status === 'fertig' ? h('div', {class: 'clipstats'},
        h('div', {}, h('span', {class: 'muted small'}, 'Größe'), h('b', {}, fmtSize(v.size)), h('small', {class: 'muted'}, clipPct(v.ratio) + ' der Quelle · ' + v.kbps + ' kbit/s')),
        h('div', {}, h('span', {class: 'muted small'}, 'Bild'), h('b', {}, clipImgQuality(v.ssim)), h('small', {class: 'muted'}, 'SSIM ' + v.ssim.toFixed(4).replace('.', ',') + ' · PSNR ' + v.psnr.toFixed(1).replace('.', ',') + ' dB')),
        h('div', {}, h('span', {class: 'muted small'}, 'Tempo'), h('b', {}, v.speed.toFixed(1).replace('.', ',') + '× Echtzeit'), h('small', {class: 'muted'}, clipTime(v) || ''))) :
        h('div', {class: v.status === 'fehler' ? 'bad small' : 'muted small'}, v.status === 'fehler' ? 'Fehlgeschlagen: ' + v.error : v.status === 'läuft' ? 'Läuft …' : 'Wartet …'),
      v.status === 'fertig' && c ? h('button', {type: 'button', class: 'small primary', onclick: () => clipTake(c)}, 'Diese nehmen') : null);
  };
  const imgs = run.images && run.images.length ? [0, 1].filter(k => run.images[k]).map(k => h('div', {class: 'clipimgs'},
    h('div', {class: 'clipimg'}, h('img', {src: `/api/clip/${run.id}/img/${run.images[k]}`, alt: 'Quelle'}), h('small', {class: 'muted'}, 'Quelle')),
    done.map(v => v.images && v.images[k] ? h('div', {class: 'clipimg'}, h('img', {src: `/api/clip/${run.id}/img/${v.images[k]}`, alt: v.label}), h('small', {class: 'muted'}, v.label)) : null))) : null;
  fill(box, head, intro,
    run.status === 'läuft' ? h('div', {class: 'muted small'}, 'Der Lauf dauert je nach Einstellung etwas. ' + done.length + ' von ' + run.variants.length + ' fertig.') : null,
    run.status === 'fehler' || run.status === 'abgebrochen' ? h('div', {class: 'banner warn'}, icon('warn'), ' ', run.error || run.status) : null,
    h('div', {class: 'clipcards'}, run.variants.map(card)),
    imgs ? h('div', {class: 'cliplab muted small'}, 'Dieselbe Stelle, vergrößert (Mitte des Bildes)') : null, imgs,
    h('div', {class: 'wiznav'}, run.status === 'läuft' ? h('button', {type: 'button', class: 'ghost', onclick: clipClose}, 'Abbrechen') : h('button', {type: 'button', class: 'ghost', onclick: () => { CLIP.run = null; CLIP.id = null; clipRender(); }}, '‹ Andere Einstellungen'),
      h('button', {type: 'button', class: run.status === 'läuft' ? 'ghost' : 'primary', onclick: () => { if (run.status !== 'läuft') $('#clipDlg').close(); else clipClose(); }}, run.status === 'läuft' ? 'Schließen' : 'Fertig')));
}
