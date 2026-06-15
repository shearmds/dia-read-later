let allItems = []; 
/* CHANGE: Changed default filter from "all" to "unread" */
let currentFilter = "unread"; 
let searchQuery = ""; 

const listEl = document.getElementById("list"); 
const emptyEl = document.getElementById("empty"); 
const searchEl = document.getElementById("search"); 
const saveBtn = document.getElementById("save-btn"); 

async function load() {   
  const { readLater = [] } = await chrome.storage.local.get("readLater");   
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
    const urlEl = document.createElement("div");     
    urlEl.className = "item-url";     
    try { urlEl.textContent = new URL(item.url).hostname; } catch { urlEl.textContent = item.url; }     
    body.append(title, urlEl);     
    
    const actions = document.createElement("div");     
    actions.className = "item-actions";     
    const readBtn = document.createElement("button");     
    readBtn.title = item.read ? "Mark unread" : "Mark read";     
    readBtn.textContent = item.read ? "↩" : "✓";     
    readBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleRead(item.url); });     
    
    const deleteBtn = document.createElement("button");     
    deleteBtn.title = "Remove";     
    deleteBtn.textContent = "✕";     
    deleteBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteItem(item.url); });     
    
    actions.append(readBtn, deleteBtn);     
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

// --- Sync key management ---
const syncKeyPanel = document.getElementById("synckey-panel");
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

document.getElementById("synckey-btn").addEventListener("click", () => {
  syncKeyPanel.hidden = !syncKeyPanel.hidden;
  if (!syncKeyPanel.hidden) loadSyncKey();
});

document.getElementById("synckey-done").addEventListener("click", () => {
  syncKeyPanel.hidden = true;
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