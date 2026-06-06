// Offscreen Document - Audio playback for MV3.
// Milestone 1: skeleton only. Actual playback logic added in Milestone 4.

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;

  switch (msg.type) {
    case 'PLAY_AUDIO':
      // TODO Milestone 4: play msg.url via HTMLAudioElement
      console.log('[Offscreen] PLAY_AUDIO received (not yet implemented):', msg.url);
      break;
    case 'STOP_AUDIO':
      // TODO Milestone 4: stop current track
      console.log('[Offscreen] STOP_AUDIO received (not yet implemented)');
      break;
    default:
      break;
  }
});
