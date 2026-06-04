// Silica AI — service worker.
// Its only job is to make a click on the toolbar icon open the side panel.

function enableActionToOpenPanel() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({openPanelOnActionClick: true})
      .catch((err) => console.warn('[Silica AI] setPanelBehavior failed', err));
  }
}

chrome.runtime.onInstalled.addListener(enableActionToOpenPanel);
chrome.runtime.onStartup.addListener(enableActionToOpenPanel);
// Run once when the worker first spins up too.
enableActionToOpenPanel();
