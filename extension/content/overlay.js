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

  // Sidebar is lifted above overlays via CSS injection (z-index:200),
  // so no left-offset needed. Start overlays from the left edge.
  bgOverlay.style.left  = '0px';
  gifOverlay.style.left = '0px';

  // -------------------------------------------------------------------------
  // Inject a <style> tag that lifts known DDB UI elements above our overlays.
  // CSS rules apply immediately and survive React re-renders — no timing issues.
  // Class fragments confirmed via DevTools inspection on dndbeyond.com/games/*.
  // -------------------------------------------------------------------------
  (function injectDdbLifts() {
    const s = document.createElement('style');
    s.id = 'dnd-overlay-lifts';
    s.textContent = [
      // Left sidebar panel (character sheet, DM tools) — z=4 in DDB, below our overlay
      '[class*="J127eW__left"]      { z-index: 200 !important; }',
      // Left map-tool toolbar (adjusts position when sidebar open)
      '[class*="iB2XjW__toolbar"]   { z-index: 200 !important; }',
      // Content container next to sidebar (z=2 in DDB)
      '[class*="-lA1Pq__container"] { z-index: 200 !important; }',
      // Bottom toolbar: Roll Dice, Hide Scene, zoom, Game Log, Game Info
      '[class*="zsFwWG__wrapper"] { z-index: 200 !important; }',
      // Scene switcher dropdown list (opens below the 64px header into overlay area)
      '[class*="zzLIoG__dropdownContent"] { z-index: 200 !important; }',
    ].join('\n');
    document.head.appendChild(s);
  })();

  // -------------------------------------------------------------------------
  // Lift DDB UI elements above our bg overlays (z-index 50/51).
  //
  // CSS z-index on child elements alone doesn't work because DDB wraps them
  // in ancestor containers that create their own stacking contexts at
  // z-index < 50, which caps all children in global stacking order.
  //
  // Fix: walk every positioned ancestor (including fixed/sticky) and the
  // element itself, raise z-index to LIFT_Z. Also detect stacking contexts
  // created by transform/opacity/filter/will-change (not just z-index).
  // Keep watching so re-renders (React unmount/remount) are handled too.
  // -------------------------------------------------------------------------
  const LIFT_Z = 200; // safely above our gif overlay at 51

  function createsStackingContext(cs) {
    if (cs.position !== 'static' && cs.zIndex !== 'auto') return true;
    if (cs.position === 'fixed' || cs.position === 'sticky')  return true;
    if (cs.transform !== 'none')   return true;
    if (cs.filter    !== 'none')   return true;
    if (parseFloat(cs.opacity) < 1) return true;
    if (cs.isolation === 'isolate') return true;
    if (cs.willChange && cs.willChange !== 'auto') return true;
    return false;
  }

  function liftAboveBg(classFragment) {
    const seen   = new WeakSet();
    let   rafId  = null;

    function lift(el) {
      let node = el;
      while (node && node !== document.documentElement) {
        if (!seen.has(node)) {
          seen.add(node);
          const cs  = window.getComputedStyle(node);
          const pos = cs.position;
          if (pos !== 'static' || createsStackingContext(cs)) {
            const zi = parseInt(cs.zIndex);
            if (isNaN(zi) || zi < LIFT_Z) {
              node.style.setProperty('z-index', String(LIFT_Z), 'important');
              if (pos === 'static') node.style.setProperty('position', 'relative', 'important');
            }
          }
        }
        node = node.parentElement;
      }
    }

    function tryLift() {
      const el = document.querySelector(`[class*="${classFragment}"]`);
      if (el) lift(el);
    }

    function scheduleLift() {
      if (rafId) return;
      rafId = requestAnimationFrame(() => { rafId = null; tryLift(); });
    }

    // Retry on DOM changes – handles React re-renders / lazy loading.
    // RAF-debounced so we don't thrash on every mutation in large React trees.
    new MutationObserver(scheduleLift).observe(document.body, { childList: true, subtree: true });
    tryLift();
  }

  // DDB scene-switcher bar (top) – lift above overlay.
  // Top/bottom edges of the overlay are set in CSS (top:64px / bottom:80px)
  // so the header bar and bottom toolbar are always fully uncovered.
  liftAboveBg('scenarioMenuEncounters');

  // The DDB game header (top bar, h=64px) is left uncovered because the
  // overlays start at top:64px (set in CSS). No JS workaround needed for
  // the roll-privacy dropdown and other top-bar controls.

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
  // Currently active scene (updated by applyScene and startScenarioNameObserver)
  let _activeDmScene = null;

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
    _activeDmScene = scene;
    const opacity = isCombat ? 0 : (scene.bg_opacity > 0 ? 1 : 0);
    // Use scene background; fall back to default background if none set
    const bgUrl = scene.background_url || window._dndDefaultBackground || null;
    setBackground(bgUrl, opacity);

    // Update scene name display in DM panel
    const nameEl = document.getElementById('dnd-active-scene-name');
    if (nameEl) nameEl.textContent = scene.name || '—';

    // Update background toggle button in DM panel
    const bgToggle = document.getElementById('dnd-bg-toggle');
    if (bgToggle) {
      const on = scene.bg_opacity > 0;
      bgToggle.textContent = on ? 'AN' : 'AUS';
      bgToggle.classList.toggle('on', on);
      bgToggle.classList.toggle('off', !on);
    }
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
            <option value="" disabled selected>— Wer bist du? —</option>
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
          <input id="dnd-user" type="text" autocomplete="username" placeholder="Benutzername" />
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
    if (profile?.campaign_id) {
      startDiceObserver(profile.campaign_id);
      // startScenarioNameObserver is called from renderDm after _dndScenes is populated
    }
  }

  // -------------------------------------------------------------------------
  // DDB scenario-name observer – when the DM switches a scene in DDB's native
  // UI, the scenarioName element text changes.  We detect this and auto-switch
  // our overlay scene to the matching entry in window._dndScenes (name match,
  // case-insensitive).  Only fires after the initial load to avoid spurious
  // switches on page ready.
  // -------------------------------------------------------------------------
  function startScenarioNameObserver(campaignId) {
    let debounce  = null;
    let lastText  = '';
    let ready     = false;

    function onNameChange() {
      const el = document.querySelector('[class*="scenarioName"]');
      if (!el) return;
      const name = el.textContent.trim();
      if (!name || name === lastText) return;
      if (!ready) {
        lastText = name; // track changes silently during init, but don't act on them
        return;
      }
      lastText = name;

      const scenes = window._dndScenes || [];
      const match  = scenes.find(s => s.name.trim().toLowerCase() === name.toLowerCase());

      if (!match) {
        // No overlay scene matches the DDB scene name → fall back to default
        // (hide background; if a scene named "Default" exists, use that instead)
        const fallback = scenes.find(s => s.name.trim().toLowerCase() === 'default');
        if (fallback && _activeDmScene?.id !== fallback.id) {
          applyScene(fallback, combatActive);
          chrome.runtime.sendMessage({ type: 'SCENE_SWITCH', sceneId: fallback.id, campaignId }).catch(() => {});
        } else if (!fallback) {
          // No default scene → just hide the background overlay
          _activeDmScene = null;
          setBackground(null, 0);
          const nameEl = document.getElementById('dnd-active-scene-name');
          if (nameEl) nameEl.textContent = name + ' –';
          const bgToggle = document.getElementById('dnd-bg-toggle');
          if (bgToggle) { bgToggle.textContent = 'AUS'; bgToggle.className = 'dnd-scene-toggle off'; }
        }
        return;
      }

      // Skip if already the active scene
      if (_activeDmScene?.id === match.id) return;

      // Apply locally immediately (no RT roundtrip delay)
      applyScene(match, combatActive);

      chrome.runtime.sendMessage({ type: 'SCENE_SWITCH', sceneId: match.id, campaignId })
        .catch(() => {});
    }

    // Capture the current name so the initial page state doesn't trigger a switch
    const initEl = document.querySelector('[class*="scenarioName"]');
    if (initEl) lastText = initEl.textContent.trim();
    // Short delay: _dndScenes is already loaded when this runs (called from renderDm),
    // just give the DDB DOM a moment to finish any pending React renders.
    setTimeout(() => { ready = true; }, 300);

    // Watch document.body — reliable even when DDB re-renders the scene bar
    new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(onNameChange, 400);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // -------------------------------------------------------------------------
  // Dice roll observer – watches DnD Beyond's built-in dice log for new rolls
  // and forwards them to Supabase so the stream overlay can display them.
  // DnD Beyond uses obfuscated class names that may change; we therefore rely
  // on a combination of class-pattern matching and content heuristics.
  // -------------------------------------------------------------------------
  function startDiceObserver(campaignId) {
    let lastHash = '';

    function sendRoll(data) {
      // Coarse dedup within the same 4-second window on the client side
      const hash = `${data.player}|${data.total}|${Math.floor(Date.now() / 4000)}`;
      if (hash === lastHash) return;
      lastHash = hash;
      chrome.runtime.sendMessage({ type: 'DICE_ROLL', campaignId, ...data }).catch(() => {});
    }

    function parseRollNode(node) {
      if (node.nodeType !== 1) return null;
      const text = (node.innerText || node.textContent || '').trim();
      if (text.length < 2 || !/\d/.test(text)) return null;

      // Extract all small integers (1–150) that could be roll totals
      const nums = [...text.matchAll(/\b(\d{1,3})\b/g)]
        .map(m => parseInt(m[1]))
        .filter(n => n >= 1 && n <= 150);
      if (!nums.length) return null;

      // The total is usually the last (or largest) prominent number shown
      const total = nums[nums.length - 1];

      // Player / character name – look for name-class elements first
      const nameEl = node.querySelector(
        '[class*="name" i], [class*="player" i], [class*="character" i], [class*="avatar" i]'
      );
      const player = (nameEl?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);

      // Roll label – first line of the entry text is usually the description
      const firstLine = text.split('\n').find(l => l.trim().length > 1) || '';
      const label = firstLine.trim().slice(0, 60);

      // NAT 20 detection: total is 20 and a d20 is mentioned, or DnD Beyond
      // explicitly shows "Natural 20" / "Nat 20" text
      const isNat20 = (total === 20 && /d20/i.test(text)) || /nat(?:ural)?\s*20/i.test(text);

      return { player, label, total, isNat20 };
    }

    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;

          // Only care about elements that look like dice-roll entries:
          // they have "roll" or "dice" somewhere in their own class string,
          // OR contain a child with such a class.
          const ownCls = (typeof node.className === 'string' ? node.className : '').toLowerCase();
          const hasDiceClass = ownCls.includes('roll') || ownCls.includes('dice') ||
            !!node.querySelector('[class*="roll" i], [class*="dice" i]');
          if (!hasDiceClass) continue;

          const roll = parseRollNode(node);
          if (roll && roll.total) sendRoll(roll);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // -------------------------------------------------------------------------
  // Collapsible sections – toggle visibility of everything below the label.
  // Idempotent: safe to call again after a section re-renders (refresh).
  // State persisted per-key in localStorage.
  // -------------------------------------------------------------------------
  function makeSectionCollapsible(containerId, storageKey) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const label = el.querySelector('.dnd-section-label');
    if (!label) return;

    const collapsed = localStorage.getItem(storageKey) === 'true';

    // Add toggle arrow once
    if (!label.querySelector('.dnd-collapse-btn')) {
      const btn = document.createElement('button');
      btn.className = 'dnd-collapse-btn';
      label.prepend(btn);
      label.classList.add('collapsible');
      label.addEventListener('click', (e) => {
        if (e.target.closest('.dnd-btn-refresh')) return; // refresh button still works
        const cur = localStorage.getItem(storageKey) === 'true';
        localStorage.setItem(storageKey, String(!cur));
        makeSectionCollapsible(containerId, storageKey); // re-apply
      });
    }

    // Apply current state
    const btn = label.querySelector('.dnd-collapse-btn');
    if (btn) btn.textContent = collapsed ? '▶' : '▾';
    [...el.children].forEach(child => {
      if (child !== label) child.style.display = collapsed ? 'none' : '';
    });
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
      <div id="dnd-scene-bar" style="margin-top:8px">
        <div class="dnd-music-row">
          <span class="dnd-opacity-label">&#x1F5FA; Szene</span>
          <span id="dnd-active-scene-name" style="flex:1;font-size:12px;color:#c8a45a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 6px">—</span>
          <button id="dnd-bg-toggle" class="dnd-scene-toggle off">AUS</button>
        </div>
      </div>
      <div id="dnd-weather-bar" style="margin-top:8px">
        <div class="dnd-music-row">
          <span class="dnd-opacity-label">&#127783; Wetter</span>
          <select class="dnd-weather-select" id="dnd-global-weather-select">
            <option value="">— keins —</option>
          </select>
        </div>
      </div>
      <hr class="dnd-divider" />
      <div id="dnd-scenes-container"></div>
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
      <button class="dnd-btn dnd-btn-secondary" id="dnd-logout-btn">Ausloggen</button>
    `;

    // --- Feature 1: Restore saved volumes ---
    chrome.storage.local.get(['dnd-music-vol', 'dnd-weather-vol'], (r) => {
      const musicVol   = r['dnd-music-vol']   ?? 0.8;
      const weatherVol = r['dnd-weather-vol'] ?? 0.3;

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
    });

    // Music volume slider – Feature 1: persist
    const volSlider = body.querySelector('#dnd-volume-slider');
    const volVal    = body.querySelector('#dnd-volume-val');
    volSlider.addEventListener('input', () => {
      const v = parseFloat(volSlider.value);
      volVal.textContent = Math.round(v * 100) + '%';
      chrome.runtime.sendMessage({ type: 'AUDIO_VOLUME', volume: v });
      chrome.storage.local.set({ 'dnd-music-vol': v });
    });

    // Weather volume slider – Feature 1: persist
    const weatherVolSlider = body.querySelector('#dnd-weather-volume-slider');
    const weatherVolVal    = body.querySelector('#dnd-weather-volume-val');
    weatherVolSlider.addEventListener('input', () => {
      const v = parseFloat(weatherVolSlider.value);
      weatherVolVal.textContent = Math.round(v * 100) + '%';
      chrome.runtime.sendMessage({ type: 'WEATHER_VOLUME', volume: v });
      chrome.storage.local.set({ 'dnd-weather-vol': v });
    });

    body.querySelector('#dnd-music-play').addEventListener('click', () => {
      if (!_activeDmScene) return;
      const isCombat = body.querySelector('#dnd-initiative-btn')?.dataset.active === 'true';
      const vol = parseFloat(body.querySelector('#dnd-volume-slider')?.value ?? 0.8);
      const url = resolveAudioUrl(_activeDmScene, isCombat);
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

    // Cache default asset URLs
    window._dndDefaultAmbient    = defaultMusicResp.ambientUrl    || null;
    window._dndDefaultCombat     = defaultMusicResp.combatUrl     || null;
    window._dndDefaultBackground = defaultMusicResp.backgroundUrl || null;

    // Show status in UI
    const defStatus = body.querySelector('#dnd-default-music-status');
    if (defStatus) {
      const hasAmb = !!defaultMusicResp.ambientUrl;
      const hasCom = !!defaultMusicResp.combatUrl;
      const hasBg  = !!defaultMusicResp.backgroundUrl;
      const parts  = [
        hasBg  ? '✓ BG'     : '',
        hasAmb ? '✓ Ambient': '',
        hasCom ? '✓ Combat' : '',
      ].filter(Boolean);
      defStatus.textContent = parts.length ? parts.join(' · ') : 'Kein Standard hinterlegt';
      defStatus.style.color = parts.length ? '#7acc60' : '#6a6050';
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
        // Persist on active scene
        if (_activeDmScene) _activeDmScene.weather_preset_id = presetId || null;
        applyWeather(preset);
        const wVol = parseFloat(body.querySelector('#dnd-weather-volume-slider')?.value ?? 0.3);
        chrome.runtime.sendMessage({ type: 'WEATHER_SET', preset, sceneId: _activeDmScene?.id || null, volume: wVol });
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
      // Apply locally using tracked active scene
      if (_activeDmScene) {
        applyScene(_activeDmScene, isCombatActive);
        const vol = parseFloat(body.querySelector('#dnd-volume-slider')?.value ?? 0.8);
        const url = resolveAudioUrl(_activeDmScene, isCombatActive);
        if (url) chrome.runtime.sendMessage({ type: 'AUDIO_PLAY', url, volume: vol });
        else     chrome.runtime.sendMessage({ type: 'AUDIO_STOP' });
        if (!isCombatActive) {
          const preset = weatherPresets.find(p => p.id === _activeDmScene.weather_preset_id) || null;
          applyWeather(preset);
        } else {
          gifOverlay.classList.remove('active');
        }
      }
    });

    window._dndScenes = scenesResp.scenes || [];

    // Initialise active scene from current session
    _activeDmScene = window._dndScenes.find(s => s.id === session?.active_scene_id) || null;
    if (_activeDmScene) {
      applyScene(_activeDmScene, session?.is_combat ?? false);
      const preset = weatherPresets.find(p => p.id === _activeDmScene.weather_preset_id) || null;
      applyWeather(preset);
    }

    // Wire up background toggle
    const bgToggle = body.querySelector('#dnd-bg-toggle');
    if (bgToggle) {
      bgToggle.addEventListener('click', async () => {
        if (!_activeDmScene) return;
        const newOn = bgToggle.classList.contains('off');
        const newOpacity = newOn ? 1 : 0;
        _activeDmScene.bg_opacity = newOpacity;
        bgToggle.textContent = newOn ? 'AN' : 'AUS';
        bgToggle.classList.toggle('on', newOn);
        bgToggle.classList.toggle('off', !newOn);
        if (!combatActive) {
          bgOverlay.style.setProperty('--bg-opacity', newOpacity);
        }
        await chrome.runtime.sendMessage({
          type: 'SCENE_UPDATE_OPACITY',
          sceneId: _activeDmScene.id,
          opacity: newOpacity,
        });
      });
    }

    // Start scene-name observer now that _dndScenes is populated
    startScenarioNameObserver(profile.campaign_id);

    // --- Refresh helpers ---
    function doRefreshScenes() {
      chrome.runtime.sendMessage({ type: 'SCENES_LIST', campaignId: profile.campaign_id }).then(r => {
        window._dndScenes = r.scenes || [];
        renderSceneButtons(
          window._dndScenes,
          _activeDmScene?.id || session?.active_scene_id || null,
          profile.campaign_id,
          combatActive,
          weatherPresets,
          doRefreshScenes,
        );
        makeSectionCollapsible('dnd-scenes-container', 'dnd-col-scenes');
      });
    }

    function doRefreshHandouts() {
      chrome.runtime.sendMessage({ type: 'HANDOUTS_LIST', campaignId: profile.campaign_id }).then(r => {
        renderHandouts(r.handouts || [], doRefreshHandouts);
        makeSectionCollapsible('dnd-handouts-container', 'dnd-col-handouts');
      });
    }

    renderSceneButtons(
      window._dndScenes,
      _activeDmScene?.id || session?.active_scene_id || null,
      profile.campaign_id,
      session?.is_combat ?? false,
      weatherPresets,
      doRefreshScenes,
    );
    renderHandouts(handoutsResp.handouts || [], doRefreshHandouts);
    renderSoundboard(soundsResp.sounds || [], profile.campaign_id);

    // Apply collapsible state to all sections (preserved across reloads via localStorage)
    makeSectionCollapsible('dnd-scenes-container',  'dnd-col-scenes');
    makeSectionCollapsible('dnd-handouts-container', 'dnd-col-handouts');
    makeSectionCollapsible('dnd-sounds-container',   'dnd-col-sounds');
    makeSectionCollapsible('dnd-notes-container',    'dnd-col-notes');
    makeSectionCollapsible('dnd-music-controls',     'dnd-col-music');
  }

  function updateInitiativeBtn(btn, active) {
    btn.dataset.active = active;
    btn.innerHTML      = active
      ? '&#x2714; Initiative l&auml;uft &ndash; Beenden'
      : '&#x2694; Initiative starten';
    btn.classList.toggle('combat-active', active);
  }

  // Feature 5: resolve audio URL with fallback to default music from DB.
  // Priority for combat: scene combat → default combat → scene ambient → default ambient.
  // Priority for ambient: scene ambient → default ambient.
  // Default combat is tried BEFORE falling back to ambient so initiative always
  // switches music when a default/combat track exists, even if the scene has an
  // ambient track but no explicit combat track.
  function resolveAudioUrl(scene, isCombat) {
    if (isCombat) {
      return scene.combat_url
          || window._dndDefaultCombat
          || scene.ambient_url
          || window._dndDefaultAmbient
          || null;
    }
    return scene.ambient_url || window._dndDefaultAmbient || null;
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
          // Initiative läuft: nur Sound wechseln, Hintergrund + Wetter bleiben unsichtbar
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
        <p class="dnd-placeholder">Keine Sounds. Lege <code>.mp3</code>-Dateien in<br><code>content/${campaignId.slice(0,8)}…/sounds/</code> ab.</p>
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
  async function renderPlayer(profile, _sessionUnused) {
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
      <div id="dnd-player-volume-container">
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
      <button class="dnd-btn dnd-btn-secondary" id="dnd-logout-btn">Ausloggen</button>
    `;

    // Restore saved volumes for player
    chrome.storage.local.get(['dnd-music-vol', 'dnd-weather-vol'], (r) => {
      const musicVol   = r['dnd-music-vol']   ?? 0.8;
      const weatherVol = r['dnd-weather-vol'] ?? 0.3;

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
    });

    // Load everything the player needs on startup
    const [handoutsResp, notesResp, sessionResp, defaultResp] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'HANDOUTS_LIST',   campaignId: profile.campaign_id }),
      chrome.runtime.sendMessage({ type: 'NOTES_GET',       campaignId: profile.campaign_id }),
      chrome.runtime.sendMessage({ type: 'SESSION_GET',     campaignId: profile.campaign_id }),
      chrome.runtime.sendMessage({ type: 'DEFAULT_MUSIC_GET', campaignId: profile.campaign_id }),
    ]);

    // Cache default background so applyScene fallback works for players too
    window._dndDefaultBackground = defaultResp.backgroundUrl || null;

    // Apply the currently active scene immediately (don't wait for DM to switch)
    const session = sessionResp.session;
    if (session?.active_scene_id) {
      const sceneResp = await chrome.runtime.sendMessage({
        type: 'SCENE_GET', sceneId: session.active_scene_id,
      });
      if (sceneResp.scene) applyScene(sceneResp.scene, session.is_combat ?? false);
    }

    function doRefreshHandouts() {
      chrome.runtime.sendMessage({ type: 'HANDOUTS_LIST', campaignId: profile.campaign_id }).then(r => {
        renderHandouts(r.handouts || [], doRefreshHandouts);
        makeSectionCollapsible('dnd-handouts-container', 'dnd-col-p-handouts');
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

    // Collapsible sections for player panel
    makeSectionCollapsible('dnd-handouts-container',      'dnd-col-p-handouts');
    makeSectionCollapsible('dnd-player-notes-container',  'dnd-col-p-notes');
    makeSectionCollapsible('dnd-player-volume-container', 'dnd-col-p-volume');
  }

  function esc(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  init();
})();
