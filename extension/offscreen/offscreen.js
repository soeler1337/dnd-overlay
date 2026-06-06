// Offscreen Document - only place in MV3 where audio can play continuously.

const audio = new Audio();
audio.loop  = true;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;

  switch (msg.type) {

    case 'PLAY_AUDIO':
      if (msg.url && audio.src !== msg.url) {
        audio.src = msg.url;
      }
      audio.volume = msg.volume ?? 1.0;
      audio.play().catch(err => console.warn('[Offscreen] play() blocked:', err.message));
      break;

    case 'STOP_AUDIO':
      audio.pause();
      audio.currentTime = 0;
      break;

    case 'SET_VOLUME':
      audio.volume = Math.max(0, Math.min(1, msg.volume));
      break;

    case 'PAUSE_AUDIO':
      audio.pause();
      break;
  }
});
