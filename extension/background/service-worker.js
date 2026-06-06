// Service Worker - handles all Supabase communication.

importScripts('../lib/supabase.umd.js');

const SUPABASE_URL     = 'https://oeypwacjlbgpcwobvxix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9leXB3YWNqbGJncGN3b2J2eGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NDM2MjUsImV4cCI6MjA5NjMxOTYyNX0.Z1NEjmnE_OHdOzlQ1ChFfbU6epVtVzCDmLQu86dvjJ0';

const storageAdapter = {
  getItem:    (key)        => new Promise(r => chrome.storage.local.get(key, d => r(d[key] ?? null))),
  setItem:    (key, value) => new Promise(r => chrome.storage.local.set({ [key]: value }, r)),
  removeItem: (key)        => new Promise(r => chrome.storage.local.remove(key, r)),
};

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, storage: storageAdapter },
});

// Active Realtime channel - only one at a time per SW instance.
let realtimeChannel = null;

// -------------------------------------------------------------------------
// Broadcast to all DDB game tabs
// -------------------------------------------------------------------------
async function broadcastToTabs(msg) {
  const tabs = await chrome.tabs.query({ url: 'https://www.dndbeyond.com/games/*' });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

// -------------------------------------------------------------------------
// Realtime subscription for a campaign's session + scenes
// -------------------------------------------------------------------------
function subscribeToSession(sessionId, campaignId) {
  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = sb
    .channel('session-' + sessionId)
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'sessions',
      filter: 'id=eq.' + sessionId,
    }, async (payload) => {
      const activeSceneId = payload.new.active_scene_id;
      if (!activeSceneId) return;

      const { data: scene } = await sb
        .from('scenes')
        .select('*')
        .eq('id', activeSceneId)
        .single();

      if (scene) broadcastToTabs({ type: 'SCENE_CHANGED', scene });
    })
    .subscribe();
}

// -------------------------------------------------------------------------
// Message handler
// -------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch((err) => {
    console.error('[SW] error handling', msg.type, err);
    sendResponse({ error: err.message });
  });
  return true;
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
      if (profile?.campaign_id) {
        const session = await fetchSession(profile.campaign_id);
        if (session) subscribeToSession(session.id, profile.campaign_id);
      }
      return { session: data.session, profile };
    }

    case 'AUTH_SIGN_IN': {
      const { data, error } = await sb.auth.signInWithPassword({
        email: msg.email, password: msg.password,
      });
      if (error) throw error;
      const profile = await fetchProfile(data.user.id);
      if (profile?.campaign_id) {
        const session = await fetchSession(profile.campaign_id);
        if (session) subscribeToSession(session.id, profile.campaign_id);
      }
      return { session: data.session, profile };
    }

    case 'AUTH_SIGN_OUT': {
      if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }
      const { error } = await sb.auth.signOut();
      if (error) throw error;
      return { ok: true };
    }

    // -- Scenes --------------------------------------------------------------

    case 'SCENES_LIST': {
      const { data, error } = await sb
        .from('scenes')
        .select('*')
        .eq('campaign_id', msg.campaignId)
        .order('sort_order');
      if (error) throw error;
      return { scenes: data };
    }

    case 'SESSION_GET': {
      const session = await fetchSession(msg.campaignId);
      return { session };
    }

    case 'SCENE_SWITCH': {
      const { error } = await sb
        .from('sessions')
        .update({ active_scene_id: msg.sceneId, updated_at: new Date().toISOString() })
        .eq('campaign_id', msg.campaignId);
      if (error) throw error;
      return { ok: true };
    }

    case 'SCENE_UPDATE_OPACITY': {
      const { error } = await sb
        .from('scenes')
        .update({ bg_opacity: msg.opacity })
        .eq('id', msg.sceneId);
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
  const { data } = await sb.from('profiles').select('*').eq('user_id', userId).single();
  return data;
}

async function fetchSession(campaignId) {
  const { data } = await sb.from('sessions').select('*').eq('campaign_id', campaignId).single();
  return data;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[DnD Overlay] Extension installed / updated.');
});
