// reader.js — renders a locally-cached article body for offline reading on Mac.
// Works with no network: the body was sanitized + cached in IndexedDB at capture
// time (see offline.js / background.js). Re-sanitizes on render as defense in
// depth in case the cache was ever tampered with.

// Theme palette, kept in sync with popup.js / the iOS app's AppTheme.
// wash/washDark are PRECOMPUTED RGB triples of the accent, brightened for use
// as a background fill. They're precomputed because the Swift/iOS version
// derives them with HSB maths (saturation x1.25, brightness lifted to 0.92 in
// light only) that CSS cannot do — do not try to re-derive them in JS.
const READER_THEMES = {
  aurora:    { accent: '#4F4A9E', accentDark: '#A8A4E8', wash: '88, 79, 235',   washDark: '152, 147, 232' },
  sunset:    { accent: '#A8471F', accentDark: '#E39468', wash: '235, 68, 0',    washDark: '227, 128, 73' },
  ocean:     { accent: '#1F5F6B', accentDark: '#86C2CE', wash: '26, 202, 235',  washDark: '116, 191, 206' },
  forest:    { accent: '#3D6046', accentDark: '#92BA9C', wash: '128, 235, 155', washDark: '136, 186, 149' },
  dusk:      { accent: '#6B3A6E', accentDark: '#CFA0D2', wash: '227, 96, 235',  washDark: '206, 147, 210' },
  rose:      { accent: '#8C2A28', accentDark: '#DA8177', wash: '235, 29, 25',   washDark: '218, 107, 94' },
  midnight:  { accent: '#23374F', accentDark: '#96AEC6', wash: '71, 146, 235',  washDark: '138, 168, 198' },
  // Parchment — the muted tan/sepia that matches the ink-on-cream app icons.
  parchment: { accent: '#6B5741', accentDark: '#C9B291', wash: '235, 180, 119', washDark: '201, 172, 131' },
};

// Apply the user's selected theme + ground to the reader's CSS variables.
async function applyReaderTheme() {
  try {
    const { appTheme = 'parchment', ground = 'paper' } =
      await chrome.storage.local.get(['appTheme', 'ground']);
    const t = READER_THEMES[appTheme] || READER_THEMES.parchment;
    const el = document.documentElement.style;
    el.setProperty('--accent-light', t.accent);
    el.setProperty('--accent-dark',  t.accentDark);
    el.setProperty('--wash-light',   t.wash);
    el.setProperty('--wash-dark',    t.washDark);
    document.documentElement.dataset.ground = ground;
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

  document.title = (rec.title || 'Reader') + ' — Clipfile';
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
