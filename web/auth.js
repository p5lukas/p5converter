'use strict';
/* Anmeldung: Anmeldefenster (wie bei p5assets, mit Spaßmeldung), Abmelden und Anzeige-Umschaltung. */

let funTimer = null;
/** Spaßmeldung nach falschem Passwort: rot, Buchstabe für Buchstabe getippt (Terminal-Look); nimmt keinen Fokus, blockiert nichts. */
function funLine(el) {
  clearInterval(funTimer);
  const text = '> Ah ah ah, you didn’t write the magic word!', typed = h('span', {}), cur = h('u', {});
  fill(el, typed, cur);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { typed.textContent = text; cur.remove(); return; }
  let i = 0;
  funTimer = setInterval(() => { typed.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(funTimer); }, 32);
}

async function loadAuth() {
  try { S.auth = await (await fetch('/api/auth/state')).json(); } catch (e) { S.auth = {enabled: false, authenticated: true}; }
  return S.auth;
}

function updateAuthUI() {
  const on = !!(S.auth && S.auth.enabled && S.auth.authenticated);
  $('#logoutBtn').classList.toggle('hidden', !on);
}

async function logout() {
  try { await api('/api/auth/logout', {}); } catch (e) { /* trotzdem neu laden */ }
  location.hash = '';
  location.reload();
}

function showLogin(note) {
  if (S.view === 'login') return;
  S.view = 'login';
  clearInterval(S.pollTimer);
  document.body.classList.add('loginmode');
  ['#viewMain', '#viewSettings', '#viewRename', '#viewLogs', '#viewHistory'].forEach(s => $(s).classList.add('hidden'));
  $('#foot').replaceChildren();
  // zuletzt benutzte Farbe (der Server liefert vor der Anmeldung keine Einstellungen)
  try {
    const hue = +localStorage.getItem('p5hue');
    if (Number.isFinite(hue) && hue >= 0 && localStorage.getItem('p5hue') !== null) {
      const t = themeOf(hue), st = document.documentElement.style;
      st.setProperty('--h', hue); st.setProperty('--sat', t.sat + '%'); st.setProperty('--lit', t.lit + '%');
    }
  } catch (e) { /* Standardfarbe */ }

  const user = h('input', {type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: false, 'aria-label': 'Benutzername', required: true});
  const funEl = h('div', {class: 'funline', 'aria-live': 'polite'});
  const pass = h('input', {type: 'password', name: 'password', autocomplete: 'current-password', 'aria-label': 'Passwort', required: true,
    oninput: () => { clearInterval(funTimer); funEl.replaceChildren(); }});
  const remember = h('input', {type: 'checkbox', checked: true});
  const err = h('div', {class: 'status bad', role: 'alert', hidden: true});
  const go = h('button', {class: 'primary', type: 'submit', style: 'width:100%;justify-content:center'}, 'Anmelden');
  const form = h('form', {class: 'logincard', onsubmit: async e => {
    e.preventDefault(); err.hidden = true; go.disabled = true;
    try {
      await api('/api/auth/login', {username: user.value, password: pass.value, remember: remember.checked});
      clearInterval(funTimer);
      location.hash = '';
      location.reload();
    } catch (ex) {
      err.hidden = false; err.textContent = ex.message; go.disabled = false;
      if (ex.status === 401) { pass.value = ''; pass.focus(); if (!S.auth || S.auth.fun !== false) funLine(funEl); }   // Fokus bleibt im Feld: gleich nochmal tippen
    }
  }},
    h('div', {class: 'logo'}, h('i', {class: 'logomark', 'aria-hidden': 'true'}, 'p5'), h('span', {}, 'converter', h('u', {}, '_'))),
    h('h1', {}, 'Anmeldung'),
    h('p', {class: 'hint muted'}, note || 'Bitte melde dich an, um p5converter zu nutzen.'),
    h('label', {class: 'f'}, h('span', {class: 'lt'}, 'Benutzername'), user),
    h('label', {class: 'f'}, h('span', {class: 'lt'}, 'Passwort'), pass),
    funEl,
    h('label', {class: 'check'}, remember, 'Angemeldet bleiben (30 Tage)'),
    err, go,
    h('details', {class: 'diag', style: 'margin-top:18px'}, h('summary', {}, 'Passwort vergessen?'), h('div', {class: 'hint muted small'},
      'Das geht nur mit Zugriff auf den Server. Eine dieser Möglichkeiten:',
      h('ol', {}, h('li', {}, 'Im Container ausführen: ', h('code', {}, 'docker exec -it p5converter p5converter auth reset'), ' (die Anmeldung wird zurückgesetzt).'),
        h('li', {}, 'Die Variable ', h('code', {}, 'P5_AUTH_RESET=1'), ' setzen und den Container neu starten (danach wieder entfernen).'),
        h('li', {}, 'Die Datei ', h('code', {}, '/config/auth.json'), ' löschen.')))));
  const root = $('#viewLogin');
  root.classList.remove('hidden');
  fill(root, h('div', {class: 'login'}, form));
  loadAuth();
  user.focus();
}
