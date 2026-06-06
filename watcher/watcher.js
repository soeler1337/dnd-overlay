// DnD Overlay - Content Watcher
// Watches the local content/ folder and syncs changes to Supabase Storage + DB.
//
// Usage: node watcher.js
// Requires: node watcher/watcher.js (from repo root)

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const { createClient } = require('@supabase/supabase-js');

// -------------------------------------------------------------------------
// Config - copy .env.example to .env and fill in your values
// -------------------------------------------------------------------------
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role key - never in extension!
const CAMPAIGN_ID       = process.env.CAMPAIGN_ID;
const CONTENT_DIR       = path.join(__dirname, '..', 'content');

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CAMPAIGN_ID) {
  console.error('[Watcher] Fehlende Konfiguration in watcher/.env');
  console.error('  SUPABASE_URL, SUPABASE_SERVICE_KEY und CAMPAIGN_ID benoetigt.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// -------------------------------------------------------------------------
// Folder layout expected:
//
//   content/
//     scenes/
//       01_basis/
//         background.jpg   (optional)
//         music.mp3        (optional)
//         scene.json       (optional, see below)
//       02_kampf/
//         ...
//     handouts/
//       stadtplan.jpg
//       brief.jpg
//
// scene.json (optional, created automatically if missing):
//   { "name": "Basis", "is_combat": false }
// -------------------------------------------------------------------------

const IMAGE_EXT = new Set(['.jpg','.jpeg','.png','.webp','.gif']);
const AUDIO_EXT = new Set(['.mp3','.ogg','.wav','.m4a']);

function isImage(f) { return IMAGE_EXT.has(path.extname(f).toLowerCase()); }
function isAudio(f) { return AUDIO_EXT.has(path.extname(f).toLowerCase()); }

// Upload a file to Supabase Storage and return its public URL.
async function uploadFile(bucket, storagePath, localPath) {
  const data = fs.readFileSync(localPath);
  const ext  = path.extname(localPath).toLowerCase();
  const mime = ext === '.mp3' ? 'audio/mpeg'
             : ext === '.ogg' ? 'audio/ogg'
             : ext === '.wav' ? 'audio/wav'
             : ext === '.m4a' ? 'audio/mp4'
             : ext === '.png' ? 'image/png'
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
// Sync a single scene folder
// -------------------------------------------------------------------------
async function syncScene(sceneDir) {
  const folderName = path.basename(sceneDir);
  const files = fs.readdirSync(sceneDir);

  // Read optional scene.json for metadata
  let meta = { name: folderName, is_combat: false };
  const jsonFile = path.join(sceneDir, 'scene.json');
  if (fs.existsSync(jsonFile)) {
    try { meta = { ...meta, ...JSON.parse(fs.readFileSync(jsonFile, 'utf8')) }; }
    catch { console.warn('[Watcher] Ungueltige scene.json in', folderName); }
  }

  const bgFile    = files.find(isImage);
  const audioFile = files.find(isAudio);

  let bgUrl    = null;
  let audioUrl = null;

  if (bgFile) {
    console.log(`[Watcher] Lade Hintergrund hoch: ${folderName}/${bgFile}`);
    bgUrl = await uploadFile('backgrounds', `${CAMPAIGN_ID}/${folderName}/${bgFile}`, path.join(sceneDir, bgFile));
  }
  if (audioFile) {
    console.log(`[Watcher] Lade Musik hoch: ${folderName}/${audioFile}`);
    audioUrl = await uploadFile('music', `${CAMPAIGN_ID}/${folderName}/${audioFile}`, path.join(sceneDir, audioFile));
  }

  // Upsert scene row by campaign_id + name
  const { error } = await sb.from('scenes').upsert({
    campaign_id:     CAMPAIGN_ID,
    name:            meta.name,
    background_url:  bgUrl,
    music_track_url: audioUrl,
    is_combat:       meta.is_combat,
  }, { onConflict: 'campaign_id,name' });

  if (error) console.error('[Watcher] Szene DB-Fehler:', error.message);
  else console.log(`[Watcher] Szene synced: ${meta.name}`);
}

// -------------------------------------------------------------------------
// Sync a single handout file
// -------------------------------------------------------------------------
async function syncHandout(filePath) {
  const fileName = path.basename(filePath);
  if (!isImage(fileName)) return;

  console.log(`[Watcher] Lade Handout hoch: ${fileName}`);
  const url = await uploadFile('handouts', `${CAMPAIGN_ID}/${fileName}`, filePath);

  const title = path.basename(fileName, path.extname(fileName))
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  const { error } = await sb.from('handouts').upsert({
    campaign_id: CAMPAIGN_ID,
    title,
    file_url: url,
    type: 'image',
  }, { onConflict: 'campaign_id,title' });

  if (error) console.error('[Watcher] Handout DB-Fehler:', error.message);
  else console.log(`[Watcher] Handout synced: ${title}`);
}

// -------------------------------------------------------------------------
// Initial full sync on startup
// -------------------------------------------------------------------------
async function fullSync() {
  console.log('[Watcher] Vollsync gestartet...');

  const scenesDir   = path.join(CONTENT_DIR, 'scenes');
  const handoutsDir = path.join(CONTENT_DIR, 'handouts');

  if (fs.existsSync(scenesDir)) {
    for (const entry of fs.readdirSync(scenesDir)) {
      const full = path.join(scenesDir, entry);
      if (fs.statSync(full).isDirectory()) {
        await syncScene(full).catch(e => console.error('[Watcher] Fehler Szene:', e.message));
      }
    }
  }

  if (fs.existsSync(handoutsDir)) {
    for (const file of fs.readdirSync(handoutsDir)) {
      await syncHandout(path.join(handoutsDir, file))
        .catch(e => console.error('[Watcher] Fehler Handout:', e.message));
    }
  }

  console.log('[Watcher] Vollsync abgeschlossen. Beobachte Aenderungen...');
}

// -------------------------------------------------------------------------
// File watcher
// -------------------------------------------------------------------------
function startWatcher() {
  // Ensure content dirs exist
  const scenesDir   = path.join(CONTENT_DIR, 'scenes');
  const handoutsDir = path.join(CONTENT_DIR, 'handouts');
  fs.mkdirSync(scenesDir,   { recursive: true });
  fs.mkdirSync(handoutsDir, { recursive: true });

  // Debounce map: filepath -> timeout
  const debounce = {};

  function onChange(eventType, filename, baseDir) {
    if (!filename) return;
    const full = path.join(baseDir, filename);
    clearTimeout(debounce[full]);
    debounce[full] = setTimeout(async () => {
      if (!fs.existsSync(full)) return; // deleted - ignore for now
      try {
        if (baseDir === scenesDir) {
          // filename might be "scenefolder" or "scenefolder/file"
          const parts  = filename.split(path.sep);
          const sceneD = path.join(scenesDir, parts[0]);
          if (fs.statSync(sceneD).isDirectory()) await syncScene(sceneD);
        } else {
          await syncHandout(full);
        }
      } catch (e) {
        console.error('[Watcher] Sync-Fehler:', e.message);
      }
    }, 800);
  }

  fs.watch(scenesDir,   { recursive: true }, (t, f) => onChange(t, f, scenesDir));
  fs.watch(handoutsDir, { recursive: false }, (t, f) => onChange(t, f, handoutsDir));
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
