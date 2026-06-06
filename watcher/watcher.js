// DnD Overlay - Content Watcher
// Watches content/<game-id>/ folders and syncs to Supabase Storage + DB.
// Each top-level subfolder name must match the DnD Beyond game ID (e.g. 5570639).
//
// Usage: node watcher/watcher.js (from repo root)

const fs      = require('fs');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CONTENT_DIR         = path.join(__dirname, '..', 'content');

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[Watcher] Fehlende Konfiguration in watcher/.env');
  console.error('  SUPABASE_URL und SUPABASE_SERVICE_KEY benoetigt.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// -------------------------------------------------------------------------
// Folder layout:
//
//   content/
//     5570639/              ← DnD Beyond game ID
//       scenes/
//         01_taverne/
//           background/     ← background image (jpg/png/webp)
//           ambient/        ← ambient music (mp3)
//           combat/         ← combat music (mp3)
//       weather/
//         regen/            ← GIF + optional sound
//         sturm/
//       handouts/
//         stadtplan.jpg
// -------------------------------------------------------------------------

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const AUDIO_EXT = new Set(['.mp3', '.ogg', '.wav', '.m4a']);

// Supabase Storage only allows ASCII in keys — replace German umlauts and strip the rest.
function sanitizePath(str) {
  return str
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-zA-Z0-9._\-/]/g, '_');
}

function isImage(f) { return IMAGE_EXT.has(path.extname(f).toLowerCase()); }
function isAudio(f) { return AUDIO_EXT.has(path.extname(f).toLowerCase()); }

// Cache: game_id -> campaign UUID (avoids repeated DB lookups)
const campaignCache = {};

async function getCampaignId(gameId) {
  if (campaignCache[gameId]) return campaignCache[gameId];
  const { data, error } = await sb
    .from('campaigns')
    .select('id')
    .eq('game_id', gameId)
    .single();
  if (error || !data) {
    console.error(`[Watcher] Keine Kampagne fuer Game-ID "${gameId}" gefunden.`);
    console.error('  Stelle sicher dass die Kampagne in Supabase die game_id gesetzt hat.');
    return null;
  }
  campaignCache[gameId] = data.id;
  return data.id;
}

// -------------------------------------------------------------------------
// File upload helper
// -------------------------------------------------------------------------
async function uploadFile(bucket, storagePath, localPath) {
  const data = fs.readFileSync(localPath);
  const ext  = path.extname(localPath).toLowerCase();
  const mime = ext === '.mp3'  ? 'audio/mpeg'
             : ext === '.ogg'  ? 'audio/ogg'
             : ext === '.wav'  ? 'audio/wav'
             : ext === '.m4a'  ? 'audio/mp4'
             : ext === '.png'  ? 'image/png'
             : ext === '.webp' ? 'image/webp'
             : ext === '.gif'  ? 'image/gif'
             : 'image/jpeg';

  const { error } = await sb.storage
    .from(bucket)
    .upload(storagePath, data, { contentType: mime, upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: urlData } = sb.storage.from(bucket).getPublicUrl(storagePath);
  return urlData.publicUrl;
}

// -------------------------------------------------------------------------
// Scene sync
// -------------------------------------------------------------------------
const SCENE_SUBDIRS = ['background', 'ambient', 'combat'];

function ensureSceneFolders(sceneDir) {
  let created = false;
  for (const sub of SCENE_SUBDIRS) {
    const dir = path.join(sceneDir, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created = true;
    }
  }
  if (created) console.log(`[Watcher] Unterordner erstellt in: ${path.basename(sceneDir)}`);
}

async function syncScene(sceneDir, campaignId, gameId) {
  ensureSceneFolders(sceneDir);
  const folderName = path.basename(sceneDir);

  let meta = { name: folderName, is_combat: false, bg_opacity: null };
  const jsonFile = path.join(sceneDir, 'scene.json');
  if (fs.existsSync(jsonFile)) {
    try { meta = { ...meta, ...JSON.parse(fs.readFileSync(jsonFile, 'utf8')) }; }
    catch { console.warn('[Watcher] Ungueltige scene.json in', folderName); }
  }
  if (meta.bg_opacity === null) meta.bg_opacity = meta.is_combat ? 0.25 : 0.5;

  function firstFileIn(subdir, matchFn) {
    const dir = path.join(sceneDir, subdir);
    if (!fs.existsSync(dir)) return null;
    return fs.readdirSync(dir).find(f => matchFn(f)) || null;
  }

  const bgFile      = firstFileIn('background', isImage);
  const ambientFile = firstFileIn('ambient',    isAudio);
  const combatFile  = firstFileIn('combat',     isAudio);

  let bgUrl = null, ambientUrl = null, combatUrl = null;

  const safeFolder = sanitizePath(folderName);

  if (bgFile) {
    console.log(`[Watcher] Hintergrund: ${gameId}/${folderName}/background/${bgFile}`);
    bgUrl = await uploadFile('backgrounds', sanitizePath(`${campaignId}/${safeFolder}/${bgFile}`),
      path.join(sceneDir, 'background', bgFile));
  }
  if (ambientFile) {
    console.log(`[Watcher] Ambient: ${gameId}/${folderName}/ambient/${ambientFile}`);
    ambientUrl = await uploadFile('music', sanitizePath(`${campaignId}/${safeFolder}/ambient/${ambientFile}`),
      path.join(sceneDir, 'ambient', ambientFile));
  }
  if (combatFile) {
    console.log(`[Watcher] Combat: ${gameId}/${folderName}/combat/${combatFile}`);
    combatUrl = await uploadFile('music', sanitizePath(`${campaignId}/${safeFolder}/combat/${combatFile}`),
      path.join(sceneDir, 'combat', combatFile));
  }

  const { error } = await sb.from('scenes').upsert({
    campaign_id:    campaignId,
    name:           meta.name,
    background_url: bgUrl,
    ambient_url:    ambientUrl,
    combat_url:     combatUrl,
    is_combat:      meta.is_combat,
    bg_opacity:     meta.bg_opacity,
  }, { onConflict: 'campaign_id,name' });

  if (error) console.error('[Watcher] Szene DB-Fehler:', error.message);
  else console.log(`[Watcher] Szene synced: ${meta.name} (${gameId})`);
}

// -------------------------------------------------------------------------
// Weather sync
// -------------------------------------------------------------------------
async function syncWeather(weatherDir, campaignId, gameId) {
  const name  = path.basename(weatherDir);
  const files = fs.readdirSync(weatherDir);

  const gifFile   = files.find(f => isImage(f));
  const soundFile = files.find(f => isAudio(f));

  if (!gifFile && !soundFile) return;

  let gifUrl = null, soundUrl = null;

  if (gifFile) {
    console.log(`[Watcher] Wetter-GIF: ${gameId}/weather/${name}/${gifFile}`);
    gifUrl = await uploadFile('backgrounds', sanitizePath(`${campaignId}/weather/${name}/${gifFile}`),
      path.join(weatherDir, gifFile));
  }
  if (soundFile) {
    console.log(`[Watcher] Wetter-Sound: ${gameId}/weather/${name}/${soundFile}`);
    soundUrl = await uploadFile('music', sanitizePath(`${campaignId}/weather/${name}/${soundFile}`),
      path.join(weatherDir, soundFile));
  }

  const { error } = await sb.from('weather_presets').upsert({
    campaign_id: campaignId,
    name,
    gif_url:   gifUrl,
    sound_url: soundUrl,
  }, { onConflict: 'campaign_id,name' });

  if (error) console.error('[Watcher] Wetter DB-Fehler:', error.message);
  else console.log(`[Watcher] Wetter synced: ${name} (${gameId})`);
}

// -------------------------------------------------------------------------
// Handout sync  (one subfolder per handout, folder name = title)
// -------------------------------------------------------------------------
async function syncHandout(handoutDir, campaignId, gameId) {
  if (!fs.statSync(handoutDir).isDirectory()) return;
  const title = path.basename(handoutDir);
  const files = fs.readdirSync(handoutDir);
  const imgFile = files.find(f => isImage(f));
  if (!imgFile) return;

  console.log(`[Watcher] Lade Handout hoch: ${gameId}/${title}/${imgFile}`);
  const url = await uploadFile(
    'handouts',
    sanitizePath(`${campaignId}/${title}/${imgFile}`),
    path.join(handoutDir, imgFile),
  );

  const { error } = await sb.from('handouts').upsert({
    campaign_id: campaignId,
    title,
    file_url: url,
    type: 'image',
  }, { onConflict: 'campaign_id,title' });

  if (error) console.error('[Watcher] Handout DB-Fehler:', error.message);
  else console.log(`[Watcher] Handout synced: ${title} (${gameId})`);
}

// -------------------------------------------------------------------------
// Full sync for one game-id folder
// -------------------------------------------------------------------------
async function syncGameFolder(gameDir) {
  const gameId     = path.basename(gameDir);
  const campaignId = await getCampaignId(gameId);
  if (!campaignId) return;

  const scenesDir   = path.join(gameDir, 'scenes');
  const weatherDir  = path.join(gameDir, 'weather');
  const handoutsDir = path.join(gameDir, 'handouts');

  fs.mkdirSync(scenesDir,   { recursive: true });
  fs.mkdirSync(weatherDir,  { recursive: true });
  fs.mkdirSync(handoutsDir, { recursive: true });

  for (const entry of fs.readdirSync(scenesDir)) {
    const full = path.join(scenesDir, entry);
    if (!fs.statSync(full).isDirectory()) continue;
    if (/^(neuer ordner|new folder)$/i.test(entry)) continue;
    ensureSceneFolders(full);
    await syncScene(full, campaignId, gameId).catch(e =>
      console.error('[Watcher] Fehler Szene:', e.message));
  }

  for (const entry of fs.readdirSync(weatherDir)) {
    const full = path.join(weatherDir, entry);
    if (!fs.statSync(full).isDirectory()) continue;
    await syncWeather(full, campaignId, gameId).catch(e =>
      console.error('[Watcher] Fehler Wetter:', e.message));
  }

  for (const entry of fs.readdirSync(handoutsDir)) {
    const full = path.join(handoutsDir, entry);
    if (fs.statSync(full).isDirectory()) {
      await syncHandout(full, campaignId, gameId).catch(e =>
        console.error('[Watcher] Fehler Handout:', e.message));
    }
  }
}

// -------------------------------------------------------------------------
// Full sync - all game folders
// -------------------------------------------------------------------------
async function fullSync() {
  console.log('[Watcher] Vollsync gestartet...');
  fs.mkdirSync(CONTENT_DIR, { recursive: true });

  const entries = fs.readdirSync(CONTENT_DIR);
  const gameDirs = entries.filter(e => {
    const full = path.join(CONTENT_DIR, e);
    return fs.statSync(full).isDirectory();
  });

  if (!gameDirs.length) {
    console.log(`[Watcher] Keine Kampagnen-Ordner in ${CONTENT_DIR} gefunden.`);
    console.log('[Watcher] Lege einen Ordner mit der DnD-Beyond Game-ID an, z.B. content/5570639/');
  }

  for (const gameId of gameDirs) {
    console.log(`[Watcher] Verarbeite Kampagne: ${gameId}`);
    await syncGameFolder(path.join(CONTENT_DIR, gameId));
  }

  console.log('[Watcher] Vollsync abgeschlossen. Beobachte Aenderungen...');
}

// -------------------------------------------------------------------------
// File watcher
// -------------------------------------------------------------------------
function startWatcher() {
  const debounce = {};

  // Watch content/ root for new game-id folders being added
  fs.watch(CONTENT_DIR, { recursive: false }, (eventType, filename) => {
    if (!filename) return;
    const gameDir = path.join(CONTENT_DIR, filename);
    clearTimeout(debounce[gameDir]);
    debounce[gameDir] = setTimeout(async () => {
      if (!fs.existsSync(gameDir) || !fs.statSync(gameDir).isDirectory()) return;
      console.log(`[Watcher] Neue Kampagne erkannt: ${filename}`);
      await syncGameFolder(gameDir).catch(e =>
        console.error('[Watcher] Fehler:', e.message));
    }, 1000);
  });

  // Watch each game folder recursively
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  for (const gameId of fs.readdirSync(CONTENT_DIR)) {
    const gameDir = path.join(CONTENT_DIR, gameId);
    if (!fs.statSync(gameDir).isDirectory()) continue;

    const scenesDir   = path.join(gameDir, 'scenes');
    const weatherDir  = path.join(gameDir, 'weather');
    const handoutsDir = path.join(gameDir, 'handouts');
    fs.mkdirSync(scenesDir,   { recursive: true });
    fs.mkdirSync(weatherDir,  { recursive: true });
    fs.mkdirSync(handoutsDir, { recursive: true });

    getCampaignId(gameId).then(campaignId => {
      if (!campaignId) return;

      fs.watch(scenesDir, { recursive: true }, (t, f) => {
        if (!f) return;
        const key = `${gameId}:scenes:${f}`;
        clearTimeout(debounce[key]);
        debounce[key] = setTimeout(async () => {
          const parts  = f.split(path.sep);
          const sceneD = path.join(scenesDir, parts[0]);
          if (!fs.existsSync(sceneD) || !fs.statSync(sceneD).isDirectory()) return;
          if (/^(neuer ordner|new folder)$/i.test(parts[0])) return;
          await syncScene(sceneD, campaignId, gameId).catch(e =>
            console.error('[Watcher] Sync-Fehler:', e.message));
        }, 800);
      });

      fs.watch(weatherDir, { recursive: true }, (t, f) => {
        if (!f) return;
        const key = `${gameId}:weather:${f}`;
        clearTimeout(debounce[key]);
        debounce[key] = setTimeout(async () => {
          const parts    = f.split(path.sep);
          const weatherD = path.join(weatherDir, parts[0]);
          if (!fs.existsSync(weatherD) || !fs.statSync(weatherD).isDirectory()) return;
          await syncWeather(weatherD, campaignId, gameId).catch(e =>
            console.error('[Watcher] Sync-Fehler:', e.message));
        }, 800);
      });

      fs.watch(handoutsDir, { recursive: true }, (t, f) => {
        if (!f) return;
        const key = `${gameId}:handouts:${f}`;
        clearTimeout(debounce[key]);
        debounce[key] = setTimeout(async () => {
          const parts      = f.split(path.sep);
          const handoutDir = path.join(handoutsDir, parts[0]);
          if (!fs.existsSync(handoutDir) || !fs.statSync(handoutDir).isDirectory()) return;
          await syncHandout(handoutDir, campaignId, gameId).catch(e =>
            console.error('[Watcher] Sync-Fehler:', e.message));
        }, 800);
      });
    });
  }
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------
(async () => {
  console.log('[Watcher] DnD Overlay Content Watcher gestartet');
  console.log('[Watcher] Content-Ordner:', CONTENT_DIR);
  await fullSync();
  startWatcher();
})();
