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
  toggleBtn.title = 'DnD Overlay';

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
  // Background overlay (shown when DM activates a scene with a background)
  // -------------------------------------------------------------------------
  const bgOverlay = document.createElement('div');
  bgOverlay.id = 'dnd-bg-overlay';
  document.body.appendChild(bgOverlay);

  function setBackground(url, opacity) {
    if (url) {
      bgOverlay.style.backgroundImage = `url(${JSON.stringify(url)})`;
      bgOverlay.style.setProperty('--bg-opacity', opacity ?? 0.5);
      bgOverlay.classList.add('active');
    } else {
      bgOverlay.classList.remove('active');
    }
  }

  // -------------------------------------------------------------------------
  // Draggable toggle button
  // -------------------------------------------------------------------------
  (function makeDraggable() {
    const saved = JSON.parse(localStorage.getItem('dnd-overlay-pos') || 'null');
    if (saved) {
      root.style.bottom = saved.bottom;
      root.style.right  = saved.right;
      root.style.top    = saved.top  || 'auto';
      root.style.left   = saved.left || 'auto';
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
        root.style.right  = Math.max(0, startRight  - dx) + 'px';
        root.style.bottom = Math.max(0, startBottom + dy) + 'px';
        root.style.left = root.style.top = 'auto';
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (dragging) {
          localStorage.setItem('dnd-overlay-pos', JSON.stringify({
            right: root.style.right, bottom: root.style.bottom, left: 'auto', top: 'auto',
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
  // Realtime messages from service worker
  // -------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SCENE_CHANGED') applyScene(msg.scene);
  });

  function applyScene(scene) {
    setBackground(scene.background_url || null, scene.bg_opacity ?? (scene.is_combat ? 0.25 : 0.5));
    // Audio handled in Milestone 4
    // Update active-scene indicator in DM panel if open
    document.querySelectorAll('.dnd-scene-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sceneId === scene.id);
    });
  }

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
        showErr(errEl, btnEl, 'Bitte Benutzername und Passwort eingeben.'); return;
      }

      const resp = await chrome.runtime.sendMessage({
        type: 'AUTH_SIGN_IN', email: username + '@dnd-overlay.local', password,
      });

      if (resp.error) { showErr(errEl, btnEl, resp.error); return; }
      renderApp(resp.session, resp.profile);
    });
  }

  function showErr(errEl, btnEl, msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
    btnEl.disabled = false;
    btnEl.textContent = 'Einloggen';
  }

  // -- App -------------------------------------------------------------------
  function renderApp(session, profile) {
    const isDm = profile?.role === 'dm';
    isDm ? renderDm(profile) : renderPlayer(profile, session);
  }

  // -- DM view ---------------------------------------------------------------
  async function renderDm(profile) {
    body.innerHTML = `
      <div class="dnd-welcome">
        <strong>${esc(profile.display_name || profile.username)}</strong>
        <span class="dnd-role-badge dm">DM</span>
      </div>
      <hr class="dnd-divider" />
      <div id="dnd-scenes-container">
        <p class="dnd-placeholder">Szenen werden geladen...</p>
      </div>
      <hr class="dnd-divider" />
      <button class="dnd-btn dnd-btn-secondary" id="dnd-logout-btn">Ausloggen</button>
    `;

    body.querySelector('#dnd-logout-btn').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'AUTH_SIGN_OUT' });
      setBackground(null);
      renderLogin();
    });

    const [scenesResp, sessionResp] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'SCENES_LIST', campaignId: profile.campaign_id }),
      chrome.runtime.sendMessage({ type: 'SESSION_GET', campaignId: profile.campaign_id }),
    ]);

    renderSceneButtons(
      scenesResp.scenes || [],
      sessionResp.session?.active_scene_id || null,
      profile.campaign_id
    );
  }

  function renderSceneButtons(scenes, activeSceneId, campaignId) {
    const container = document.getElementById('dnd-scenes-container');
    if (!container) return;

    if (!scenes.length) {
      container.innerHTML = `
        <p class="dnd-placeholder">Noch keine Szenen. Lege Ordner in<br><code>content/scenes/</code> an und starte den Watcher.</p>
      `;
      return;
    }

    container.innerHTML = `<p class="dnd-section-label">Szene auswaehlen</p>`;

    scenes.forEach(scene => {
      const btn = document.createElement('button');
      btn.className = 'dnd-btn dnd-scene-btn' + (scene.id === activeSceneId ? ' active' : '');
      btn.dataset.sceneId = scene.id;
      btn.textContent = (scene.is_combat ? '⚔ ' : '🏕 ') + scene.name;

      btn.addEventListener('click', async () => {
        document.querySelectorAll('.dnd-scene-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        await chrome.runtime.sendMessage({
          type: 'SCENE_SWITCH', sceneId: scene.id, campaignId,
        });

        // Apply locally immediately (don't wait for realtime echo)
        applyScene(scene);
      });

      container.appendChild(btn);
    });
  }

  // -- Player view -----------------------------------------------------------
  function renderPlayer(profile, session) {
    body.innerHTML = `
      <div class="dnd-welcome">
        <strong>${esc(profile.display_name || profile.username)}</strong>
        <span class="dnd-role-badge player">Spieler</span>
      </div>
      <hr class="dnd-divider" />
      <p class="dnd-placeholder">Der DM steuert das Geschehen.<br>Aenderungen erscheinen automatisch.</p>
      <hr class="dnd-divider" />
      <button class="dnd-btn dnd-btn-secondary" id="dnd-logout-btn">Ausloggen</button>
    `;

    body.querySelector('#dnd-logout-btn').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'AUTH_SIGN_OUT' });
      setBackground(null);
      renderLogin();
    });
  }

  function esc(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  init();
})();
