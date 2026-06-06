// Offscreen Document - audio playback for MV3.
// Two independent channels: scene music + weather ambient.

const music   = new Audio(); music.loop   = true;
const weather = new Audio(); weather.loop = true;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;

  switch (msg.type) {

    case 'PLAY_MUSIC':
      if (msg.url && music.src !== msg.url) music.src = msg.url;
      music.volume = msg.volume ?? 0.8;
      music.play().catch(e => console.warn('[Offscreen] music play blocked:', e.message));
      break;

    case 'STOP_MUSIC':
      music.pause();
      music.currentTime = 0;
      break;

    case 'SET_MUSIC_VOLUME':
      music.volume = Math.max(0, Math.min(1, msg.volume));
      break;

    case 'PLAY_WEATHER':
      if (msg.url && weather.src !== msg.url) weather.src = msg.url;
      weather.volume = msg.volume ?? 0.4;
      weather.play().catch(e => console.warn('[Offscreen] weather play blocked:', e.message));
      break;

    case 'STOP_WEATHER':
      weather.pause();
      weather.currentTime = 0;
      break;

    case 'SET_WEATHER_VOLUME':
      weather.volume = Math.max(0, Math.min(1, msg.volume));
      break;

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
