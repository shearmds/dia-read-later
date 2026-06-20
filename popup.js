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

const listEl = document.getElementById("list"); 
const emptyEl = document.getElementById("empty"); 
const searchEl = document.getElementById("search"); 
const saveBtn = document.getElementById("save-btn"); 

async function load() {
  buildThemeBar();
  const { readLater = [], appTheme = 'ocean' } = await chrome.storage.local.get(['readLater', 'appTheme']);
  applyTheme(appTheme);
  allItems = readLater;

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

function faviconUrl(url) {
  try {     
    const origin = new URL(url).origin;     
    return `${origin}/favicon.ico`;   
  } catch {     
    return ""; 
  }
}

function render() {   
  const items = filtered();   
  listEl.innerHTML = "";   
  if (items.length === 0) {     
    emptyEl.classList.add("visible");     
    return;   
  }
  emptyEl.classList.remove("visible");   
  for (const item of items) {     
    const li = document.createElement("li");     
    li.className = "item" + (item.read ? " is-read" : "");     
    li.dataset.url = item.url;     
    
    const favicon = document.createElement("img");     
    favicon.className = "item-favicon";     
    favicon.src = faviconUrl(item.url);     
    favicon.onerror = () => { favicon.style.visibility = "hidden"; };     
    
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
    const category = categoryFor(item.url);
    if (category) {
      const tag = document.createElement("span");
      tag.className = "item-category";
      tag.textContent = category;
      const color = CATEGORY_COLORS[category];
      tag.style.color = color;
      tag.style.backgroundColor = color + "26"; // ~15% opacity
      meta.append(tag);
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
    readBtn.textContent = item.read ? "↩" : "✓";
    readBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleRead(item.url); });

    const noteBtn = document.createElement("button");
    noteBtn.title = item.notes ? "Edit note" : "Add note";
    noteBtn.textContent = "✎";
    noteBtn.addEventListener("click", (e) => { e.stopPropagation(); openNotesPanel(item); });

    const deleteBtn = document.createElement("button");
    deleteBtn.title = "Remove";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteItem(item.url); });

    actions.append(readBtn, noteBtn, deleteBtn);
    li.append(favicon, body, actions);     
    li.addEventListener("click", () => {       
      chrome.tabs.create({ url: item.url });       
      if (!item.read) toggleRead(item.url);     
    });     
    listEl.appendChild(li); 
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
  const rows = [["Title", "URL", "Saved", "Read", "Notes"]];
  for (const item of allItems.filter((i) => !i.deleted)) {
    rows.push([
      item.title,
      item.url,
      new Date(item.savedAt).toISOString(),
      item.read ? "Yes" : "No",
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
  render(); 
});

document.querySelectorAll(".filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    render();
  });
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