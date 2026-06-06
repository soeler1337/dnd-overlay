// Service Worker - Milestone 1: message bus skeleton only.
// Audio, Supabase and scene logic are added in later milestones.

chrome.runtime.onInstalled.addListener(() => {
  console.log('[DnD Overlay] Extension installed / updated.');
});

// Central message handler - content scripts and popup talk through here.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[SW] received message:', msg.type, msg);

  switch (msg.type) {
    case 'PING':
      sendResponse({ status: 'ok' });
      break;

    // Future: SCENE_CHANGE, PLAY_AUDIO, STOP_AUDIO, etc.

    default:
      console.warn('[SW] unknown message type:', msg.type);
  }

  // Return true only when sendResponse will be called asynchronously.
  return false;
});
