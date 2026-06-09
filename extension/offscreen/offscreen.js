// Offscreen Document - audio playback for MV3.
// Three channels: scene music (loop) + weather (loop) + one-shot soundboard.

// Master gain applied on top of the user's volume slider.
// Keeps music at a comfortable background level even at 100% slider.
const MUSIC_GAIN   = 0.4;  // slider 100% → actual 40%
const WEATHER_GAIN = 0.6;  // weather sounds are often quieter sources, less reduction

const music   = new Audio(); music.loop   = true;
const weather = new Audio(); weather.loop = true;
// Soundboard: pool of short Audio objects for overlapping one-shots
const SFX_POOL_SIZE = 4;
const sfxPool = Array.from({ length: SFX_POOL_SIZE }, () => new Audio());
let sfxIdx = 0;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;

  switch (msg.type) {

    case 'PLAY_MUSIC':
      if (msg.url && music.src !== msg.url) music.src = msg.url;
      if (msg.volume !== undefined) music.volume = Math.max(0, Math.min(1, msg.volume * MUSIC_GAIN));
      music.play().catch(e => console.warn('[Offscreen] music play blocked:', e.message));
      break;

    case 'STOP_MUSIC':
      music.pause();
      music.currentTime = 0;
      break;

    case 'SET_MUSIC_VOLUME':
      music.volume = Math.max(0, Math.min(1, msg.volume * MUSIC_GAIN));
      break;

    case 'PLAY_WEATHER':
      if (msg.url && weather.src !== msg.url) weather.src = msg.url;
      if (msg.volume !== undefined) weather.volume = Math.max(0, Math.min(1, msg.volume * WEATHER_GAIN));
      weather.play().catch(e => console.warn('[Offscreen] weather play blocked:', e.message));
      break;

    case 'STOP_WEATHER':
      weather.pause();
      weather.currentTime = 0;
      break;

    case 'SET_WEATHER_VOLUME':
      weather.volume = Math.max(0, Math.min(1, msg.volume * WEATHER_GAIN));
      break;

    case 'PLAY_SOUND': {
      // One-shot, round-robin pool so multiple sounds can overlap
      const sfx = sfxPool[sfxIdx % SFX_POOL_SIZE];
      sfxIdx++;
      sfx.src    = msg.url;
      sfx.volume = Math.max(0, Math.min(1, msg.volume ?? 0.9));
      sfx.currentTime = 0;
      sfx.play().catch(e => console.warn('[Offscreen] sfx play blocked:', e.message));
      break;
    }

    // Legacy - keep for backwards compat
    case 'PLAY_AUDIO':
      if (msg.url && music.src !== msg.url) music.src = msg.url;
      music.volume = msg.volume ?? 0.8;
      music.play().catch(() => {});
      break;

    case 'STOP_AUDIO':
      music.pause(); music.currentTime = 0;
      break;

    case 'SET_VOLUME':
      music.volume = Math.max(0, Math.min(1, msg.volume));
      break;
  }
});
