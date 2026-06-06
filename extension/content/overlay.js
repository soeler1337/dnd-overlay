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

  // Animated overlay (GIF on top of background, e.g. rain)
  const gifOverlay = document.createElement('div');
  gifOverlay.id = 'dnd-gif-overlay';
  document.body.appendChild(gifOverlay);

  // Restore saved left offset (protects character sheet sidebar)
  chrome.storage.local.get('dnd-left-offset', (r) => {
    const offset = r['dnd-left-offset'] ?? 270;
    bgOverlay.style.left  = offset + 'px';
    gifOverlay.style.left = offset + 'px';
  });

  function setBackground(url, opacity) {
    if (url) {
      bgOverlay.style.backgroundImage = `url(${JSON.stringify(url)})`;
      bgOverlay.style.setProperty('--bg-opacity', opacity ?? 0);
      bgOverlay.classList.add('active');
    } else {
      bgOverlay.classList.remove('active');
    }
  }

  function setLeftOffset(px) {
    bgOverlay.style.left  = px + 'px';
    gifOverlay.style.left = px + 'px';
    chrome.storage.local.set({ 'dnd-left-offset': px });
  }

  // -------------------------------------------------------------------------
  // Handout viewer system
  // -------------------------------------------------------------------------
  const tabsContainer = document.createElement('div');
  tabsContainer.id = 'dnd-handout-tabs';
  document.body.appendChild(tabsContainer);

  const openViewers = {}; // handoutId -> { viewer, zoom, panX, panY }

  function openHandoutViewer(handout) {
    if (openViewers[handout.id]) {
      // Restore if minimized
      const state = openViewers[handout.id];
      state.viewer.hidden = false;
      const tab = tabsContainer.querySelector(`[data-handout-id="${handout.id}"]`);
      if (tab) tab.remove();
      return;
    }

    const state = { zoom: 1, panX: 0, panY: 0, dragging: false };
    const viewer = document.createElement('div');
    viewer.className = 'dnd-handout-viewer';
    // Stagger new windows slightly
    const offset = Object.keys(openViewers).length * 30;
    viewer.style.top   = (80  + offset) + 'px';
    viewer.style.left  = (300 + offset) + 'px';
    viewer.style.width  = '480px';
    viewer.style.height = '380px';

    // Notes handout: render markdown instead of image
    const isNotes = handout.type === 'notes';

    viewer.innerHTML = `
      <div class="dnd-hv-header">
        <span class="dnd-hv-title">${esc(handout.title)}</span>
        <button class="dnd-hv-btn dnd-hv-minimize" title="Minimieren">&#8722;</button>
        <button class="dnd-hv-btn dnd-hv-close" title="Schliessen">&times;</button>
      </div>
      ${isNotes ? `
        <div class="dnd-hv-body dnd-hv-notes-body">
          <div class="dnd-notes-rendered">${renderMarkdown(handout.content || '')}</div>
        </div>
      ` : `
        <div class="dnd-hv-body">
          <div class="dnd-hv-img-wrap">
            <img class="dnd-hv-img" src="${handout.file_url}" alt="${esc(handout.title)}" draggable="false" />
          </div>
        </div>
        <div class="dnd-hv-zoom-bar">
          <button class="dnd-hv-zoom-btn dnd-hv-zoom-out" title="Verkleinern">&#8722;</button>
          <span class="dnd-hv-zoom-label">100%</span>
          <button class="dnd-hv-zoom-btn dnd-hv-zoom-in" title="Vergrossern">+</button>
          <button class="dnd-hv-zoom-btn" style="margin-left:auto" title="Auf Fenster einpassen">&#9635;</button>
        </div>
      `}
      <div class="dnd-hv-resize" title="Groesse aendern"></div>
    `;

    document.body.appendChild(viewer);
    openViewers[handout.id] = { viewer, ...state };

    // Mirror to stream overlay (DM only, images only)
    if (window._dndIsDm && !isNotes && handout.file_url && window._dndCampaignId) {
      chrome.runtime.sendMessage({
        type: 'HANDOUT_STREAM',
        url: handout.file_url,
        title: handout.title,
        campaignId: window._dndCampaignId,
      });
    }

    if (!isNotes) {
      const img       = viewer.querySelector('.dnd-hv-img');
      const zoomLabel = viewer.querySelector('.dnd-hv-zoom-label');
      const imgWrap   = viewer.querySelector('.dnd-hv-img-wrap');

      function applyTransform() {
        const s = openViewers[handout.id];
        img.style.transform = `translate(${s.panX}px, ${s.panY}px) scale(${s.zoom})`;
        zoomLabel.textContent = Math.round(s.zoom * 100) + '%';
      }

      function setZoom(delta) {
        const s = openViewers[handout.id];
        s.zoom  = Math.max(0.1, Math.min(8, s.zoom + delta));
        applyTransform();
      }

      // Zoom buttons
      viewer.querySelector('.dnd-hv-zoom-in').addEventListener('click',  () => setZoom(+0.25));
      viewer.querySelector('.dnd-hv-zoom-out').addEventListener('click', () => setZoom(-0.25));

      // Fit-to-window button
      viewer.querySelectorAll('.dnd-hv-zoom-btn')[2].addEventListener('click', () => {
        const s     = openViewers[handout.id];
        const wW    = imgWrap.clientWidth;
        const wH    = imgWrap.clientHeight;
        const iW    = img.naturalWidth  || img.clientWidth;
        const iH    = img.naturalHeight || img.clientHeight;
        s.zoom      = Math.min(wW / iW, wH / iH, 1);
        s.panX      = 0;
        s.panY      = 0;
        applyTransform();
      });

      // Mouse-wheel zoom
      imgWrap.addEventListener('wheel', (e) => {
        e.preventDefault();
        setZoom(e.deltaY < 0 ? +0.15 : -0.15);
      }, { passive: false });

      // Pan (drag image)
      let panStart = null;
      imgWrap.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        panStart = { x: e.clientX, y: e.clientY,
          px: openViewers[handout.id].panX, py: openViewers[handout.id].panY };
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!panStart || !openViewers[handout.id]) return;
        if (!viewer.contains(imgWrap)) return;
        const s = openViewers[handout.id];
        s.panX  = panStart.px + (e.clientX - panStart.x);
        s.panY  = panStart.py + (e.clientY - panStart.y);
        applyTransform();
      });
      document.addEventListener('mouseup', () => { panStart = null; });
    }

    // Drag window by header
    makeDraggableEl(viewer, viewer.querySelector('.dnd-hv-header'));

    // Resize by corner
    makeResizableEl(viewer, viewer.querySelector('.dnd-hv-resize'));

    // Minimize
    viewer.querySelector('.dnd-hv-minimize').addEventListener('click', () => {
      viewer.hidden = true;
      const tab = document.createElement('div');
      tab.className = 'dnd-handout-tab';
      tab.dataset.handoutId = handout.id;
      tab.innerHTML = `${esc(handout.title)}<button class="dnd-handout-tab-close" title="Schliessen">&times;</button>`;
      tab.addEventListener('click', (e) => {
        if (e.target.classList.contains('dnd-handout-tab-close')) {
          closeViewer(handout.id);
          tab.remove();
          return;
        }
        viewer.hidden = false;
        tab.remove();
      });
      tabsContainer.appendChild(tab);
    });

    // Close
    viewer.querySelector('.dnd-hv-close').addEventListener('click', () => {
      closeViewer(handout.id);
    });
  }

  function closeViewer(handoutId) {
    const state = openViewers[handoutId];
    if (!state) return;
    state.viewer.remove();
    delete openViewers[handoutId];
    const tab = tabsContainer.querySelector(`[data-handout-id="${handoutId}"]`);
    if (tab) tab.remove();
    // Clear stream mirror if this was the last open image viewer
    if (window._dndIsDm && window._dndCampaignId) {
      const anyImageOpen = Object.values(openViewers).some(v =>
        v.viewer.querySelector('.dnd-hv-img'));
      if (!anyImageOpen) {
        chrome.runtime.sendMessage({
          type: 'HANDOUT_STREAM', url: null, title: null,
          campaignId: window._dndCampaignId,
        });
      }
    }
  }

  // Update notes viewer content if open
  function updateNotesViewer(content) {
    for (const id of Object.keys(openViewers)) {
      const state = openViewers[id];
      const rendered = state.viewer.querySelector('.dnd-notes-rendered');
      if (rendered) {
        rendered.innerHTML = renderMarkdown(content);
      }
    }
  }

  function makeDraggableEl(el, handle) {
    let sx, sy, sl, st;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect();
      sl = r.left; st = r.top;
      e.preventDefault();
      const onMove = (e) => {
        el.style.left = Math.max(0, sl + e.clientX - sx) + 'px';
        el.style.top  = Math.max(0, st + e.clientY - sy) + 'px';
        el.style.right = el.style.bottom = 'auto';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function makeResizableEl(el, handle) {
    handle.addEventListener('mousedown', (e) => {
      const startX = e.clientX, startY = e.clientY;
      const startW = el.offsetWidth, startH = el.offsetHeight;
      e.preventDefault(); e.stopPropagation();
      const onMove = (e) => {
        el.style.width  = Math.max(260, startW + e.clientX - startX) + 'px';
        el.style.height = Math.max(180, startH + e.clientY - startY) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // -------------------------------------------------------------------------
  // Simple Markdown renderer (no external dependency)
  // -------------------------------------------------------------------------
  function renderMarkdown(md) {
    if (!md) return '';
    let html = md
      // Escape HTML first
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // Headers
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Bold / italic
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Horizontal rule
      .replace(/^---$/gm, '<hr/>')
      // Unordered list items
      .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
      // Wrap consecutive <li> in <ul>
      .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
      // Paragraphs: blank line = new paragraph
      .replace(/\n\n+/g, '</p><p>')
      .replace(/\n/g, '<br/>');
    return '<p>' + html + '</p>';
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

  // Initiative state tracked globally so applyWeather() can respect it.
  let combatActive = false;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SCENE_CHANGED') {
      combatActive = !!msg.isCombat;
      applyScene(msg.scene, msg.isCombat);
    }
    if (msg.type === 'WEATHER_CHANGED') applyWeather(msg.preset);
    if (msg.type === 'SOUND_PLAY') {
      // Players play the one-shot locally (SW already plays for DM via offscreen)
      const sfx = new Audio(msg.url);
      sfx.volume = msg.volume ?? 0.9;
      sfx.play().catch(() => {});
    }
    if (msg.type === 'NOTES_CHANGED') {
      updateNotesViewer(msg.content);
      // Update DM notes editor value if present
      const editor = document.getElementById('dnd-notes-editor');
      if (editor) editor.value = msg.content;
      // Update player notes rendered view
      const rendered = document.getElementById('dnd-notes-rendered');
      if (rendered) rendered.innerHTML = renderMarkdown(msg.content);
    }
  });

  // Feature 2: opacity is always 1 or 0, never a float.
  // Combat always forces 0. Toggle stored in scene.bg_opacity (>0 = on, 0 = off).
  function applyScene(scene, isCombat) {
    combatActive = !!isCombat;
    const opacity = isCombat ? 0 : (scene.bg_opacity > 0 ? 1 : 0);
    setBackground(scene.background_url || null, opacity);

    // Update active-scene indicator in DM panel if open
    document.querySelectorAll('.dnd-scene-row').forEach(row => {
      row.classList.toggle('active', row.dataset.sceneId === scene.id);
    });

    // Update opacity toggles in scene rows
    document.querySelectorAll('.dnd-scene-toggle').forEach(btn => {
      if (btn.dataset.sceneId === scene.id) {
        const on = scene.bg_opacity > 0;
        btn.textContent = on ? 'AN' : 'AUS';
        btn.classList.toggle('on', on);
        btn.classList.toggle('off', !on);
      }
    });
  }

  // Initiative always wins: gif overlay hidden during combat.
  function applyWeather(preset) {
    // Update dropdown UI regardless of combat state
    document.querySelectorAll('.dnd-weather-select').forEach(sel => {
      sel.value = preset?.id || '';
    });
    if (combatActive) return; // initiative > wetter
    if (preset?.gif_url) {
      gifOverlay.style.backgroundImage = `url(${JSON.stringify(preset.gif_url)})`;
      gifOverlay.style.left = bgOverlay.style.left || '270px';
      gifOverlay.classList.add('active');
    } else {
      gifOverlay.classList.remove('active');
    }
  }

  // -------------------------------------------------------------------------
  // Auth & panels
  // -------------------------------------------------------------------------
  const body = document.getElementById('dnd-panel-body');

  // Extract DnD Beyond game ID from current URL (dndbeyond.com/games/5570639)
  const gameIdMatch = window.location.pathname.match(/\/games\/(\d+)/);
  const currentGameId = gameIdMatch ? gameIdMatch[1] : null;

  async function init() {
    const resp = await chrome.runtime.sendMessage({
      type: 'AUTH_GET_SESSION',
      gameId: currentGameId,
    });
    if (resp.error) {
      body.innerHTML = `<p class="dnd-error">Fehler: ${esc(resp.error)}</p>`;
      return;
    }
    resp.session ? renderApp(resp.session, resp.profile) : renderLogin();
  }

  // -- Login -----------------------------------------------------------------
  async function renderLogin() {
    // Try to load quick-login accounts from accounts.json
    let accounts = [];
    try {
      const r = await fetch(chrome.runtime.getURL('accounts.json'));
      accounts = await r.json();
      // Filter out placeholder entries with empty passwords
      accounts = accounts.filter(a => a.username && a.password);
    } catch { /* no accounts.json or parse error - fall back to manual */ }

    if (accounts.length) {
      body.innerHTML = `
        <div class="dnd-field">
          <label for="dnd-account-select">Konto auswaehlen</label>
          <select id="dnd-account-select" class="dnd-account-select">
            <option value="" disabled selected>â€” Wer bist du? â€”</option>
            ${accounts.map((a, i) => `<option value="${i}">${esc(a.label)}</option>`).join('')}
          </select>
        </div>
        <div id="dnd-login-error" class="dnd-error" hidden></div>
        <button class="dnd-btn dnd-btn-primary" id="dnd-login-btn" disabled>Einloggen</button>
        <button class="dnd-btn dnd-btn-secondary" id="dnd-manual-login-btn" style="font-size:11px;margin-top:8px">Manuell einloggen</button>
      `;

      const select = body.querySelector('#dnd-account-select');
      const btnEl  = body.querySelector('#dnd-login-btn');
      const errEl  = body.querySelector('#dnd-login-error');

      select.addEventListener('change', () => {
        btnEl.disabled = select.value === '';
      });

      btnEl.addEventListener('click', async () => {
        const account = accounts[parseInt(select.value)];
        errEl.hidden  = true;
        btnEl.disabled = true;
        btnEl.textContent = 'Bitte warten...';

        const resp = await chrome.runtime.sendMessage({
          type: 'AUTH_SIGN_IN',
          email: account.username + '@dnd-overlay.local',
          password: account.password,
          gameId: currentGameId,
        });

        if (resp.error) {
          errEl.textContent = resp.error;
          errEl.hidden = false;
          btnEl.disabled = false;
          btnEl.textContent = 'Einloggen';
          return;
        }
        renderApp(resp.session, resp.profile);
      });

      body.querySelector('#dnd-manual-login-btn').addEventListener('click', renderManualLogin);
    } else {
      renderManualLogin();
    }
  }

  function renderManualLogin() {
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
        errEl.textContent = 'Bitte Benutzername und Passwort eingeben.';
        errEl.hidden = false;
        btnEl.disabled = false;
        btnEl.textContent = 'Einloggen';
        return;
      }

      const resp = await chrome.runtime.sendMessage({
        type: 'AUTH_SIGN_IN', email: username + '@dnd-overlay.local', password,
        gameId: currentGameId,
      });

      if (resp.error) {
        errEl.textContent = resp.error;
        errEl.hidden = false;
        btnEl.disabled = false;
        btnEl.textContent = 'Einloggen';
        return;
      }
      renderApp(resp.session, resp.profile);
    });
  }

  // -- App -------------------------------------------------------------------
  async function renderApp(session, profile) {
    const isDm = profile?.role === 'dm';
    window._dndIsDm          = isDm;
    window._dndCampaignId    = profile?.campaign_id ?? null;
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
      <div id="dnd-initiative-bar">
        <button class="dnd-btn dnd-initiative-btn" id="dnd-initiative-btn" data-active="false">
          &#x2694; Initiative starten
        </button>
      </div>
      <div id="dnd-weather-bar" style="margin-top:8px">
        <div class="dnd-music-row">
          <span class="dnd-opacity-label">&#127783; Wetter</span>
          <select class="dnd-weather-select" id="dnd-global-weather-select">
            <option value="">â€” keins â€”</option>
          </select>
        </div>
      </div>
      <hr class="dnd-divider" />
      <div id="dnd-scenes-container">
        <p class="dnd-placeholder">Szenen werden geladen...</p>
      </div>
      <hr class="dnd-divider" />
      <div id="dnd-handouts-container"></div>
      <hr class="dnd-divider" />
      <div id="dnd-sounds-container"></div>
      <hr class="dnd-divider" />
      <div id="dnd-notes-container">
        <p class="dnd-section-label">Notizen
          <button class="dnd-btn-refresh" id="dnd-notes-refresh" title="Notizen neu laden">&#8635;</button>
        </p>
        <textarea id="dnd-notes-editor" class="dnd-notes-editor" placeholder="Markdown wird unterstuetzt..."></textarea>
        <button class="dnd-btn dnd-btn-primary" id="dnd-notes-save" style="margin-top:6px">Speichern &amp; teilen</button>
      </div>
      <hr class="dnd-divider" />
      <div id="dnd-music-controls">
        <p class="dnd-section-label">Musik</p>
        <div class="dnd-music-row">
          <button class="dnd-btn dnd-music-btn" id="dnd-music-play" title="Play">&#9654;</button>
          <button class="dnd-btn dnd-music-btn" id="dnd-music-stop" title="Stop">&#9646;&#9646;</button>
          <input type="range" id="dnd-volume-slider" class="dnd-opacity-slider"
            min="0" max="1" step="0.05" value="0.8" />
          <span class="dnd-opacity-val" id="dnd-volume-val">80%</span>
        </div>
        <div class="dnd-music-row" style="margin-top:4px">
          <span class="dnd-opacity-label" style="white-space:nowrap">&#127783; Wetter</span>
          <input type="range" id="dnd-weather-volume-slider" class="dnd-opacity-slider"
            min="0" max="1" step="0.05" value="0.3" />
          <span class="dnd-opacity-val" id="dnd-weather-volume-val">30%</span>
        </div>
        <div class="dnd-music-row" style="margin-top:6px">
          <span class="dnd-opacity-label" style="white-space:nowrap;font-size:11px;color:#6a6050">
            &#127925; Standard via<br><code>default/</code>-Ordner
          </span>
          <span id="dnd-default-music-status" style="font-size:10px;color:#6a6050;flex:1;text-align:right">
            wird geladen...
          </span>
        </div>
      </div>
      <hr class="dnd-divider" />
      <div id="dnd-layout-controls">
        <p class="dnd-section-label">Layout</p>
        <div class="dnd-music-row">
          <span class="dnd-opacity-label">Char-Sheet<br>Schutz</span>
          <input type="range" id="dnd-left-offset-slider" class="dnd-opacity-slider"
            min="0" max="600" step="10" value="270" />
          <span class="dnd-opacity-val" id="dnd-left-offset-val">270px</span>
        </div>
      </div>
      <hr class="dnd-divider" />
      <button class="dnd-btn dnd-btn-secondary" id="dnd-logout-btn">Ausloggen</button>
    `;

    // --- Feature 1: Restore saved volumes ---
    chrome.storage.local.get(['dnd-music-vol', 'dnd-weather-vol', 'dnd-left-offset'], (r) => {
      const musicVol   = r['dnd-music-vol']   ?? 0.8;
      const weatherVol = r['dnd-weather-vol'] ?? 0.3;
      const offset     = r['dnd-left-offset'] ?? 270;

      const volSlider = body.querySelector('#dnd-volume-slider');
      if (volSlider) {
        volSlider.value = musicVol;
        body.querySelector('#dnd-volume-val').textContent = Math.round(musicVol * 100) + '%';
        chrome.runtime.sendMessage({ type: 'AUDIO_VOLUME', volume: musicVol });
      }
      const wVolSlider = body.querySelector('#dnd-weather-volume-slider');
      if (wVolSlider) {
        wVolSlider.value = weatherVol;
        body.querySelector('#dnd-weather-volume-val').textContent = Math.round(weatherVol * 100) + '%';
        chrome.runtime.sendMessage({ type: 'WEATHER_VOLUME', volume: weatherVol });
      }
      const offsetSlider = body.querySelector('#dnd-left-offset-slider');
      if (offsetSlider) {
        offsetSlider.value = offset;
        body.querySelector('#dnd-left-offset-val').textContent = offset + 'px';
      }
    });

    // Left offset slider
    const offsetSlider = body.querySelector('#dnd-left-offset-slider');
    const offsetVal    = body.querySelector('#dnd-left-offset-val');
    offsetSlider.addEventListener('input', () => {
      const px = parseInt(offsetSlider.value);
      offsetVal.textContent = px + 'px';
      setLeftOffset(px);
    });

    // Music volume slider â€“ Feature 1: persist
    const volSlider = body.querySelector('#dnd-volume-slider');
    const volVal    = body.querySelector('#dnd-volume-val');
    volSlider.addEventListener('input', () => {
      const v = parseFloat(volSlider.value);
      volVal.textContent = Math.round(v * 100) + '%';
      chrome.runtime.sendMessage({ type: 'AUDIO_VOLUME', volume: v });
      chrome.storage.local.set({ 'dnd-music-vol': v });
    });

    // Weather volume slider â€“ Feature 1: persist
    const weatherVolSlider = body.querySelector('#dnd-weather-volume-slider');
    const weatherVolVal    = body.querySelector('#dnd-weather-volume-val');
    weatherVolSlider.addEventListener('input', () => {
      const v = parseFloat(weatherVolSlider.value);
      weatherVolVal.textContent = Math.round(v * 100) + '%';
      chrome.runtime.sendMessage({ type: 'WEATHER_VOLUME', volume: v });
      chrome.storage.local.set({ 'dnd-weather-vol': v });
    });

    body.querySelector('#dnd-music-play').addEventListener('click', () => {
      const activeRow = body.querySelector('.dnd-scene-row.active');
      if (!activeRow) return;
      const sceneId   = activeRow.dataset.sceneId;
      const scene     = (window._dndScenes || []).find(s => s.id === sceneId);
      if (!scene) return;
      const isCombat  = body.querySelector('#dnd-initiative-btn')?.dataset.active === 'true';
      const vol       = parseFloat(body.querySelector('#dnd-volume-slider')?.value ?? 0.8);
      const url       = resolveAudioUrl(scene, isCombat);
      if (url) chrome.runtime.sendMessage({ type: 'AUDIO_PLAY', url, volume: vol });
    });

    body.querySelector('#dnd-music-stop').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'AUDIO_STOP' });
    });

    body.querySelector('#dnd-logout-btn').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'AUTH_SIGN_OUT' });
      setBackground(null);
      chrome.runtime.sendMessage({ type: 'AUDIO_STOP' });
      renderLogin();
    });

    const [scenesResp, sessionResp, weatherResp, handoutsResp, notesResp, defaultMusicResp, soundsResp] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'SCENES_LIST', campaignId: profile.campaign_id }),
      chrome.runtime.sendMessage({ type: 'SESSION_GET', campaignId: profile.campaign_id }),
      chrome.runtime.sendMessage({ type: 'WEATHER_PRESETS_LIST', campaignId: profile.campaign_id }),
      chrome.runtime.sendMessage({ type: 'HANDOUTS_LIST', campaignId: profile.campaign_id }),
      chrome.runtime.sendMessage({ type: 'NOTES_GET', campaignId: profile.campaign_id }),
      chrome.runtime.sendMessage({ type: 'DEFAULT_MUSIC_GET', campaignId: profile.campaign_id }),
      chrome.runtime.sendMessage({ type: 'SOUNDS_LIST', campaignId: profile.campaign_id }),
    ]);

    // Cache default music URLs for resolveAudioUrl()
    window._dndDefaultAmbient = defaultMusicResp.ambientUrl || null;
    window._dndDefaultCombat  = defaultMusicResp.combatUrl  || null;

    // Show status in UI
    const defStatus = body.querySelector('#dnd-default-music-status');
    if (defStatus) {
      const hasAmb = !!defaultMusicResp.ambientUrl;
      const hasCom = !!defaultMusicResp.combatUrl;
      defStatus.textContent = hasAmb || hasCom
        ? `${hasAmb ? 'âœ“ Ambient' : ''}${hasAmb && hasCom ? ' Â· ' : ''}${hasCom ? 'âœ“ Combat' : ''}`
        : 'Kein Standard hinterlegt';
      defStatus.style.color = hasAmb || hasCom ? '#7acc60' : '#6a6050';
    }

    const session        = sessionResp.session;
    const weatherPresets = weatherResp.presets || [];

    // --- Global weather dropdown ---
    const globalWeatherSel = body.querySelector('#dnd-global-weather-select');
    if (globalWeatherSel && weatherPresets.length) {
      weatherPresets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        globalWeatherSel.appendChild(opt);
      });
      // Pre-select weather of current active scene
      const activeScene = (scenesResp.scenes || []).find(s => s.id === session?.active_scene_id);
      if (activeScene?.weather_preset_id) globalWeatherSel.value = activeScene.weather_preset_id;

      globalWeatherSel.addEventListener('change', async () => {
        const presetId = globalWeatherSel.value;
        const preset   = weatherPresets.find(p => p.id === presetId) || null;
        // Find active scene to persist
        const activeRow = body.querySelector('.dnd-scene-row.active');
        const sceneId   = activeRow?.dataset.sceneId || null;
        if (sceneId) {
          const scene = (window._dndScenes || []).find(s => s.id === sceneId);
          if (scene) scene.weather_preset_id = presetId || null;
        }
        applyWeather(preset);
        const wVol = parseFloat(body.querySelector('#dnd-weather-volume-slider')?.value ?? 0.3);
        chrome.runtime.sendMessage({ type: 'WEATHER_SET', preset, sceneId, volume: wVol });
      });
    } else if (globalWeatherSel && !weatherPresets.length) {
      globalWeatherSel.style.display = 'none';
    }

    // --- Notes DM editor ---
    const notesEditor = body.querySelector('#dnd-notes-editor');
    notesEditor.value = notesResp.content || '';

    body.querySelector('#dnd-notes-save').addEventListener('click', async () => {
      const btn = body.querySelector('#dnd-notes-save');
      btn.disabled = true;
      btn.textContent = 'Speichern...';
      await chrome.runtime.sendMessage({
        type: 'NOTES_SAVE',
        campaignId: profile.campaign_id,
        content: notesEditor.value,
      });
      btn.disabled = false;
      btn.textContent = 'Speichern & teilen';
    });

    // Notes refresh
    body.querySelector('#dnd-notes-refresh').addEventListener('click', async () => {
      const r = await chrome.runtime.sendMessage({ type: 'NOTES_GET', campaignId: profile.campaign_id });
      notesEditor.value = r.content || '';
    });

    // Wire up initiative button
    const initBtn = body.querySelector('#dnd-initiative-btn');
    let isCombatActive = session?.is_combat ?? false;
    updateInitiativeBtn(initBtn, isCombatActive);

    initBtn.addEventListener('click', async () => {
      isCombatActive = !isCombatActive;
      combatActive   = isCombatActive; // sync global flag immediately
      updateInitiativeBtn(initBtn, isCombatActive);
      await chrome.runtime.sendMessage({
        type: 'INITIATIVE_TOGGLE', active: isCombatActive, campaignId: profile.campaign_id,
      });
      // Apply locally - find current active scene
      const activeRow = body.querySelector('.dnd-scene-row.active');
      if (activeRow) {
        const sceneId = activeRow.dataset.sceneId;
        const scene   = (scenesResp.scenes || []).find(s => s.id === sceneId);
        if (scene) {
          applyScene(scene, isCombatActive);
          const vol = parseFloat(body.querySelector('#dnd-volume-slider')?.value ?? 0.8);
          const url = resolveAudioUrl(scene, isCombatActive);
          if (url) chrome.runtime.sendMessage({ type: 'AUDIO_PLAY', url, volume: vol });
          else     chrome.runtime.sendMessage({ type: 'AUDIO_STOP' });
          // Initiative beendet: Wetter der aktiven Szene wieder anzeigen
          if (!isCombatActive) {
            const preset = weatherPresets.find(p => p.id === scene.weather_preset_id) || null;
            applyWeather(preset);
          } else {
            // Initiative gestartet: Wetter-GIF ausblenden
            gifOverlay.classList.remove('active');
          }
        }
      }
    });

    window._dndScenes = scenesResp.scenes || [];

    // --- Feature 3: Refresh buttons ---
    function doRefreshScenes() {
      chrome.runtime.sendMessage({ type: 'SCENES_LIST', campaignId: profile.campaign_id }).then(r => {
        window._dndScenes = r.scenes || [];
        renderSceneButtons(
          window._dndScenes,
          body.querySelector('.dnd-scene-row.active')?.dataset.sceneId || session?.active_scene_id || null,
          profile.campaign_id,
          combatActive,
          weatherPresets,
          doRefreshScenes,
        );
      });
    }

    function doRefreshHandouts() {
      chrome.runtime.sendMessage({ type: 'HANDOUTS_LIST', campaignId: profile.campaign_id }).then(r => {
        renderHandouts(r.handouts || [], doRefreshHandouts);
      });
    }

    renderSceneButtons(
      window._dndScenes,
      session?.active_scene_id || null,
      profile.campaign_id,
      session?.is_combat ?? false,
      weatherPresets,
      doRefreshScenes,
    );
    renderHandouts(handoutsResp.handouts || [], doRefreshHandouts);
    renderSoundboard(soundsResp.sounds || [], profile.campaign_id);
  }

  function updateInitiativeBtn(btn, active) {
    btn.dataset.active  = active;
    btn.textContent     = active ? 'âœ“ Initiative lÃ¤uft - Beenden' : 'âš” Initiative starten';
    btn.classList.toggle('combat-active', active);
  }

  // Feature 5: resolve audio URL with fallback to default music from DB
  function resolveAudioUrl(scene, isCombat) {
    const url = isCombat
      ? (scene.combat_url || scene.ambient_url)
      : scene.ambient_url;
    if (url) return url;
    // Fallback: default URLs loaded from campaigns table on DM panel init
    return isCombat
      ? (window._dndDefaultCombat || window._dndDefaultAmbient || null)
      : (window._dndDefaultAmbient || null);
  }

  function renderSceneButtons(scenes, activeSceneId, campaignId, isCombat, weatherPresets = [], onRefresh) {
    const container = document.getElementById('dnd-scenes-container');
    if (!container) return;

    if (!scenes.length) {
      container.innerHTML = `
        <p class="dnd-section-label">Szenen
          ${onRefresh ? `<button class="dnd-btn-refresh" id="dnd-scenes-refresh" title="Szenen aktualisieren">&#8635;</button>` : ''}
        </p>
        <p class="dnd-placeholder">Noch keine Szenen. Lege Ordner in<br><code>content/scenes/</code> an und starte den Watcher.</p>
      `;
      if (onRefresh) {
        container.querySelector('#dnd-scenes-refresh')?.addEventListener('click', onRefresh);
      }
      return;
    }

    container.innerHTML = `
      <p class="dnd-section-label">Szene auswaehlen
        ${onRefresh ? `<button class="dnd-btn-refresh" id="dnd-scenes-refresh" title="Szenen aktualisieren">&#8635;</button>` : ''}
      </p>
    `;

    if (onRefresh) {
      container.querySelector('#dnd-scenes-refresh')?.addEventListener('click', onRefresh);
    }

    scenes.forEach(scene => {
      const isActive = scene.id === activeSceneId;
      const bgOn     = scene.bg_opacity > 0;

      const wrap = document.createElement('div');
      wrap.className = 'dnd-scene-row' + (isActive ? ' active' : '');
      wrap.dataset.sceneId = scene.id;

      wrap.innerHTML = `
        <button class="dnd-scene-btn" data-scene-id="${scene.id}">
          ${scene.is_combat ? '&#x2694;' : '&#x1F3D5;'} ${esc(scene.name)}
        </button>
        <div class="dnd-opacity-row">
          <span class="dnd-opacity-label">Hintergrund</span>
          <button class="dnd-scene-toggle ${bgOn ? 'on' : 'off'}" data-scene-id="${scene.id}">
            ${bgOn ? 'AN' : 'AUS'}
          </button>
        </div>
      `;

      // Scene switch button
      wrap.querySelector('.dnd-scene-btn').addEventListener('click', async () => {
        document.querySelectorAll('.dnd-scene-row').forEach(r => r.classList.remove('active'));
        wrap.classList.add('active');
        await chrome.runtime.sendMessage({ type: 'SCENE_SWITCH', sceneId: scene.id, campaignId });
        const vol    = parseFloat(body.querySelector('#dnd-volume-slider')?.value ?? 0.8);
        const combat = combatActive;

        // Sync global weather dropdown to new scene's preset
        const gSel = body.querySelector('#dnd-global-weather-select');
        if (gSel) gSel.value = scene.weather_preset_id || '';

        if (combat) {
          // Initiative lÃ¤uft: nur Sound wechseln, Hintergrund + Wetter bleiben unsichtbar
          const audioUrl = resolveAudioUrl(scene, true);
          if (audioUrl) chrome.runtime.sendMessage({ type: 'AUDIO_PLAY', url: audioUrl, volume: vol });
          else          chrome.runtime.sendMessage({ type: 'AUDIO_STOP' });
          // Wetter in DB persistieren ohne visuellen Broadcast (wird beim Initiative-Ende aktiv)
          const preset = weatherPresets.find(p => p.id === scene.weather_preset_id) || null;
          chrome.runtime.sendMessage({ type: 'WEATHER_SET', preset, sceneId: scene.id });
        } else {
          applyScene(scene, false);
          const audioUrl = resolveAudioUrl(scene, false);
          if (audioUrl) chrome.runtime.sendMessage({ type: 'AUDIO_PLAY', url: audioUrl, volume: vol });
          else          chrome.runtime.sendMessage({ type: 'AUDIO_STOP' });
          // Wetter der neuen Szene anwenden
          const preset   = weatherPresets.find(p => p.id === scene.weather_preset_id) || null;
          const wVol     = parseFloat(body.querySelector('#dnd-weather-volume-slider')?.value ?? 0.3);
          applyWeather(preset);
          chrome.runtime.sendMessage({ type: 'WEATHER_SET', preset, sceneId: scene.id, volume: wVol });
        }
      });

      // Feature 2: Opacity toggle (AN/AUS)
      const toggleEl = wrap.querySelector('.dnd-scene-toggle');
      toggleEl.addEventListener('click', async () => {
        const newOn      = toggleEl.classList.contains('off'); // flipping
        const newOpacity = newOn ? 1 : 0;
        scene.bg_opacity = newOpacity;
        toggleEl.textContent = newOn ? 'AN' : 'AUS';
        toggleEl.classList.toggle('on', newOn);
        toggleEl.classList.toggle('off', !newOn);
        // Live update if active scene (and not combat)
        if (wrap.classList.contains('active') && !combatActive) {
          bgOverlay.style.setProperty('--bg-opacity', newOpacity);
        }
        await chrome.runtime.sendMessage({
          type: 'SCENE_UPDATE_OPACITY',
          sceneId: scene.id,
          opacity: newOpacity,
        });
      });

      container.appendChild(wrap);
    });
  }

  // -- renderSoundboard ------------------------------------------------------
  function renderSoundboard(sounds, campaignId) {
    const container = document.getElementById('dnd-sounds-container');
    if (!container) return;

    if (!sounds.length) {
      container.innerHTML = `
        <p class="dnd-section-label">Soundboard</p>
        <p class="dnd-placeholder">Keine Sounds. Lege <code>.mp3</code>-Dateien in<br><code>content/${campaignId.slice(0,8)}â€¦/sounds/</code> ab.</p>
      `;
      return;
    }

    container.innerHTML = `<p class="dnd-section-label">Soundboard</p>
      <div class="dnd-soundboard"></div>`;

    const grid = container.querySelector('.dnd-soundboard');
    const volKey = 'dnd-sfx-vol';

    // Volume row
    const volRow = document.createElement('div');
    volRow.className = 'dnd-music-row';
    volRow.style.marginBottom = '6px';
    volRow.innerHTML = `
      <span class="dnd-opacity-label">&#128266; Lautst.</span>
      <input type="range" class="dnd-opacity-slider" id="dnd-sfx-vol-slider" min="0" max="1" step="0.05" value="0.9" />
      <span class="dnd-opacity-val" id="dnd-sfx-vol-val">90%</span>
    `;
    container.insertBefore(volRow, grid);

    chrome.storage.local.get(volKey, (r) => {
      const v = r[volKey] ?? 0.9;
      volRow.querySelector('#dnd-sfx-vol-slider').value = v;
      volRow.querySelector('#dnd-sfx-vol-val').textContent = Math.round(v * 100) + '%';
    });
    volRow.querySelector('#dnd-sfx-vol-slider').addEventListener('input', function () {
      const v = parseFloat(this.value);
      volRow.querySelector('#dnd-sfx-vol-val').textContent = Math.round(v * 100) + '%';
      chrome.storage.local.set({ [volKey]: v });
    });

    sounds.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'dnd-sound-btn';
      btn.title = s.name;
      btn.textContent = s.name;
      btn.addEventListener('click', () => {
        const vol = parseFloat(volRow.querySelector('#dnd-sfx-vol-slider').value ?? 0.9);
        chrome.runtime.sendMessage({ type: 'SOUND_PLAY', url: s.url, volume: vol });
        // Visual flash feedback
        btn.classList.add('playing');
        setTimeout(() => btn.classList.remove('playing'), 600);
      });
      grid.appendChild(btn);
    });
  }

  // -- renderHandouts --------------------------------------------------------
  function renderHandouts(handouts, onRefresh) {
    const container = document.getElementById('dnd-handouts-container');
    if (!container) return;

    if (!handouts.length) {
      container.innerHTML = `
        <p class="dnd-section-label">Handouts
          ${onRefresh ? `<button class="dnd-btn-refresh" id="dnd-handouts-refresh" title="Handouts aktualisieren">&#8635;</button>` : ''}
        </p>
        <p class="dnd-placeholder">Noch keine Handouts vorhanden.</p>
      `;
      if (onRefresh) {
        container.querySelector('#dnd-handouts-refresh')?.addEventListener('click', onRefresh);
      }
      return;
    }

    container.innerHTML = `<p class="dnd-section-label">Handouts
      ${onRefresh ? `<button class="dnd-btn-refresh" id="dnd-handouts-refresh" title="Handouts aktualisieren">&#8635;</button>` : ''}
    </p>`;

    if (onRefresh) {
      container.querySelector('#dnd-handouts-refresh')?.addEventListener('click', onRefresh);
    }

    handouts.forEach(h => {
      const row = document.createElement('div');
      row.className = 'dnd-handout-row';
      row.dataset.id = h.id;
      row.innerHTML = `<span class="dnd-handout-name" title="${esc(h.title)}">${esc(h.title)}</span>`;
      row.querySelector('.dnd-handout-name').addEventListener('click', () => openHandoutViewer(h));
      container.appendChild(row);
    });
  }

  // -- Player view -----------------------------------------------------------
  async function renderPlayer(profile, session) {
    body.innerHTML = `
      <div class="dnd-welcome">
        <strong>${esc(profile.display_name || profile.username)}</strong>
        <span class="dnd-role-badge player">Spieler</span>
      </div>
      <hr class="dnd-divider" />
      <div id="dnd-handouts-container"></div>
      <hr class="dnd-divider" />
      <div id="dnd-player-notes-container">
        <p class="dnd-section-label">Notizen
          <button class="dnd-btn-refresh" id="dnd-player-notes-refresh" title="Notizen neu laden">&#8635;</button>
        </p>
        <div class="dnd-notes-rendered" id="dnd-notes-rendered"></div>
      </div>
      <hr class="dnd-divider" />
      <div>
        <p class="dnd-section-label">Lautstaerke</p>
        <div class="dnd-music-row">
          <span class="dnd-opacity-label">&#9835; Musik</span>
          <input type="range" id="dnd-player-music-vol" class="dnd-opacity-slider"
            min="0" max="1" step="0.05" value="0.8" />
          <span class="dnd-opacity-val" id="dnd-player-music-vol-val">80%</span>
        </div>
        <div class="dnd-music-row" style="margin-top:4px">
          <span class="dnd-opacity-label">&#127783; Wetter</span>
          <input type="range" id="dnd-player-weather-vol" class="dnd-opacity-slider"
            min="0" max="1" step="0.05" value="0.3" />
          <span class="dnd-opacity-val" id="dnd-player-weather-vol-val">30%</span>
        </div>
      </div>
      <hr class="dnd-divider" />
      <div>
        <p class="dnd-section-label">Layout</p>
        <div class="dnd-music-row">
          <span class="dnd-opacity-label">Char-Sheet<br>Schutz</span>
          <input type="range" id="dnd-player-offset-slider" class="dnd-opacity-slider"
            min="0" max="600" step="10" value="270" />
          <span class="dnd-opacity-val" id="dnd-player-offset-val">270px</span>
        </div>
      </div>
      <hr class="dnd-divider" />
      <button class="dnd-btn dnd-btn-secondary" id="dnd-logout-btn">Ausloggen</button>
    `;

    // Feature 1: Restore saved volumes for player
    chrome.storage.local.get(['dnd-music-vol', 'dnd-weather-vol', 'dnd-left-offset'], (r) => {
      const musicVol   = r['dnd-music-vol']   ?? 0.8;
      const weatherVol = r['dnd-weather-vol'] ?? 0.3;
      const offset     = r['dnd-left-offset'] ?? 270;

      const musicSlider = body.querySelector('#dnd-player-music-vol');
      if (musicSlider) {
        musicSlider.value = musicVol;
        body.querySelector('#dnd-player-music-vol-val').textContent = Math.round(musicVol * 100) + '%';
        chrome.runtime.sendMessage({ type: 'AUDIO_VOLUME', volume: musicVol });
      }
      const weatherSlider = body.querySelector('#dnd-player-weather-vol');
      if (weatherSlider) {
        weatherSlider.value = weatherVol;
        body.querySelector('#dnd-player-weather-vol-val').textContent = Math.round(weatherVol * 100) + '%';
        chrome.runtime.sendMessage({ type: 'WEATHER_VOLUME', volume: weatherVol });
      }
      const offsetSlider = body.querySelector('#dnd-player-offset-slider');
      if (offsetSlider) {
        offsetSlider.value = offset;
        body.querySelector('#dnd-player-offset-val').textContent = offset + 'px';
      }
    });

    // Load shared handouts + notes for player
    const [handoutsResp, notesResp] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'HANDOUTS_LIST', campaignId: profile.campaign_id }),
      chrome.runtime.sendMessage({ type: 'NOTES_GET', campaignId: profile.campaign_id }),
    ]);

    function doRefreshHandouts() {
      chrome.runtime.sendMessage({ type: 'HANDOUTS_LIST', campaignId: profile.campaign_id }).then(r => {
        renderHandouts(r.handouts || [], doRefreshHandouts); // pass itself so button persists
      });
    }
    renderHandouts(handoutsResp.handouts || [], doRefreshHandouts);

    // Render notes
    const notesRendered = body.querySelector('#dnd-notes-rendered');
    if (notesRendered) notesRendered.innerHTML = renderMarkdown(notesResp.content || '');

    // Refresh notes
    body.querySelector('#dnd-player-notes-refresh').addEventListener('click', async () => {
      const r = await chrome.runtime.sendMessage({ type: 'NOTES_GET', campaignId: profile.campaign_id });
      if (notesRendered) notesRendered.innerHTML = renderMarkdown(r.content || '');
    });

    // Restore + wire player offset slider
    body.querySelector('#dnd-player-offset-slider').addEventListener('input', function () {
      const px = parseInt(this.value);
      body.querySelector('#dnd-player-offset-val').textContent = px + 'px';
      setLeftOffset(px);
    });

    body.querySelector('#dnd-player-music-vol').addEventListener('input', function () {
      const v = parseFloat(this.value);
      body.querySelector('#dnd-player-music-vol-val').textContent = Math.round(v * 100) + '%';
      chrome.runtime.sendMessage({ type: 'AUDIO_VOLUME', volume: v });
      chrome.storage.local.set({ 'dnd-music-vol': v }); // Feature 1
    });

    body.querySelector('#dnd-player-weather-vol').addEventListener('input', function () {
      const v = parseFloat(this.value);
      body.querySelector('#dnd-player-weather-vol-val').textContent = Math.round(v * 100) + '%';
      chrome.runtime.sendMessage({ type: 'WEATHER_VOLUME', volume: v });
      chrome.storage.local.set({ 'dnd-weather-vol': v }); // Feature 1
    });

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

