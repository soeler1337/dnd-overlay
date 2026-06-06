// Service Worker - Classic Script (no ES modules, uses importScripts).
// Handles all Supabase communication and relays updates to content scripts.

importScripts('../lib/supabase.umd.js');

const SUPABASE_URL     = 'https://oeypwacjlbgpcwobvxix.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6YqvCwUhgg1qG_vhZFqhXw_UmTm-YdA';

// chrome.storage.local adapter so sessions survive SW restarts.
const storageAdapter = {
  getItem: (key) =>
    new Promise((resolve) =>
      chrome.storage.local.get(key, (r) => resolve(r[key] ?? null))
    ),
  setItem: (key, value) =>
    new Promise((resolve) =>
      chrome.storage.local.set({ [key]: value }, resolve)
    ),
  removeItem: (key) =>
    new Promise((resolve) => chrome.storage.local.remove(key, resolve)),
};

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storage: storageAdapter,
  },
});

// Send a message to all DnD-overlay-bearing tabs.
async function broadcastToTabs(msg) {
  const tabs = await chrome.tabs.query({ url: 'https://www.dndbeyond.com/games/*' });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

// -------------------------------------------------------------------------
// Message handler
// -------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch((err) => {
    console.error('[SW] error handling', msg.type, err);
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg) {
  switch (msg.type) {

    case 'PING':
      return { status: 'ok' };

    // -- Auth ----------------------------------------------------------------

    case 'AUTH_GET_SESSION': {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      if (!data.session) return { session: null, profile: null };
      const profile = await fetchProfile(data.session.user.id);
      return { session: data.session, profile };
    }

    case 'AUTH_SIGN_IN': {
      const { data, error } = await sb.auth.signInWithPassword({
        email: msg.email,
        password: msg.password,
      });
      if (error) throw error;
      const profile = await fetchProfile(data.user.id);
      return { session: data.session, profile };
    }

    case 'AUTH_SIGN_OUT': {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
      return { ok: true };
    }

    default:
      console.warn('[SW] unknown message type:', msg.type);
      return { error: 'unknown message type' };
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
async function fetchProfile(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error) {
    console.warn('[SW] fetchProfile error:', error.message);
    return null;
  }
  return data;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[DnD Overlay] Extension installed / updated.');
});
