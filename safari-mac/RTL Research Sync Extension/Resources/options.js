// options.js — the extension's settings, split out of the old popup so a
// save-only toolbar action has somewhere for its preferences to live.
//
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
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === t.id);
  });
  // Persist the resolved pair so background.js can tint the save toast without
  // carrying a fourth copy of the palette. The table already lives here, in
  // reader.js and in welcome.js; a fifth would be the Parchment situation all
  // over again.
  chrome.storage.local.set({ accentPair: { light: t.accent, dark: t.accentDark } });
}

function applyGround(ground) {
  document.documentElement.dataset.ground = ground;
  document.querySelectorAll('.ground-option').forEach(el => {
    el.classList.toggle('active', el.dataset.ground === ground);
  });
}

function buildThemeBar() {
  const bar = document.getElementById('theme-bar');
  THEMES.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'theme-swatch';
    btn.dataset.theme = t.id;
    btn.title = t.id.charAt(0).toUpperCase() + t.id.slice(1);
    // Both halves as custom properties, flat - options.css picks with
    // prefers-color-scheme, the same way the token block does.
    btn.style.setProperty('--sw-light', t.accent);
    btn.style.setProperty('--sw-dark', t.accentDark);
    btn.addEventListener('click', async () => {
      await chrome.storage.local.set({ appTheme: t.id });
      applyTheme(t.id);
    });
    bar.appendChild(btn);
  });
}

// Shows the shortcut that is actually bound right now, rather than the one the
// manifest suggested.
//
// **`chrome.commands` is read-only on purpose.** `getAll()` reports the
// bindings; there is no setter and deliberately never has been, because an
// extension that could silently claim a key combination would be a keylogger
// with extra steps. So the shortcut IS user-selectable — just only through
// `chrome://extensions/shortcuts`. The most this page can do is say what the
// binding currently is and open that page.
//
// The manifest suggests Alt+S. Chrome drops a suggested default silently when
// another extension already holds the combination, which is exactly why the
// live value has to be read: otherwise this page advertises a shortcut that
// does nothing.
async function renderShortcut() {
  const el = document.getElementById("shortcut-value");
  if (!el) return;
  try {
    const commands = await chrome.commands.getAll();
    const save = commands.find((c) => c.name === "save-page");
    el.textContent = save && save.shortcut ? save.shortcut : "Not set";
    el.classList.toggle("unset", !(save && save.shortcut));
  } catch {
    el.textContent = "Unavailable";
  }
}

async function exportData() {
  const { readLater = [] } = await chrome.storage.local.get("readLater");
  const json = JSON.stringify(readLater, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `read-later-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvField(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCSV() {
  const { readLater = [] } = await chrome.storage.local.get("readLater");
  const rows = [["Title", "URL", "Saved", "Read", "Folder", "Notes"]];
  for (const item of readLater.filter((i) => !i.deleted)) {
    rows.push([
      item.title,
      item.url,
      new Date(item.savedAt).toISOString(),
      item.read ? "Yes" : "No",
      item.folder || "",
      item.notes || "",
    ]);
  }
  const csv = rows.map((row) => row.map(csvField).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `read-later-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error("Invalid format");
      const valid = imported.filter((i) => i.url && i.title);
      // No in-memory list lives on this page (the list view moved to the Mac
      // app), so the merge reads straight from storage instead of a global.
      const { readLater: existingItems = [] } = await chrome.storage.local.get("readLater");
      const existingUrls = new Set(existingItems.map((i) => i.url));
      const newItems = valid.filter((i) => !existingUrls.has(i.url));
      const merged = [...newItems, ...existingItems];
      await chrome.storage.local.set({ readLater: merged });

      chrome.runtime.sendMessage({ action: 'syncNow' });

      const msg = document.getElementById("import-msg");
      msg.textContent = `+${newItems.length} imported`;
      setTimeout(() => { msg.textContent = ""; }, 2500);
    } catch {
      const msg = document.getElementById("import-msg");
      msg.style.color = "#ff3b30";
      msg.textContent = "Invalid file";
      setTimeout(() => { msg.textContent = ""; msg.style.color = "#34c759"; }, 2500);
    }
  };
  reader.readAsText(file);
}

const syncKeyInput = document.getElementById("synckey-input");
const syncKeyMsg = document.getElementById("synckey-msg");

function showSyncKeyMsg(text, isError = false) {
  syncKeyMsg.textContent = text;
  syncKeyMsg.style.color = isError ? "#ff3b30" : "#34c759";
  setTimeout(() => { syncKeyMsg.textContent = ""; }, 2500);
}

async function loadSyncKey() {
  const { syncToken = "" } = await chrome.storage.local.get("syncToken");
  syncKeyInput.value = syncToken;
}

async function load() {
  buildThemeBar();
  const { appTheme = 'parchment', ground = 'paper' } =
    await chrome.storage.local.get(['appTheme', 'ground']);
  applyTheme(appTheme);
  applyGround(ground);
  renderShortcut();
  loadSyncKey();
}

document.getElementById("shortcut-btn").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

document.querySelectorAll(".ground-option").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const ground = btn.dataset.ground;
    await chrome.storage.local.set({ ground });
    applyGround(ground);
  });
});

document.getElementById("export-btn").addEventListener("click", exportData);
document.getElementById("export-csv-btn").addEventListener("click", exportCSV);

document.getElementById("import-input").addEventListener("change", (e) => {
  if (e.target.files[0]) importData(e.target.files[0]);
  e.target.value = "";
});

document.getElementById("synckey-copy").addEventListener("click", async () => {
  if (!syncKeyInput.value) return;
  await navigator.clipboard.writeText(syncKeyInput.value);
  showSyncKeyMsg("Copied");
});

document.getElementById("synckey-generate").addEventListener("click", () => {
  syncKeyInput.value =
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "");
  showSyncKeyMsg("Generated — click Save key to use it");
});

document.getElementById("synckey-save").addEventListener("click", async () => {
  const key = syncKeyInput.value.trim();
  if (key.length < 32) {
    showSyncKeyMsg("Key must be at least 32 characters", true);
    return;
  }
  await chrome.storage.local.set({ syncToken: key });
  chrome.runtime.sendMessage({ action: "syncNow" }, () => {
    showSyncKeyMsg("Saved — syncing");
  });
});

load();
