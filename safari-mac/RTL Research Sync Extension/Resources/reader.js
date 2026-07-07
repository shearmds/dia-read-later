// reader.js — renders a locally-cached article body for offline reading on Mac.
// Works with no network: the body was sanitized + cached in IndexedDB at capture
// time (see offline.js / background.js). Re-sanitizes on render as defense in
// depth in case the cache was ever tampered with.

(async () => {
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
