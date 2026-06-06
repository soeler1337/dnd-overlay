// Player view panel - placeholder for Milestone 3+.

export function renderPlayerView(container, profile) {
  container.innerHTML = `
    <div class="dnd-welcome">
      <p>Willkommen, <strong>${escHtml(profile.display_name || 'Spieler')}</strong>!</p>
      <p class="dnd-role-badge player">Spieler</p>
    </div>
    <p class="dnd-placeholder">Initiative und Handouts kommen in Milestone 5/6.</p>
    <button class="dnd-btn dnd-btn-secondary" id="dnd-logout-btn">Ausloggen</button>
  `;

  container.querySelector('#dnd-logout-btn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'AUTH_SIGN_OUT' });
    location.reload();
  });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
