// Login panel - rendered inside the overlay when user is not authenticated.

export function renderLogin(container, onSuccess) {
  container.innerHTML = `
    <form id="dnd-login-form" novalidate>
      <div class="dnd-field">
        <label for="dnd-email">E-Mail</label>
        <input id="dnd-email" type="email" autocomplete="email" placeholder="dm@example.com" />
      </div>
      <div class="dnd-field">
        <label for="dnd-password">Passwort</label>
        <input id="dnd-password" type="password" autocomplete="current-password" placeholder="********" />
      </div>
      <div id="dnd-login-error" class="dnd-error" hidden></div>
      <button type="submit" class="dnd-btn dnd-btn-primary" id="dnd-login-btn">Einloggen</button>
    </form>
  `;

  const form    = container.querySelector('#dnd-login-form');
  const emailEl = container.querySelector('#dnd-email');
  const pwEl    = container.querySelector('#dnd-password');
  const errEl   = container.querySelector('#dnd-login-error');
  const btnEl   = container.querySelector('#dnd-login-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    btnEl.disabled = true;
    btnEl.textContent = 'Bitte warten...';

    const email    = emailEl.value.trim();
    const password = pwEl.value;

    if (!email || !password) {
      showError('Bitte E-Mail und Passwort eingeben.');
      return;
    }

    const resp = await chrome.runtime.sendMessage({
      type: 'AUTH_SIGN_IN',
      email,
      password,
    });

    if (resp.error) {
      showError(resp.error);
      return;
    }

    onSuccess(resp.session, resp.profile);
  });

  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
    btnEl.disabled = false;
    btnEl.textContent = 'Einloggen';
  }
}
