// Verbindet sich mit der WebView2-Debug-Schnittstelle (Port 9333), wartet bis die Oberfläche geladen ist, prüft sie und macht ein Bild.
const http = require('http'), fs = require('fs'), path = require('path');
const WebSocket = require('ws');
const get = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    try { target = JSON.parse(await get('http://127.0.0.1:9333/json')).find(t => t.type === 'page' && t.url.includes(':8790')); } catch (e) {}
    if (!target) await sleep(1000);
  }
  if (!target) { console.error('Keine Seite mit :8790 im WebView2'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const wait = {};
  ws.on('message', m => { const j = JSON.parse(m); if (j.id && wait[j.id]) wait[j.id](j); });
  const send = (method, params) => new Promise(r => { const i = ++id; wait[i] = r; ws.send(JSON.stringify({id: i, method, params})); });
  const ev = async expr => (await send('Runtime.evaluate', {expression: expr, returnByValue: true})).result.result.value;
  let ok = false, info;
  for (let i = 0; i < 30 && !ok; i++) {
    info = await ev(`JSON.stringify({title: document.title, w: innerWidth, h: innerHeight, appGeladen: typeof S !== 'undefined' && !!S.info, welten: document.querySelectorAll('#worlds button').length, farbe: getComputedStyle(document.documentElement).getPropertyValue('--h'), os: typeof S !== 'undefined' && S.info ? S.info.os : null, hw: typeof S !== 'undefined' && S.info && S.info.hw ? S.info.hw.backends.map(b => b.id + ':' + Object.keys(b.codecs || {}).filter(k => b.codecs[k]).join('/')) : null})`);
    ok = info && JSON.parse(info).appGeladen; if (!ok) await sleep(1000);
  }
  const out = process.env.GUI_OUT || '.';
  const shot = await send('Page.captureScreenshot', {format: 'png'});
  fs.writeFileSync(path.join(out, 'gui.png'), Buffer.from(shot.result.data, 'base64'));
  fs.writeFileSync(path.join(out, 'gui.json'), info || '{}');
  console.log('Oberfläche:', info);
  ws.close();
  const i = JSON.parse(info || '{}');
  if (!ok || i.welten < 2 || i.os !== 'windows') { console.error('Oberfläche unvollständig'); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
