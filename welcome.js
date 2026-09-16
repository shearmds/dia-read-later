// Mirrors the THEMES table in popup.js so the welcome page picks up whatever
// theme (if any) is already stored — falls back to the default (parchment).
// wash/washDark are PRECOMPUTED RGB triples of the accent, brightened for use
// as a background fill. They're precomputed because the Swift/iOS version
// derives them with HSB maths (saturation x1.25, brightness lifted to 0.92 in
// light only) that CSS cannot do — do not try to re-derive them in JS.
const THEMES = [
  { id: 'aurora',    accent: '#4F4A9E', accentDark: '#A8A4E8', wash: '88, 79, 235',    washDark: '152, 147, 232' },
  { id: 'sunset',    accent: '#A8471F', accentDark: '#E39468', wash: '235, 68, 0',     washDark: '227, 128, 73' },
  { id: 'ocean',     accent: '#1F5F6B', accentDark: '#86C2CE', wash: '26, 202, 235',   washDark: '116, 191, 206' },
  { id: 'forest',    accent: '#3D6046', accentDark: '#92BA9C', wash: '128, 235, 155',  washDark: '136, 186, 149' },
  { id: 'dusk',      accent: '#6B3A6E', accentDark: '#CFA0D2', wash: '227, 96, 235',   washDark: '206, 147, 210' },
  { id: 'rose',      accent: '#8C2A28', accentDark: '#DA8177', wash: '235, 29, 25',    washDark: '218, 107, 94' },
  { id: 'midnight',  accent: '#23374F', accentDark: '#96AEC6', wash: '71, 146, 235',   washDark: '138, 168, 198' },
  { id: 'parchment', accent: '#6B5741', accentDark: '#C9B291', wash: '235, 180, 119',  washDark: '201, 172, 131' },
];

function applyTheme(id) {
  const t = THEMES.find(t => t.id === id) ?? THEMES[0];
  const el = document.documentElement.style;
  el.setProperty('--accent-light', t.accent);
  el.setProperty('--accent-dark',  t.accentDark);
  el.setProperty('--wash-light',   t.wash);
  el.setProperty('--wash-dark',    t.washDark);
}

function applyGround(ground) {
  document.documentElement.dataset.ground = ground;
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
  const { appTheme = 'parchment', ground = 'paper' } =
    await chrome.storage.local.get(['appTheme', 'ground']);
  applyTheme(appTheme);
  applyGround(ground);

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
