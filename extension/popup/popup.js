// Popup script - pings the service worker to check extension health.

const statusEl = document.getElementById('status');

chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
  if (chrome.runtime.lastError) {
    statusEl.textContent = 'SW nicht erreichbar: ' + chrome.runtime.lastError.message;
    statusEl.style.color = '#c0392b';
    return;
  }
  statusEl.textContent = 'Extension aktiv - SW OK';
  statusEl.style.color = '#27ae60';
});
