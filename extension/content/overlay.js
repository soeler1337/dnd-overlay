// Content Script - injected into dndbeyond.com/games/* pages.
// Renders the overlay UI; all data goes through the service worker via messages.

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

  toggleBtn.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  panel.querySelector('.dnd-panel-close').addEventListener('click', () => { panel.hidden = true; });

  root.appendChild(toggleBtn);
  root.appendChild(panel);
  document.body.appendChild(root);

  // -------------------------------------------------------------------------
  // Panels - loaded as extension-page scripts via importShim workaround.
  // Because content scripts can't use ES module imports, we load panel scripts
  // as regular <script type="module"> tags injected into a shadow container.
  // They communicate back via custom events on the root element.
  // -------------------------------------------------------------------------
  const body = document.getElementById('dnd-panel-body');

  async function init() {
    const resp = await chrome.runtime.sendMessage({ type: 'AUTH_GET_SESSION' });

    if (resp.error) {
      body.innerHTML = `<p class="dnd-error">Fehler: ${escHtml(resp.error)}</p>`;
      return;
    }

    if (!resp.session) {
      renderLogin();
    } else {
      renderApp(resp.session, resp.profile);
    }
  }

  // -- Login form (inline, no module import needed) --------------------------
  function renderLogin() {
    body.innerHTML = `
      <form id="dnd-login-form" novalidate>
        <div class="dnd-field">
          <label for="dnd-email">E-Mail</label>
          <input id="dnd-email" type="email" autocomplete="email" placeholder="spieler@example.com" />
        </div>
        <div class="dnd-field">
          <label for="dnd-password">Passwort</label>
          <input id="dnd-password" type="password" autocomplete="current-password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" />
        </div>
        <div id="dnd-login-error" class="dnd-error" hidden></div>
        <button type="submit" class="dnd-btn dnd-btn-primary" id="dnd-login-btn">Einloggen</button>
      </form>
    `;

    body.querySelector('#dnd-login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email    = body.querySelector('#dnd-email').value.trim();
      const password = body.querySelector('#dnd-password').value;
      const errEl    = body.querySelector('#dnd-login-error');
      const btnEl    = body.querySelector('#dnd-login-btn');

      errEl.hidden = true;
      btnEl.disabled = true;
      btnEl.textContent = 'Bitte warten...';

      if (!email || !password) {
        showErr(errEl, btnEl, 'Bitte E-Mail und Passwort eingeben.');
        return;
      }

      const resp = await chrome.runtime.sendMessage({ type: 'AUTH_SIGN_IN', email, password });

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

  // -- Main app view ---------------------------------------------------------
  function renderApp(session, profile) {
    const isDm   = profile?.role === 'dm';
    const name   = escHtml(profile?.display_name || session.user.email);
    const role   = isDm ? 'Dungeon Master' : 'Spieler';
    const badge  = isDm ? 'dm' : 'player';

    body.innerHTML = `
      <div class="dnd-welcome">
        <p>Willkommen, <strong>${name}</strong>!</p>
        <span class="dnd-role-badge ${badge}">${role}</span>
      </div>
      <hr class="dnd-divider" />
      <p class="dnd-placeholder">
        ${isDm
          ? 'Szenen-Schalter kommt in Milestone 3.'
          : 'Initiative und Handouts kommen in Milestone 5/6.'}
      </p>
      <button class="dnd-btn dnd-btn-secondary" id="dnd-logout-btn">Ausloggen</button>
    `;

    body.querySelector('#dnd-logout-btn').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'AUTH_SIGN_OUT' });
      renderLogin();
    });
  }

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------
  init();
})();
