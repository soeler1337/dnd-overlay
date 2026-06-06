// Content Script - injected into dndbeyond.com/games/* pages.

(function () {
  if (document.getElementById('dnd-overlay-root')) return;

  // -------------------------------------------------------------------------
  // DOM skeleton
  // -------------------------------------------------------------------------
  const root = document.createElement('div');
  root.id = 'dnd-overlay-root';

  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'dnd-overlay-toggle';
  toggleBtn.textContent = 'DnD';
  toggleBtn.title = 'DnD Overlay oeffnen / schliessen';

  const panel = document.createElement('div');
  panel.id = 'dnd-overlay-panel';
  panel.hidden = true;

  panel.innerHTML = `
    <div class="dnd-panel-header">
      <span class="dnd-panel-title">DnD Overlay</span>
      <button class="dnd-panel-close" title="Schliessen">&times;</button>
    </div>
    <div class="dnd-panel-body" id="dnd-panel-body">
      <p class="dnd-placeholder">Wird geladen...</p>
    </div>
  `;

  panel.querySelector('.dnd-panel-close').addEventListener('click', () => { panel.hidden = true; });

  root.appendChild(toggleBtn);
  root.appendChild(panel);
  document.body.appendChild(root);

  // -------------------------------------------------------------------------
  // Draggable toggle button
  // -------------------------------------------------------------------------
  (function makeDraggable() {
    // Restore saved position
    const saved = JSON.parse(localStorage.getItem('dnd-overlay-pos') || 'null');
    if (saved) {
      root.style.bottom = saved.bottom;
      root.style.right  = saved.right;
      root.style.top    = saved.top    || 'auto';
      root.style.left   = saved.left   || 'auto';
    }

    let dragging = false;
    let startX, startY, startRight, startBottom;

    toggleBtn.addEventListener('mousedown', (e) => {
      dragging = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = root.getBoundingClientRect();
      startRight  = window.innerWidth  - rect.right;
      startBottom = window.innerHeight - rect.bottom;

      const onMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        dragging = true;

        const newRight  = Math.max(0, startRight  - dx);
        const newBottom = Math.max(0, startBottom + dy);

        root.style.right  = newRight  + 'px';
        root.style.bottom = newBottom + 'px';
        root.style.left   = 'auto';
        root.style.top    = 'auto';
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (dragging) {
          localStorage.setItem('dnd-overlay-pos', JSON.stringify({
            right:  root.style.right,
            bottom: root.style.bottom,
            left:   'auto',
            top:    'auto',
          }));
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    toggleBtn.addEventListener('click', (e) => {
      if (dragging) { e.preventDefault(); return; }
      panel.hidden = !panel.hidden;
    });
  })();

  // -------------------------------------------------------------------------
  // Auth & panels
  // -------------------------------------------------------------------------
  const body = document.getElementById('dnd-panel-body');

  async function init() {
    const resp = await chrome.runtime.sendMessage({ type: 'AUTH_GET_SESSION' });
    if (resp.error) {
      body.innerHTML = `<p class="dnd-error">Fehler: ${esc(resp.error)}</p>`;
      return;
    }
    resp.session ? renderApp(resp.session, resp.profile) : renderLogin();
  }

  // -- Login -----------------------------------------------------------------
  function renderLogin() {
    body.innerHTML = `
      <form id="dnd-login-form" novalidate>
        <div class="dnd-field">
          <label for="dnd-user">Benutzername</label>
          <input id="dnd-user" type="text" autocomplete="username" placeholder="soeler" />
        </div>
        <div class="dnd-field">
          <label for="dnd-password">Passwort</label>
          <input id="dnd-password" type="password" autocomplete="current-password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;" />
        </div>
        <div id="dnd-login-error" class="dnd-error" hidden></div>
        <button type="submit" class="dnd-btn dnd-btn-primary" id="dnd-login-btn">Einloggen</button>
      </form>
    `;

    body.querySelector('#dnd-login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = body.querySelector('#dnd-user').value.trim().toLowerCase();
      const password = body.querySelector('#dnd-password').value;
      const errEl    = body.querySelector('#dnd-login-error');
      const btnEl    = body.querySelector('#dnd-login-btn');

      errEl.hidden = true;
      btnEl.disabled = true;
      btnEl.textContent = 'Bitte warten...';

      if (!username || !password) {
        showErr(errEl, btnEl, 'Bitte Benutzername und Passwort eingeben.');
        return;
      }

      const resp = await chrome.runtime.sendMessage({
        type: 'AUTH_SIGN_IN',
        email: username + '@dnd-overlay.local',
        password,
      });

      if (resp.error) {
        showErr(errEl, btnEl, resp.error);
        return;
      }

      renderApp(resp.session, resp.profile);
    });
  }

  function showErr(errEl, btnEl, msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
    btnEl.disabled = false;
    btnEl.textContent = 'Einloggen';
  }

  // -- App view --------------------------------------------------------------
  function renderApp(session, profile) {
    const isDm  = profile?.role === 'dm';
    const name  = esc(profile?.display_name || profile?.username || session.user.email);
    const role  = isDm ? 'Dungeon Master' : 'Spieler';
    const badge = isDm ? 'dm' : 'player';

    body.innerHTML = `
      <div class="dnd-welcome">
        <p>Willkommen, <strong>${name}</strong>!</p>
        <span class="dnd-role-badge ${badge}">${role}</span>
      </div>
      <hr class="dnd-divider" />
      <p class="dnd-placeholder">
        ${isDm ? 'Szenen-Schalter kommt in Milestone 3.' : 'Initiative und Handouts kommen in Milestone 5/6.'}
      </p>
      <button class="dnd-btn dnd-btn-secondary" id="dnd-logout-btn">Ausloggen</button>
    `;

    body.querySelector('#dnd-logout-btn').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'AUTH_SIGN_OUT' });
      renderLogin();
    });
  }

  function esc(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  init();
})();
