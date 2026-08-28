// Mirrors the THEMES table in popup.js so the welcome page picks up whatever
// theme (if any) is already stored — falls back to the default (ocean).
const THEMES = [
  { id: 'sunset',    start: '#ff8a4c', end: '#ec407a' },
  { id: 'ocean',     start: '#26c6da', end: '#1565c0' },
  { id: 'forest',    start: '#9ccc65', end: '#2e7d32' },
  { id: 'dusk',      start: '#ab47bc', end: '#3949ab' },
  { id: 'rose',      start: '#f48fb1', end: '#c62828' },
  { id: 'midnight',  start: '#1a237e', end: '#0d47a1' },
  // Parchment — the muted tan/sepia that matches the ink-on-cream app icons.
  { id: 'parchment', start: '#b49a72', end: '#6b5741' },
];

function applyTheme(id) {
  const t = THEMES.find(t => t.id === id) ?? THEMES[0];
  document.documentElement.style.setProperty('--theme-start', t.start);
  document.documentElement.style.setProperty('--theme-end', t.end);
}

// Same generation scheme as background.js's getToken(), so opening this page
// on a brand-new install still shows (and persists) a real sync key.
async function getOrCreateToken() {
  const { syncToken } = await chrome.storage.local.get('syncToken');
  if (syncToken) return syncToken;
  const generated =
    crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '');
  await chrome.storage.local.set({ syncToken: generated });
  return generated;
}

(async () => {
  const { appTheme = 'ocean' } = await chrome.storage.local.get('appTheme');
  applyTheme(appTheme);

  const token = await getOrCreateToken();
  const keyEl = document.getElementById('sync-key');
  keyEl.textContent = token;

  const copyBtn = document.getElementById('copy-btn');
  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(token);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy Sync Key'; }, 2000);
  });
})();
