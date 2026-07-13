// reader.js — renders a locally-cached article body for offline reading on Mac.
// Works with no network: the body was sanitized + cached in IndexedDB at capture
// time (see offline.js / background.js). Re-sanitizes on render as defense in
// depth in case the cache was ever tampered with.

// Theme palette, kept in sync with popup.js / the iOS app's AppTheme.
const READER_THEMES = {
  sunset:   { start: '#ff8a4c', end: '#ec407a' },
  ocean:    { start: '#26c6da', end: '#1565c0' },
  forest:   { start: '#9ccc65', end: '#2e7d32' },
  dusk:     { start: '#ab47bc', end: '#3949ab' },
  rose:     { start: '#f48fb1', end: '#c62828' },
  midnight: { start: '#1a237e', end: '#0d47a1' },
};

// Apply the user's selected theme to the reader's accent CSS variables.
async function applyReaderTheme() {
  try {
    const { appTheme = 'ocean' } = await chrome.storage.local.get('appTheme');
    const t = READER_THEMES[appTheme] || READER_THEMES.ocean;
    document.documentElement.style.setProperty('--theme-start', t.start);
    document.documentElement.style.setProperty('--theme-end', t.end);
  } catch {
    // No stored theme (or no chrome.storage) — the CSS defaults stand.
  }
}

(async () => {
  await applyReaderTheme();

  const statusEl = document.getElementById('status');
  const params = new URLSearchParams(location.search);
  const url = params.get('url');

  if (!url) {
    statusEl.textContent = 'No article specified.';
    return;
  }

  let rec = null;
  try {
    rec = await offlineGetBody(url);
  } catch (e) {
    statusEl.textContent = 'Could not open the offline cache.';
    return;
  }

  // Not cached here — it may have been captured on another device (e.g. the
  // iPhone). Try downloading + decrypting the copy from the Worker.
  if (!rec) {
    statusEl.textContent = 'Downloading saved copy…';
    try {
      const { syncToken } = await chrome.storage.local.get('syncToken');
      if (syncToken) rec = await offlineFetchBody(url, syncToken);
    } catch (e) {
      // fall through to the not-available message
    }
  }

  if (!rec) {
    statusEl.textContent =
      'No offline copy is available for this article yet — open it online once to save it.';
    return;
  }

  document.title = (rec.title || 'Reader') + ' — Research Sync';
  document.getElementById('title').textContent = rec.title || '';
  let host = '';
  try { host = new URL(url).hostname; } catch { host = ''; }
  document.getElementById('site').textContent = rec.siteName || host;
  document.getElementById('original').href = url;

  const clean = DOMPurify.sanitize(rec.html || '', { USE_PROFILES: { html: true } });
  document.getElementById('content').innerHTML = clean;

  document.getElementById('head').hidden = false;
  statusEl.hidden = true;
})();
