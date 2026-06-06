// Content Script - injected into dndbeyond.com/games/* pages.
// Milestone 1: builds a minimal overlay shell (no real content yet).

(function () {
  // Prevent double-injection if the script somehow runs twice.
  if (document.getElementById('dnd-overlay-root')) return;

  // --- Root container -------------------------------------------------------
  const root = document.createElement('div');
  root.id = 'dnd-overlay-root';

  // --- Toggle button (always visible, bottom-right corner) ------------------
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'dnd-overlay-toggle';
  toggleBtn.textContent = 'DnD';
  toggleBtn.title = 'DnD Overlay oeffnen / schliessen';

  // --- Main panel (hidden by default) ---------------------------------------
  const panel = document.createElement('div');
  panel.id = 'dnd-overlay-panel';
  panel.setAttribute('aria-label', 'DnD Overlay Panel');
  panel.hidden = true;

  // Placeholder content - replaced in Milestone 2 with real UI.
  panel.innerHTML = `
    <div class="dnd-panel-header">
      <span class="dnd-panel-title">DnD Overlay</span>
      <button class="dnd-panel-close" title="Schliessen">&times;</button>
    </div>
    <div class="dnd-panel-body">
      <p class="dnd-placeholder">Verbinde mit Supabase... (kommt in Milestone 2)</p>
    </div>
  `;

  // --- Wire up toggle and close button --------------------------------------
  toggleBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });

  panel.querySelector('.dnd-panel-close').addEventListener('click', () => {
    panel.hidden = true;
  });

  // --- Mount into page ------------------------------------------------------
  root.appendChild(toggleBtn);
  root.appendChild(panel);
  document.body.appendChild(root);

  // --- Verify connection to service worker ----------------------------------
  chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[DnD Overlay] SW not reachable:', chrome.runtime.lastError.message);
      return;
    }
    console.log('[DnD Overlay] SW ping OK:', response);
  });
})();
