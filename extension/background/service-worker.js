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
// Offscreen Document helpers (audio)
// -------------------------------------------------------------------------
let _offscreenCreating = null;
async function ensureOffscreen() {
  if (_offscreenCreating) return _offscreenCreating;
  const existing = await chrome.offscreen.hasDocument();
  if (existing) return;
  _offscreenCreating = chrome.offscreen.createDocument({
    url:     chrome.runtime.getURL('offscreen/offscreen.html'),
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Background music playback for DnD sessions',
  }).catch(() => {}).finally(() => { _offscreenCreating = null; });
  return _offscreenCreating;
}

async function sendAudio(msg) {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ ...msg, target: 'offscreen' }).catch(() => {});
}

// -------------------------------------------------------------------------
// Broadcast to all DDB game tabs
// -------------------------------------------------------------------------
async function broadcastToTabs(msg) {
  const tabs = await chrome.tabs.query({ url: 'https://www.dndbeyond.com/*' });
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

  // Closure state – kept up-to-date by the sessions Realtime callback
  let activeSceneId = null;
  let activeCombat  = false;
  let lastSfxAt     = null;

  realtimeChannel = sb
    .channel('session-' + sessionId)
    // Session change = DM switched scene / toggled combat / played SFX
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'sessions',
      filter: 'id=eq.' + sessionId,
    }, async (payload) => {
      const wasActive    = activeSceneId;
      activeSceneId      = payload.new.active_scene_id;
      activeCombat       = !!payload.new.is_combat;

      // Stream toggle – no scene required
      if (payload.old?.stream_active !== payload.new.stream_active) {
        broadcastToTabs({ type: 'STREAM_CHANGED', active: !!payload.new.stream_active });
      }

      // Soundboard sync – remote players hear SFX via sessions row change
      if (payload.new.last_sfx_url && payload.new.last_sfx_at !== lastSfxAt) {
        lastSfxAt = payload.new.last_sfx_at;
        broadcastToTabs({ type: 'SOUND_PLAY', url: payload.new.last_sfx_url, volume: 0.9 });
      }

      if (!activeSceneId) return;

      // Reload scene if scene switched OR combat state changed
      if (activeSceneId !== wasActive || payload.old?.is_combat !== payload.new.is_combat) {
        const { data: scene } = await sb
          .from('scenes')
          .select('*')
          .eq('id', activeSceneId)
          .single();

        if (scene) {
          broadcastToTabs({ type: 'SCENE_CHANGED', scene, isCombat: activeCombat });
          playSceneAudio(scene, activeCombat);
          // Also sync weather for the new scene so players don't see stale weather
          if (scene.weather_preset_id) {
            const { data: preset } = await sb
              .from('weather_presets').select('*').eq('id', scene.weather_preset_id).single();
            broadcastToTabs({ type: 'WEATHER_CHANGED', preset: preset || null });
          } else {
            broadcastToTabs({ type: 'WEATHER_CHANGED', preset: null });
          }
        }
      }
    })
    // Scene row updated = DM changed opacity / weather / watcher re-uploaded an asset
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'scenes',
      filter: 'campaign_id=eq.' + campaignId,
    }, async (payload) => {
      if (payload.new.id !== activeSceneId) return;
      // Forward scene change with correct combat state so player opacity stays right
      broadcastToTabs({ type: 'SCENE_CHANGED', scene: payload.new, isCombat: !!activeCombat });
      // Also sync weather preset so remote players see / hear weather changes
      const presetId = payload.new.weather_preset_id;
      if (presetId) {
        const { data: preset } = await sb
          .from('weather_presets').select('*').eq('id', presetId).single();
        broadcastToTabs({ type: 'WEATHER_CHANGED', preset: preset || null });
      } else {
        broadcastToTabs({ type: 'WEATHER_CHANGED', preset: null });
      }
    })
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'campaign_notes',
      filter: 'campaign_id=eq.' + campaignId,
    }, (payload) => {
      if (payload.new) broadcastToTabs({ type: 'NOTES_CHANGED', content: payload.new.content ?? '' });
    })
    .subscribe((status, err) => {
      if (err) console.error('[SW] Realtime error:', err.message ?? err);
      console.log('[SW] Realtime status:', status);
      // Do NOT reset realtimeChannel here – Supabase handles its own reconnect.
      // Only reset if the channel is permanently dead (error, not transient close).
      if (status === 'CHANNEL_ERROR') {
        sb.removeChannel(realtimeChannel).catch(() => {});
        realtimeChannel = null;
      }
    });

  // Initialise closure state from DB so first Realtime event can diff correctly
  sb.from('sessions')
    .select('active_scene_id, is_combat, last_sfx_at')
    .eq('id', sessionId).single()
    .then(({ data }) => {
      if (data) {
        activeSceneId = data.active_scene_id;
        activeCombat  = !!data.is_combat;
        lastSfxAt     = data.last_sfx_at;
      }
    });
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
      // MV3 SWs can be suspended; re-subscribe if Realtime channel was lost
      if (!realtimeChannel) await tryResubscribe();
      return { status: 'ok' };

    // -- Auth ----------------------------------------------------------------

    case 'AUTH_GET_SESSION': {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      if (!data.session) return { session: null, profile: null };
      const profile    = await fetchProfile(data.session.user.id);
      const campaignId = await resolveCampaignId(msg.gameId, profile);
      if (campaignId) {
        profile.campaign_id = campaignId;
        // Persist so tryResubscribe works after SW is killed and restarted
        chrome.storage.local.set({ 'dnd-campaign-id': campaignId });
        const session = await fetchSession(campaignId);
        if (session) subscribeToSession(session.id, campaignId);
      }
      return { session: data.session, profile };
    }

    case 'AUTH_SIGN_IN': {
      const { data, error } = await sb.auth.signInWithPassword({
        email: msg.email, password: msg.password,
      });
      if (error) throw error;
      const profile    = await fetchProfile(data.user.id);
      const campaignId = await resolveCampaignId(msg.gameId, profile);
      if (campaignId) {
        profile.campaign_id = campaignId;
        // Persist so tryResubscribe works after SW is killed and restarted
        chrome.storage.local.set({ 'dnd-campaign-id': campaignId });
        const session = await fetchSession(campaignId);
        if (session) subscribeToSession(session.id, campaignId);
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

    case 'SCENE_GET': {
      const { data, error } = await sb
        .from('scenes')
        .select('*')
        .eq('id', msg.sceneId)
        .single();
      if (error) throw error;
      return { scene: data };
    }

    // Player calls this on login / COMBAT_CHANGED to start the correct music
    case 'SCENE_AUDIO_PLAY': {
      if (msg.sceneId) {
        const { data: scene } = await sb.from('scenes').select('*').eq('id', msg.sceneId).single();
        if (scene) await playSceneAudio(scene, !!msg.isCombat);
      } else {
        // No active overlay scene – play default music directly
        const campaignId = await new Promise(r =>
          chrome.storage.local.get('dnd-campaign-id', d => r(d['dnd-campaign-id'] ?? null))
        );
        if (campaignId) {
          const { data } = await sb.from('campaigns')
            .select('default_ambient_url, default_combat_url')
            .eq('id', campaignId).single();
          const url = msg.isCombat
            ? (data?.default_combat_url || data?.default_ambient_url || null)
            : (data?.default_ambient_url || null);
          const vol = await new Promise(r =>
            chrome.storage.local.get('dnd-music-vol', d => r(d['dnd-music-vol'] ?? 0.8))
          );
          if (url) sendAudio({ type: 'PLAY_MUSIC', url, volume: vol });
          else     sendAudio({ type: 'STOP_MUSIC' });
        }
      }
      return { ok: true };
    }

    case 'DEFAULT_MUSIC_GET': {
      const { data } = await sb
        .from('campaigns')
        .select('default_ambient_url, default_combat_url, default_background_url')
        .eq('id', msg.campaignId)
        .single();
      return {
        ambientUrl:    data?.default_ambient_url    ?? null,
        combatUrl:     data?.default_combat_url     ?? null,
        backgroundUrl: data?.default_background_url ?? null,
      };
    }

    case 'SESSION_GET': {
      const session = await fetchSession(msg.campaignId);
      return { session };
    }

    case 'SCENE_CLEAR': {
      // DM switched to a DDB scene with no overlay match and no Default scene.
      // Broadcast to all local tabs so players also show the default background.
      broadcastToTabs({ type: 'SCENE_CLEARED' });
      return { ok: true };
    }

    case 'SCENE_SWITCH': {
      const { error } = await sb
        .from('sessions')
        .update({ active_scene_id: msg.sceneId, updated_at: new Date().toISOString() })
        .eq('campaign_id', msg.campaignId);
      if (error) throw error;
      // Broadcast immediately to all local tabs (same browser / incognito).
      // Remote players on other devices receive it via the Realtime subscription.
      const { data: scene } = await sb.from('scenes').select('*').eq('id', msg.sceneId).single();
      if (scene) {
        const isCombat = !!(msg.isCombat ?? false);
        broadcastToTabs({ type: 'SCENE_CHANGED', scene, isCombat });
        playSceneAudio(scene, isCombat);
      }
      return { ok: true };
    }

    case 'AUDIO_PLAY':
      if (!msg.url) return { ok: true };
      await sendAudio({ type: 'PLAY_MUSIC', url: msg.url, volume: msg.volume ?? 0.8 });
      return { ok: true };

    case 'AUDIO_STOP':
      await sendAudio({ type: 'STOP_MUSIC' });
      return { ok: true };

    case 'AUDIO_VOLUME':
      await sendAudio({ type: 'SET_MUSIC_VOLUME', volume: msg.volume });
      return { ok: true };

    case 'WEATHER_SET': {
      // Broadcast to all tabs + play/stop weather sound
      broadcastToTabs({ type: 'WEATHER_CHANGED', preset: msg.preset });
      if (msg.preset?.sound_url) {
        await sendAudio({ type: 'PLAY_WEATHER', url: msg.preset.sound_url, volume: msg.volume ?? 0.4 });
      } else {
        await sendAudio({ type: 'STOP_WEATHER' });
      }
      // Persist weather on the scene
      if (msg.sceneId) {
        const { error } = await sb.from('scenes')
          .update({ weather_preset_id: msg.preset?.id ?? null })
          .eq('id', msg.sceneId);
        if (error) console.warn('[SW] weather update error:', error.message);
      }
      return { ok: true };
    }

    case 'WEATHER_VOLUME':
      await sendAudio({ type: 'SET_WEATHER_VOLUME', volume: msg.volume });
      return { ok: true };

    case 'WEATHER_PLAY':
      if (msg.url) await sendAudio({ type: 'PLAY_WEATHER', url: msg.url, volume: msg.volume ?? 0.3 });
      else         await sendAudio({ type: 'STOP_WEATHER' });
      return { ok: true };

    case 'WEATHER_PRESET_GET': {
      if (!msg.presetId) return { preset: null };
      const { data } = await sb.from('weather_presets').select('*').eq('id', msg.presetId).single();
      return { preset: data || null };
    }

    case 'WEATHER_PRESETS_LIST': {
      const { data, error } = await sb
        .from('weather_presets')
        .select('*')
        .eq('campaign_id', msg.campaignId)
        .order('name');
      if (error) throw error;
      return { presets: data };
    }

    case 'HANDOUTS_LIST': {
      const { data, error } = await sb
        .from('handouts')
        .select('id, campaign_id, title, file_url, type')
        .eq('campaign_id', msg.campaignId)
        .order('title');
      if (error) throw error;
      return { handouts: data || [] };
    }

    case 'INITIATIVE_TOGGLE': {
      const { error } = await sb
        .from('sessions')
        .update({ is_combat: msg.active, updated_at: new Date().toISOString() })
        .eq('campaign_id', msg.campaignId);
      if (error) throw error;
      if (msg.sceneId) {
        // Direct broadcast so players get the combat-state + audio change immediately
        const { data: scene } = await sb.from('scenes').select('*').eq('id', msg.sceneId).single();
        if (scene) {
          broadcastToTabs({ type: 'SCENE_CHANGED', scene, isCombat: !!msg.active });
          playSceneAudio(scene, !!msg.active);
        }
      } else {
        // No active overlay scene – broadcast combat toggle so players adjust opacity + default music
        broadcastToTabs({ type: 'COMBAT_CHANGED', isCombat: !!msg.active });
        const { data: campaign } = await sb.from('campaigns')
          .select('default_ambient_url, default_combat_url')
          .eq('id', msg.campaignId).single();
        if (campaign) {
          const url = msg.active
            ? (campaign.default_combat_url || campaign.default_ambient_url || null)
            : (campaign.default_ambient_url || null);
          const vol = await new Promise(r =>
            chrome.storage.local.get('dnd-music-vol', d => r(d['dnd-music-vol'] ?? 0.8))
          );
          if (url) sendAudio({ type: 'PLAY_MUSIC', url, volume: vol });
          else     sendAudio({ type: 'STOP_MUSIC' });
        }
      }
      return { ok: true };
    }

    case 'HANDOUT_STREAM': {
      const { error } = await sb
        .from('sessions')
        .update({
          stream_handout_url:   msg.url   ?? null,
          stream_handout_title: msg.title ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('campaign_id', msg.campaignId);
      if (error) throw error;
      return { ok: true };
    }

    case 'STREAM_TOGGLE': {
      const { error } = await sb
        .from('sessions')
        .update({ stream_active: msg.active, updated_at: new Date().toISOString() })
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

    case 'SOUNDS_LIST': {
      const { data, error } = await sb
        .from('sounds')
        .select('id, name, url')
        .eq('campaign_id', msg.campaignId)
        .order('name');
      if (error) throw error;
      return { sounds: data || [] };
    }

    case 'SOUND_PLAY': {
      // Broadcast to same-browser tabs (incognito players).
      // Note: DM plays directly from the click handler – no sendAudio needed here.
      broadcastToTabs({ type: 'SOUND_PLAY', url: msg.url, volume: msg.volume ?? 0.9 });
      // Persist to sessions so remote players receive it via Realtime (requires migration 004)
      if (msg.campaignId) {
        sb.from('sessions')
          .update({ last_sfx_url: msg.url, last_sfx_at: new Date().toISOString() })
          .eq('campaign_id', msg.campaignId)
          .then(({ error }) => { if (error) console.warn('[SW] SFX sync error:', error.message); });
      }
      return { ok: true };
    }

    case 'DICE_ROLL': {
      // Deduplicate: ignore if identical roll (same player + total) within last 5 s
      const since = new Date(Date.now() - 5000).toISOString();
      const { data: recent } = await sb
        .from('dice_rolls')
        .select('id')
        .eq('campaign_id', msg.campaignId)
        .eq('player_name', msg.player || '')
        .eq('total', msg.total)
        .gte('created_at', since)
        .limit(1);
      if (recent && recent.length > 0) return { ok: true, deduped: true };
      const { error } = await sb.from('dice_rolls').insert({
        campaign_id: msg.campaignId,
        player_name: msg.player  || '',
        roll_label:  msg.label   || '',
        total:       msg.total   ?? null,
        is_nat20:    msg.isNat20 ?? false,
      });
      if (error) console.warn('[SW] dice_roll insert error:', error.message);
      return { ok: true };
    }

    case 'NOTES_GET': {
      const { data } = await sb
        .from('campaign_notes')
        .select('content')
        .eq('campaign_id', msg.campaignId)
        .single();
      return { content: data?.content ?? '' };
    }

    case 'NOTES_SAVE': {
      const { error } = await sb
        .from('campaign_notes')
        .upsert({ campaign_id: msg.campaignId, content: msg.content, updated_at: new Date().toISOString() },
          { onConflict: 'campaign_id' });
      if (error) throw error;
      broadcastToTabs({ type: 'NOTES_CHANGED', content: msg.content });
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

// Game-ID from URL takes priority; fall back to profile.campaign_id for older setups.
async function resolveCampaignId(gameId, profile) {
  if (gameId) {
    const { data } = await sb.from('campaigns').select('id').eq('game_id', gameId).single();
    if (data) return data.id;
    console.warn('[SW] Keine Kampagne fuer game_id:', gameId);
  }
  return profile?.campaign_id || null;
}

async function playSceneAudio(scene, isCombat) {
  // Priority for combat: scene combat → default combat → scene ambient → default ambient.
  // Default combat is checked before falling back to scene ambient so that
  // initiative always switches the track when a default/combat file exists.
  let audioUrl = null;
  if (isCombat) {
    audioUrl = scene.combat_url || null;
  } else {
    audioUrl = scene.ambient_url || null;
  }

  if (!audioUrl && scene.campaign_id) {
    const { data } = await sb
      .from('campaigns')
      .select('default_ambient_url, default_combat_url')
      .eq('id', scene.campaign_id)
      .single();

    if (isCombat) {
      audioUrl = data?.default_combat_url
              || scene.ambient_url
              || data?.default_ambient_url
              || null;
    } else {
      audioUrl = data?.default_ambient_url || null;
    }
  }

  if (!audioUrl) { sendAudio({ type: 'STOP_MUSIC' }); return; }

  // Read persisted volume so realtime-triggered playback respects user setting.
  const vol = await new Promise(r =>
    chrome.storage.local.get('dnd-music-vol', d => r(d['dnd-music-vol'] ?? 0.8))
  );
  sendAudio({ type: 'PLAY_MUSIC', url: audioUrl, volume: vol });
}

async function fetchProfile(userId) {
  const { data } = await sb.from('profiles').select('*').eq('user_id', userId).single();
  return data;
}

async function fetchSession(campaignId) {
  const { data } = await sb.from('sessions').select('*').eq('campaign_id', campaignId).single();
  return data;
}

// Re-establish Realtime subscription after SW was suspended by Chrome (MV3)
async function tryResubscribe() {
  try {
    // Clean up ALL stale channels first so we don't create duplicates
    await sb.removeAllChannels().catch(() => {});
    realtimeChannel = null;
    const { data } = await sb.auth.getSession();
    if (!data?.session) return;
    const profile = await fetchProfile(data.session.user.id);
    // profile.campaign_id may be null for players who joined via game_id
    // (resolveCampaignId only sets it in memory, not in DB).
    // Fall back to the value we persisted in chrome.storage.local on login.
    let campaignId = profile?.campaign_id;
    if (!campaignId) {
      campaignId = await new Promise(r =>
        chrome.storage.local.get('dnd-campaign-id', d => r(d['dnd-campaign-id'] ?? null))
      );
    }
    if (!campaignId) return;
    const session = await fetchSession(campaignId);
    if (session) {
      console.log('[SW] Re-subscribing after SW wake-up');
      subscribeToSession(session.id, campaignId);
    }
  } catch (e) {
    console.warn('[SW] tryResubscribe failed:', e.message);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[DnD Overlay] Extension installed / updated.');
});

// Stop audio when the last DDB game tab is closed
chrome.tabs.onRemoved.addListener(async () => {
  const remaining = await chrome.tabs.query({ url: 'https://www.dndbeyond.com/*' });
  if (remaining.length === 0) {
    sendAudio({ type: 'STOP_MUSIC' });
    sendAudio({ type: 'STOP_WEATHER' });
  }
});
