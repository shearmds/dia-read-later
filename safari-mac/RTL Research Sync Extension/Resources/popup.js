const THEMES = [
  { id: 'sunset',   start: '#ff8a4c', end: '#ec407a' },
  { id: 'ocean',    start: '#26c6da', end: '#1565c0' },
  { id: 'forest',   start: '#9ccc65', end: '#2e7d32' },
  { id: 'dusk',     start: '#ab47bc', end: '#3949ab' },
  { id: 'rose',     start: '#f48fb1', end: '#c62828' },
  { id: 'midnight', start: '#1a237e', end: '#0d47a1' },
];

function applyTheme(id) {
  const t = THEMES.find(t => t.id === id) ?? THEMES[0];
  document.documentElement.style.setProperty('--theme-start', t.start);
  document.documentElement.style.setProperty('--theme-end', t.end);
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === t.id);
  });
}

function buildThemeBar() {
  const bar = document.getElementById('theme-bar');
  THEMES.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'theme-swatch';
    btn.dataset.theme = t.id;
    btn.title = t.id.charAt(0).toUpperCase() + t.id.slice(1);
    btn.style.background = `linear-gradient(135deg, ${t.start}, ${t.end})`;
    btn.addEventListener('click', async () => {
      await chrome.storage.local.set({ appTheme: t.id });
      applyTheme(t.id);
    });
    bar.appendChild(btn);
  });
}

let allItems = [];
/* CHANGE: Changed default filter from "all" to "unread" */
let currentFilter = "unread";
let searchQuery = "";
// Grouped-by-folder view. Local to this browser/extension only — not synced,
// so Chrome can show folders while the iOS app (say) still shows a flat list.
let groupByFolder = false;
// Which folder section headers are collapsed. Also local-only; keyed by
// folder name (a Set, persisted as an array).
let collapsedFolders = new Set();
// The most recently classified item, so its folder can show a "new" dot if
// that section is collapsed — lets you spot where it landed without
// hunting. Session-only (this popup's lifetime), cleared once you expand
// that folder (or it expires — see RECENT_CLASSIFY_DOT_WINDOW_MS).
let recentlyClassified = null; // { url, folder, at }
const RECENT_CLASSIFY_DOT_WINDOW_MS = 5 * 60 * 1000;

function recentlyClassifiedFolder() {
  if (!recentlyClassified) return null;
  if (Date.now() - recentlyClassified.at > RECENT_CLASSIFY_DOT_WINDOW_MS) return null;
  return recentlyClassified.folder;
}

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const searchEl = document.getElementById("search");
const searchWrapEl = document.getElementById("search-wrap");
const searchClearBtn = document.getElementById("search-clear");
const saveBtn = document.getElementById("save-btn");
const folderToggleBtn = document.getElementById("folder-toggle");

async function load() {
  buildThemeBar();
  const { readLater = [], appTheme = 'ocean', folderView = false, collapsedFolders: storedCollapsed = [] } =
    await chrome.storage.local.get(['readLater', 'appTheme', 'folderView', 'collapsedFolders']);
  applyTheme(appTheme);
  allItems = readLater;
  groupByFolder = folderView;
  collapsedFolders = new Set(storedCollapsed);
  folderToggleBtn.classList.toggle("active", groupByFolder);

  /* CHANGE: Ensure the visual UI classes match our "unread" default on startup */
  document.querySelectorAll(".filter").forEach((b) => {
    if (b.dataset.filter === "unread") {
      b.classList.add("active");
    } else {
      b.classList.remove("active");
    }
  });

  render();
}

// Pick up background-worker writes (e.g. the 1-minute alarm sync, or a
// classify result landing) while the popup is already open, instead of only
// refreshing on the next explicit action or reopen.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.readLater) return;
  const oldItems = changes.readLater.oldValue || [];
  const newItems = changes.readLater.newValue || [];
  const oldFolders = new Map(oldItems.map((i) => [i.url, i.folder]));
  for (const item of newItems) {
    // "Existed before with no folder, now has one" — a genuine classify
    // transition, not a brand-new item or one that already had a folder.
    if (item.folder && oldFolders.has(item.url) && !oldFolders.get(item.url)) {
      recentlyClassified = { url: item.url, folder: item.folder, at: Date.now() };
    }
  }
  allItems = newItems;
  render();
});

// While any visible item is still within the "Sorting…" window, or the
// "new" dot is still live, periodically re-render so both correctly fade
// away on their own once their window elapses, even with no storage change
// (e.g. classification was skipped because of the daily rate cap).
setInterval(() => {
  const hasPending = allItems.some((i) => !i.folder && isPendingClassification(i));
  if (hasPending || recentlyClassifiedFolder()) render();
}, 5000);

function filtered() {
  return allItems.filter((item) => {
    if (item.deleted) return false;
    if (currentFilter === "unread" && item.read) return false;
    if (currentFilter === "read" && !item.read) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q);
    }
    return true;
  });
}

// Mirrors ReadLater's ArticleCategory.swift (Shared (App)/ArticleCategory.swift)
// so the Chrome/Dia extension shows the same domain tags as the iOS app.
const CATEGORY_COLORS = {
  News: '#007aff', Video: '#ff3b30', Dev: '#af52de',
  Social: '#ff2d55', Shopping: '#34c759', Govt: '#5856d6',
};

const CATEGORY_DOMAINS = {
  // US newspapers / wire services
  'nytimes.com': 'News', 'wsj.com': 'News', 'washingtonpost.com': 'News',
  'usatoday.com': 'News', 'latimes.com': 'News', 'chicagotribune.com': 'News',
  'nypost.com': 'News', 'nydailynews.com': 'News', 'sfchronicle.com': 'News',
  'bostonglobe.com': 'News', 'dallasnews.com': 'News', 'miamiherald.com': 'News',
  'denverpost.com': 'News', 'seattletimes.com': 'News', 'startribune.com': 'News',
  'inquirer.com': 'News', 'ajc.com': 'News', 'statesman.com': 'News',
  'reuters.com': 'News', 'apnews.com': 'News', 'upi.com': 'News',
  // US cable / broadcast / public radio
  'cnn.com': 'News', 'foxnews.com': 'News', 'nbcnews.com': 'News',
  'abcnews.go.com': 'News', 'cbsnews.com': 'News', 'msnbc.com': 'News',
  'pbs.org': 'News', 'npr.org': 'News',
  // UK / Ireland
  'theguardian.com': 'News', 'bbc.com': 'News', 'bbc.co.uk': 'News',
  'thetimes.co.uk': 'News', 'thetimes.com': 'News', 'telegraph.co.uk': 'News',
  'independent.co.uk': 'News', 'dailymail.co.uk': 'News', 'mirror.co.uk': 'News',
  'ft.com': 'News', 'economist.com': 'News', 'standard.co.uk': 'News',
  'metro.co.uk': 'News', 'news.sky.com': 'News', 'itv.com': 'News',
  'irishtimes.com': 'News',
  // International
  'aljazeera.com': 'News', 'dw.com': 'News', 'france24.com': 'News',
  'lemonde.fr': 'News', 'spiegel.de': 'News', 'scmp.com': 'News',
  'japantimes.co.jp': 'News', 'straitstimes.com': 'News',
  'smh.com.au': 'News', 'theage.com.au': 'News', 'abc.net.au': 'News',
  'cbc.ca': 'News', 'globalnews.ca': 'News', 'theglobeandmail.com': 'News',
  'nationalpost.com': 'News',
  // Politics
  'politico.com': 'News', 'axios.com': 'News', 'thehill.com': 'News',
  'realclearpolitics.com': 'News',
  // Business / finance
  'bloomberg.com': 'News', 'cnbc.com': 'News', 'marketwatch.com': 'News',
  'forbes.com': 'News', 'fortune.com': 'News', 'businessinsider.com': 'News',
  'barrons.com': 'News', 'fastcompany.com': 'News', 'inc.com': 'News',
  // Magazines / long-form / opinion
  'theatlantic.com': 'News', 'newyorker.com': 'News', 'vox.com': 'News',
  'slate.com': 'News', 'salon.com': 'News', 'time.com': 'News',
  'newsweek.com': 'News', 'thedailybeast.com': 'News', 'harpers.org': 'News',
  'vanityfair.com': 'News', 'gq.com': 'News', 'esquire.com': 'News',
  'rollingstone.com': 'News', 'motherjones.com': 'News', 'propublica.org': 'News',
  'theintercept.com': 'News', 'nationalreview.com': 'News', 'thenation.com': 'News',
  'reason.com': 'News', 'semafor.com': 'News', 'puck.news': 'News',
  // Tech journalism
  'theverge.com': 'News', 'macrumors.com': 'News', 'techcrunch.com': 'News',
  'arstechnica.com': 'News', 'engadget.com': 'News', 'gizmodo.com': 'News',
  'mashable.com': 'News', 'cnet.com': 'News', 'zdnet.com': 'News',
  'wired.com': 'News', '9to5mac.com': 'News', '9to5google.com': 'News',
  'androidcentral.com': 'News',
  // Science
  'scientificamerican.com': 'News', 'nature.com': 'News',
  'newscientist.com': 'News', 'popsci.com': 'News', 'smithsonianmag.com': 'News',
  // Sports
  'espn.com': 'News', 'si.com': 'News', 'theathletic.com': 'News',
  'bleacherreport.com': 'News',
  // Entertainment
  'variety.com': 'News', 'hollywoodreporter.com': 'News', 'ew.com': 'News',
  'people.com': 'News', 'eonline.com': 'News',

  'youtube.com': 'Video', 'youtu.be': 'Video', 'vimeo.com': 'Video', 'twitch.tv': 'Video',

  'github.com': 'Dev', 'gitlab.com': 'Dev', 'stackoverflow.com': 'Dev',
  'news.ycombinator.com': 'Dev', 'dev.to': 'Dev', 'medium.com': 'Dev', 'arxiv.org': 'Dev',

  'twitter.com': 'Social', 'x.com': 'Social', 'reddit.com': 'Social',
  'instagram.com': 'Social', 'threads.net': 'Social', 'facebook.com': 'Social',
  'linkedin.com': 'Social',

  'amazon.com': 'Shopping', 'etsy.com': 'Shopping',
};

function categoryFor(urlString) {
  let host;
  try { host = new URL(urlString).hostname.toLowerCase(); } catch { return null; }
  if (host.startsWith('www.')) host = host.slice(4);

  if (host === 'gov' || host.endsWith('.gov') || host === 'mil' || host.endsWith('.mil')
      || host === 'gov.uk' || host.endsWith('.gov.uk')) {
    return 'Govt';
  }
  if (CATEGORY_DOMAINS[host]) return CATEGORY_DOMAINS[host];
  for (const domain in CATEGORY_DOMAINS) {
    if (host.endsWith('.' + domain)) return CATEGORY_DOMAINS[domain];
  }
  return null;
}

// Browser's local favicon cache (no third-party request). Only has icons for
// sites the browser has already seen, so we fall back to Google for the rest.
function localFaviconUrl(url) {
  try {
    const u = new URL(chrome.runtime.getURL("/_favicon/"));
    u.searchParams.set("pageUrl", url);
    u.searchParams.set("size", "64");
    return u.toString();
  } catch {
    return "";
  }
}

function googleFaviconUrl(url) {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return "";
  }
}

// Inline line-icons (lucide-style, currentColor) so the action row reads like
// the iOS app's SF Symbols rather than mismatched text glyphs.
const ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  // Open book — "read offline", mirrors the iOS app's book icon.
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  // Closed book — offline unavailable.
  bookClosed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/></svg>',
  // Download — "save for offline".
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 12 5 5 5-5"/><path d="M5 21h14"/></svg>',
};

// How long to show "Sorting…" on a folder-less item before assuming
// classification just isn't coming (rate-capped, no API key, etc.) and
// falling back to showing nothing rather than a spinner that never resolves.
const CLASSIFY_PENDING_WINDOW_MS = 3 * 60 * 1000;

function isPendingClassification(item) {
  return !item.deleted && Date.now() - item.savedAt < CLASSIFY_PENDING_WINDOW_MS;
}

function buildItemEl(item, { showFolder }) {
  const li = document.createElement("li");
  li.className = "item" + (item.read ? " is-read" : "");
  li.dataset.url = item.url;

  const favicon = document.createElement("img");
  favicon.className = "item-favicon";
  // Try the browser's local cache first, then Google, then hide.
  favicon.onerror = () => {
    const google = googleFaviconUrl(item.url);
    if (favicon.src !== google && google) {
      favicon.src = google;
    } else {
      favicon.onerror = null;
      favicon.style.visibility = "hidden";
    }
  };
  favicon.src = localFaviconUrl(item.url) || googleFaviconUrl(item.url);

  const body = document.createElement("div");
  body.className = "item-body";
  const title = document.createElement("div");
  title.className = "item-title";
  title.textContent = item.title;
  const meta = document.createElement("div");
  meta.className = "item-meta";
  const urlEl = document.createElement("span");
  urlEl.className = "item-url";
  try { urlEl.textContent = new URL(item.url).hostname; } catch { urlEl.textContent = item.url; }
  meta.append(urlEl);
  // The older URL-derived category tag was removed (redundant with the AI
  // folder tag below); `categoryFor` is kept for now in case it's reused.
  // Only shown in flat view — in grouped view the folder is already the
  // section header, so repeating it on every item would be redundant.
  if (showFolder && item.folder) {
    const folderTag = document.createElement("span");
    folderTag.className = "item-folder";
    folderTag.textContent = item.folder;
    meta.append(folderTag);
  } else if (!item.folder && isPendingClassification(item)) {
    // Shown in both views (unlike the folder tag) — this is meaningful even
    // inside the "Unsorted" group, since it explains *why* it's still there.
    const pending = document.createElement("span");
    pending.className = "item-sorting";
    pending.title = "AI is assigning a folder — usually takes a few seconds";
    pending.innerHTML = '<span class="item-sorting-spinner"></span>Sorting…';
    meta.append(pending);
  }
  if (item.notes) {
    const noteIndicator = document.createElement("span");
    noteIndicator.className = "item-note-indicator";
    noteIndicator.textContent = "✎";
    noteIndicator.title = "Has a note";
    meta.append(noteIndicator);
  }
  body.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "item-actions";
  const readBtn = document.createElement("button");
  readBtn.title = item.read ? "Mark unread" : "Mark read";
  readBtn.innerHTML = item.read ? ICONS.undo : ICONS.check;
  readBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleRead(item.url); });

  const noteBtn = document.createElement("button");
  noteBtn.title = item.notes ? "Edit note" : "Add note";
  noteBtn.innerHTML = ICONS.note;
  if (item.notes) noteBtn.style.color = "#1565c0";
  noteBtn.addEventListener("click", (e) => { e.stopPropagation(); openNotesPanel(item); });

  const offlineBtn = document.createElement("button");
  const offlineState = item.offline || "none";
  offlineBtn.className = "offline-btn offline-" + offlineState;
  if (offlineState === "saved") {
    offlineBtn.innerHTML = ICONS.book;
    offlineBtn.title = "Read offline";
    offlineBtn.addEventListener("click", (e) => { e.stopPropagation(); openReader(item.url); });
  } else if (offlineState === "requested") {
    offlineBtn.innerHTML = '<span class="offline-spinner"></span>';
    offlineBtn.title = "Saving for offline…";
    offlineBtn.disabled = true;
  } else if (offlineState === "unavailable") {
    offlineBtn.innerHTML = ICONS.bookClosed;
    offlineBtn.title = "Offline not available — click to retry";
    offlineBtn.addEventListener("click", (e) => { e.stopPropagation(); makeOffline(item.url); });
  } else {
    offlineBtn.innerHTML = ICONS.download;
    offlineBtn.title = "Save for offline";
    offlineBtn.addEventListener("click", (e) => { e.stopPropagation(); makeOffline(item.url); });
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.title = "Remove";
  deleteBtn.innerHTML = ICONS.trash;
  deleteBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteItem(item.url); });

  actions.append(offlineBtn, readBtn, noteBtn, deleteBtn);
  li.append(favicon, body, actions);
  li.addEventListener("click", () => {
    chrome.tabs.create({ url: item.url });
    if (!item.read) toggleRead(item.url);
  });
  return li;
}

const UNSORTED = "Unsorted";

function render() {
  const items = filtered();
  listEl.innerHTML = "";
  if (items.length === 0) {
    emptyEl.classList.add("visible");
    return;
  }
  emptyEl.classList.remove("visible");

  // Searching wants a flat scan of every match, not results scattered
  // (and possibly hidden in a collapsed section) across folders — so a
  // search query suppresses grouping without changing the saved preference.
  const effectiveGrouped = groupByFolder && !searchQuery;

  if (!effectiveGrouped) {
    for (const item of items) {
      listEl.appendChild(buildItemEl(item, { showFolder: true }));
    }
    return;
  }

  // Group by folder, preserving each group's internal (already-sorted) order.
  // Named folders come first (alphabetically); "Unsorted" always comes last —
  // it's not a real folder, just everything the classifier hasn't reached yet.
  const groups = new Map();
  for (const item of items) {
    const key = item.folder || UNSORTED;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const folderNames = [...groups.keys()]
    .filter((k) => k !== UNSORTED)
    .sort((a, b) => a.localeCompare(b));
  if (groups.has(UNSORTED)) folderNames.push(UNSORTED);

  for (const folderName of folderNames) {
    const groupItems = groups.get(folderName);
    const isCollapsed = collapsedFolders.has(folderName);

    const header = document.createElement("li");
    header.className = "group-header" + (isCollapsed ? " collapsed" : "");

    const chevron = document.createElement("span");
    chevron.className = "group-header-chevron";
    chevron.textContent = "▾";

    const label = document.createElement("span");
    label.textContent = folderName;

    header.append(chevron, label);

    // Only meaningful while collapsed — if the section is already open,
    // the newly-classified item is already visible in place, no dot needed.
    if (isCollapsed && recentlyClassifiedFolder() === folderName) {
      const dot = document.createElement("span");
      dot.className = "group-header-dot";
      dot.title = "A new item just landed here";
      header.append(dot);
    }

    const count = document.createElement("span");
    count.className = "group-header-count";
    count.textContent = groupItems.length;
    header.append(count);

    header.addEventListener("click", async () => {
      if (collapsedFolders.has(folderName)) {
        collapsedFolders.delete(folderName);
        if (recentlyClassified?.folder === folderName) recentlyClassified = null;
      } else {
        collapsedFolders.add(folderName);
      }
      await chrome.storage.local.set({ collapsedFolders: [...collapsedFolders] });
      render();
    });
    listEl.appendChild(header);

    if (!isCollapsed) {
      for (const item of groupItems) {
        listEl.appendChild(buildItemEl(item, { showFolder: false }));
      }
    }
  }
}

async function save() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url || tab.url.startsWith("chrome://")) return;
  const existing = allItems.find((i) => i.url === tab.url);
  const alreadySaved = existing && !existing.deleted;
  if (!existing) {
    const now = Date.now();
    allItems.unshift({ url: tab.url, title: tab.title || tab.url, savedAt: now, read: false, updatedAt: now, deleted: false });
    await chrome.storage.local.set({ readLater: allItems });
    chrome.runtime.sendMessage({ action: 'syncNow' });
  } else if (existing.deleted) {
    const now = Date.now();
    existing.deleted = false;
    existing.read = false;
    existing.title = tab.title || tab.url;
    existing.savedAt = now;
    existing.updatedAt = now;
    await chrome.storage.local.set({ readLater: allItems });
    chrome.runtime.sendMessage({ action: 'syncNow' });
  }
  saveBtn.textContent = alreadySaved ? "Already saved" : "Saved!";
  saveBtn.classList.add("saved");
  setTimeout(() => { saveBtn.textContent = "+ Save"; saveBtn.classList.remove("saved"); }, 1500);
  render();

  // Automatically capture an offline copy on save (unless it already has one).
  // makeOffline runs in the background service worker, so it finishes even if
  // this popup closes, and it extracts from the already-open active tab.
  if (!existing || existing.offline !== "saved") {
    makeOffline(tab.url);
  }
}

async function toggleRead(url) {   
  const now = Date.now();
  allItems = allItems.map((i) => i.url === url ? { ...i, read: !i.read, updatedAt: now } : i);   
  await chrome.storage.local.set({ readLater: allItems });   
  render(); 
  
  chrome.runtime.sendMessage({ action: 'syncNow' });
}

async function setNotes(url, notes) {
  const now = Date.now();
  allItems = allItems.map((i) => i.url === url ? { ...i, notes: notes || undefined, updatedAt: now } : i);
  await chrome.storage.local.set({ readLater: allItems });
  render();

  chrome.runtime.sendMessage({ action: 'syncNow' });
}

async function deleteItem(url) {
  const now = Date.now();
  allItems = allItems.map((i) => i.url === url ? { ...i, deleted: true, updatedAt: now } : i);
  await chrome.storage.local.set({ readLater: allItems });
  render();

  chrome.runtime.sendMessage({ action: 'syncNow' });
  // GC the offline body (local cache + encrypted remote copy).
  chrome.runtime.sendMessage({ action: 'deleteBody', url });
}

// Ask the service worker to capture this article for offline reading. Show the
// "requested" state immediately, then reflect whatever the worker settled on.
async function makeOffline(url) {
  allItems = allItems.map((i) => i.url === url ? { ...i, offline: "requested" } : i);
  render();
  try {
    await chrome.runtime.sendMessage({ action: "makeOffline", url });
  } catch {
    // service worker unreachable — fall through to re-read storage
  }
  const { readLater = [] } = await chrome.storage.local.get("readLater");
  allItems = readLater;
  render();
}

function openReader(url) {
  const readerUrl = chrome.runtime.getURL("reader.html") + "?url=" + encodeURIComponent(url);
  chrome.tabs.create({ url: readerUrl });
}

function exportData() {
  const json = JSON.stringify(allItems, null, 2);
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

function exportCSV() {
  const rows = [["Title", "URL", "Saved", "Read", "Folder", "Notes"]];
  for (const item of allItems.filter((i) => !i.deleted)) {
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
      const existingUrls = new Set(allItems.map((i) => i.url));       
      const newItems = valid.filter((i) => !existingUrls.has(i.url));       
      allItems = [...newItems, ...allItems];       
      await chrome.storage.local.set({ readLater: allItems });       
      render();       
      
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

document.getElementById("shortcut-btn").addEventListener("click", () => {   
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" }); 
});

document.getElementById("export-btn").addEventListener("click", exportData);
document.getElementById("export-csv-btn").addEventListener("click", exportCSV); 

document.getElementById("import-input").addEventListener("change", (e) => {   
  if (e.target.files[0]) importData(e.target.files[0]);   
  e.target.value = ""; 
});

saveBtn.addEventListener("click", save); 

searchEl.addEventListener("input", () => {
  searchQuery = searchEl.value.trim();
  searchWrapEl.classList.toggle("has-value", !!searchQuery);
  folderToggleBtn.classList.toggle("suspended", groupByFolder && !!searchQuery);
  render();
});

searchClearBtn.addEventListener("click", () => {
  searchEl.value = "";
  searchQuery = "";
  searchWrapEl.classList.remove("has-value");
  folderToggleBtn.classList.remove("suspended");
  searchEl.focus();
  render();
});

document.querySelectorAll(".filter:not(.filter-toggle)").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter:not(.filter-toggle)").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    render();
  });
});

folderToggleBtn.addEventListener("click", async () => {
  groupByFolder = !groupByFolder;
  folderToggleBtn.classList.toggle("active", groupByFolder);
  await chrome.storage.local.set({ folderView: groupByFolder });
  render();
});

// --- Settings panel (data + sync key) ---
const settingsPanel = document.getElementById("settings-panel");
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

document.getElementById("settings-btn").addEventListener("click", () => {
  const willOpen = !settingsPanel.classList.contains("open");
  settingsPanel.classList.toggle("open", willOpen);
  if (willOpen) loadSyncKey();
});

document.getElementById("settings-done").addEventListener("click", () => {
  settingsPanel.classList.remove("open");
});

// --- Notes panel ---
const notesPanel = document.getElementById("notes-panel");
const notesPanelTitle = document.getElementById("notes-panel-title");
const notesPanelUrl = document.getElementById("notes-panel-url");
const notesTextarea = document.getElementById("notes-textarea");
let notesEditingUrl = null;

function openNotesPanel(item) {
  notesEditingUrl = item.url;
  notesPanelTitle.textContent = item.title;
  notesPanelUrl.textContent = item.url;
  notesTextarea.value = item.notes || "";
  notesPanel.classList.add("open");
  notesTextarea.focus();
}

function closeNotesPanel() {
  notesPanel.classList.remove("open");
  notesEditingUrl = null;
}

document.getElementById("notes-save").addEventListener("click", () => {
  if (notesEditingUrl) setNotes(notesEditingUrl, notesTextarea.value.trim());
  closeNotesPanel();
});

document.getElementById("notes-cancel").addEventListener("click", closeNotesPanel);

document.getElementById("notes-panel-open").addEventListener("click", () => {
  if (!notesEditingUrl) return;
  const url = notesEditingUrl;
  setNotes(url, notesTextarea.value.trim());
  if (!allItems.find((i) => i.url === url)?.read) toggleRead(url);
  chrome.tabs.create({ url });
  closeNotesPanel();
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
  chrome.runtime.sendMessage({ action: "syncNow" }, async () => {
    const { readLater = [] } = await chrome.storage.local.get("readLater");
    allItems = readLater;
    render();
    showSyncKeyMsg("Saved — syncing");
  });
});

load();